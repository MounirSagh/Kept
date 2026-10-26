import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@kept/db";
import { fileMetadata, findFileLinks, type FileLink } from "@kept/connectors";

// Files linked from client conversations belong to that client. A contract shared as a Drive or
// SharePoint link in Slack or an email is often the most important document of the account, and
// nothing else (participants, folders) ties it to the client.

const BATCH = 200;

/** The item id a linked file gets: same as the Drive connector's for Google, a hash of the URL for Microsoft. */
export function linkedFileExternalId(link: FileLink): string {
  return link.provider === "google" ? `gdrive:${link.fileId}` : `msfile:${createHash("sha256").update(link.url).digest("hex").slice(0, 32)}`;
}

/** What to search a message's text for, to know whether it links to this file. */
function linkNeedle(item: { externalId: string; metadata: Prisma.JsonValue }): string | null {
  if (item.externalId.startsWith("gdrive:")) return item.externalId.slice("gdrive:".length);
  const file = (item.metadata as { file?: { kind?: string; url?: string } } | null)?.file;
  return file?.kind === "ms-share" && file.url ? file.url : null;
}

/**
 * After matching: routes files linked from matched messages to the message's account, creating the
 * file item when no connector has synced it yet, and routes unmatched files that a matched message
 * links to. The second direction keeps the link when a file is re-synced and rematched on its own.
 */
export async function linkFiles(prisma: PrismaClient, orgId: string, evaluatedIds: string[]) {
  let linked = 0;
  const connections = await prisma.connection.findMany({
    where: { orgId, status: "active", provider: { in: ["google", "microsoft"] } },
    select: { id: true, provider: true, ownerUserId: true },
    orderBy: { createdAt: "asc" },
  });

  for (let i = 0; i < evaluatedIds.length; i += BATCH) {
    const ids = evaluatedIds.slice(i, i + BATCH);

    // 1. Matched messages linking to files.
    const messages = await prisma.sourceItem.findMany({
      where: { id: { in: ids }, matchStatus: "matched", kind: { not: "document" }, contentText: { contains: "https://" } },
      select: { title: true, accountId: true, contentText: true, occurredAt: true, connectionId: true },
    });
    for (const m of messages) {
      for (const link of findFileLinks(m.contentText)) {
        const reason = `linked from "${(m.title ?? "a message").slice(0, 80)}"`;
        const externalId = linkedFileExternalId(link);
        const existing = await prisma.sourceItem.findFirst({
          where: { orgId, externalId, deletedAt: null },
          select: { id: true, matchStatus: true },
        });
        if (existing) {
          if (existing.matchStatus !== "matched") {
            await prisma.sourceItem.update({ where: { id: existing.id }, data: { matchStatus: "matched", accountId: m.accountId, matchReason: reason } });
            linked++;
          }
          continue;
        }
        // Read through a connection of the same kind: the linking item's own when it is one, else the first connected.
        const reader = connections.find((c) => c.id === m.connectionId && c.provider === link.provider) ?? connections.find((c) => c.provider === link.provider);
        if (!reader) continue;
        const metadata = {
          linkedFrom: reason,
          ...fileMetadata(link.provider === "google" ? { kind: "gdrive", fileId: link.fileId } : { kind: "ms-share", url: link.url }, {}),
        };
        await prisma.sourceItem.upsert({
          where: { connectionId_externalId: { connectionId: reader.id, externalId } },
          create: {
            orgId,
            connectionId: reader.id,
            externalId,
            kind: "document",
            title: "Linked file",
            url: link.url,
            occurredAt: m.occurredAt,
            contentHash: createHash("sha256").update(link.url).digest("hex"),
            metadata: metadata as Prisma.InputJsonValue,
            visibleToUserId: reader.ownerUserId,
            matchStatus: "matched",
            accountId: m.accountId,
            matchReason: reason,
          },
          update: { matchStatus: "matched", accountId: m.accountId, matchReason: reason },
        });
        linked++;
      }
    }

    // 2. Files nothing else routed: does a matched message link to them?
    const orphans = await prisma.sourceItem.findMany({
      where: { id: { in: ids }, kind: "document", matchStatus: "unmatched" },
      select: { id: true, externalId: true, metadata: true },
    });
    for (const doc of orphans) {
      const needle = linkNeedle(doc);
      if (!needle) continue;
      const via = await prisma.sourceItem.findFirst({
        where: { orgId, matchStatus: "matched", deletedAt: null, kind: { not: "document" }, contentText: { contains: needle } },
        select: { accountId: true, title: true },
        orderBy: { occurredAt: "desc" },
      });
      if (!via) continue;
      await prisma.sourceItem.update({
        where: { id: doc.id },
        data: { matchStatus: "matched", accountId: via.accountId, matchReason: `linked from "${(via.title ?? "a message").slice(0, 80)}"` },
      });
      linked++;
    }
  }
  return linked;
}

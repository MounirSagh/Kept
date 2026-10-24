import { createHash } from "node:crypto";
import type { Job, Queue } from "bullmq";
import { Prisma, type PrismaClient } from "@kept/db";
import { AuthError, runSync, type ConnectorConfig, type SourceItemInput, type SyncState } from "@kept/connectors";
import type { MatchJobData, SourceSyncJobData } from "@kept/shared";
import { clientForConnection } from "./connection-client.js";

/** First sync of a stream reaches this far back. */
const BACKFILL_DAYS = 90;
/** Pages per job; a larger backlog continues in a follow-up job so others get a turn. */
const MAX_STEPS = 100;
/** A claim older than this belongs to a worker that died mid-sync. */
const CLAIM_TTL_MS = 30 * 60 * 1000;

function contentHash(item: SourceItemInput): string {
  return createHash("sha256")
    .update(JSON.stringify([item.title, item.contentText, item.occurredAt.toISOString(), item.url, item.author]))
    .digest("hex");
}

export function createSourceSyncProcessor(
  prisma: PrismaClient,
  config: ConnectorConfig | null,
  queue: Queue<SourceSyncJobData>,
  matchQueue: Queue<MatchJobData>,
) {
  return async (job: Job<SourceSyncJobData>) => {
    if (!config) throw new Error("TOKEN_ENCRYPTION_KEY is not set on the worker");
    const { connectionId } = job.data;

    // Claim the connection; skip if another sync holds it, or it was disconnected.
    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
    const claimed = await prisma.connection.updateMany({
      where: { id: connectionId, status: "active", OR: [{ syncStartedAt: null }, { syncStartedAt: { lt: staleBefore } }] },
      data: { syncStartedAt: new Date() },
    });
    if (claimed.count === 0) return { skipped: true };

    try {
      const connection = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
      const { def, client } = clientForConnection(prisma, config, connection);

      const now = new Date();
      const result = await runSync(
        def,
        client,
        connection.syncState as SyncState,
        { since: new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000), now },
        {
          maxSteps: MAX_STEPS,
          async onPage({ items, state }) {
            // Items and cursor commit together: a crash never skips or double-counts a page.
            await prisma.$transaction(async (tx) => {
              for (const item of items) {
                const data = {
                  kind: item.kind,
                  title: item.title ?? null,
                  author: item.author ?? null,
                  url: item.url ?? null,
                  occurredAt: item.occurredAt,
                  contentText: item.contentText ?? null,
                  contentHash: contentHash(item),
                  metadata: item.metadata as Prisma.InputJsonValue,
                  // Personal accounts stay private to their owner until matched to a client account.
                  visibleToUserId: connection.ownerUserId,
                  containerId: item.container?.id ?? null,
                  containerLabel: item.container?.label ?? null,
                  // New or changed content is routed again.
                  matchStatus: "pending" as const,
                };
                await tx.sourceItem.upsert({
                  where: { connectionId_externalId: { connectionId, externalId: item.externalId } },
                  create: { orgId: connection.orgId, connectionId, externalId: item.externalId, ...data },
                  update: data,
                });
              }
              await tx.connection.update({ where: { id: connectionId }, data: { syncState: state as Prisma.InputJsonValue } });
            });
          },
        },
      );

      await prisma.connection.update({
        where: { id: connectionId },
        data: { lastSyncedAt: new Date(), lastError: null, syncStartedAt: null },
      });
      if (!result.complete) {
        await queue.add("sync", { connectionId }, { jobId: `more-${connectionId}-${Date.now()}`, removeOnComplete: true });
      }
      if (result.items > 0) {
        // No fixed job id: one already running wouldn't see these items. Matching is idempotent.
        await matchQueue.add("match", { orgId: connection.orgId }, { removeOnComplete: true, removeOnFail: 100 });
      }
      return { items: result.items, complete: result.complete };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.connection.update({
        where: { id: connectionId },
        data: {
          syncStartedAt: null,
          lastError: message.slice(0, 1000),
          // The grant is gone: stop syncing until the user reconnects.
          ...(err instanceof AuthError ? { status: "expired" as const } : {}),
        },
      });
      if (err instanceof AuthError) return { expired: true };
      throw err;
    }
  };
}

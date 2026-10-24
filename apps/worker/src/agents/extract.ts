import type { Job, Queue } from "bullmq";
import type { Prisma, PrismaClient } from "@kept/db";
import { extractFromItem, type ChatModel, type ExtractedFinding } from "@kept/agents";
import { WorldModel } from "@kept/world-model";
import { prismaWorldStorage } from "@kept/world-model/prisma";
import type { AgentRunJobData, ExtractJobData } from "@kept/shared";
import { FREE_MAIL_DOMAINS } from "../matching/match.js";

/** Items per job; a larger backlog continues in a follow-up job so other orgs get a turn. */
const BATCH = 25;
/** Shorter content ("Thanks!", "Sounds good") can't hold a commitment worth tracking. */
const MIN_CONTENT_CHARS = 40;
/** Open items shown to the model so it reports changes instead of duplicates. */
const KNOWN_LIMIT = 40;

interface Deps {
  prisma: PrismaClient;
  /** Null when OPENAI_API_KEY isn't set: jobs then leave items for later instead of failing. */
  model: ChatModel | null;
  extractQueue: Queue<ExtractJobData>;
  agentRunQueue: Queue<AgentRunJobData>;
}

export function createExtractProcessor(deps: Deps) {
  return async (job: Job<ExtractJobData>) => {
    const { orgId } = job.data;
    if (!deps.model) return { skipped: "OPENAI_API_KEY is not set" };

    const result = await extractOrg(deps.prisma, deps.model, orgId);
    for (const accountId of result.accounts) await queueAccountRun(deps.prisma, deps.agentRunQueue, orgId, accountId);
    if (result.more) await deps.extractQueue.add("extract", { orgId }, { removeOnComplete: true, removeOnFail: 100 });
    return { ...result, accounts: result.accounts.length };
  };
}

/** One run per account at a time in the queue: a run that hasn't started yet will see the new data anyway. */
export async function queueAccountRun(prisma: PrismaClient, queue: Queue<AgentRunJobData>, orgId: string, accountId: string) {
  const waiting = await prisma.agentRun.count({ where: { orgId, accountId, status: "queued" } });
  if (waiting > 0) return null;
  const run = await prisma.agentRun.create({ data: { orgId, accountId, trigger: "new_data" } });
  await queue.add("run", { runId: run.id }, { jobId: run.id });
  return run.id;
}

function memberResolver(members: { userId: string; user: { email: string; fullName: string | null } }[]) {
  const byEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.userId]));
  const byName = new Map(members.filter((m) => m.user.fullName).map((m) => [m.user.fullName!.toLowerCase(), m.userId]));
  return (value: string | null) => {
    if (!value) return null;
    const v = value.trim().toLowerCase();
    return byEmail.get(v) ?? byName.get(v) ?? null;
  };
}

/** Extracts one batch for an org. Returns the accounts that got new or changed items. */
export async function extractOrg(prisma: PrismaClient, model: ChatModel, orgId: string) {
  // Content changed since the last extraction (or never extracted). CRM records are structured data, not conversation.
  const pending = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM source_items
    WHERE org_id = ${orgId}::uuid AND match_status = 'matched' AND deleted_at IS NULL
      AND kind <> 'crm_record' AND extracted_hash IS DISTINCT FROM content_hash
    ORDER BY occurred_at ASC
    LIMIT ${BATCH}`;
  if (pending.length === 0) return { processed: 0, created: 0, updated: 0, dropped: 0, accounts: [] as string[], more: false };

  const [org, members] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
    prisma.membership.findMany({ where: { orgId }, select: { userId: true, user: { select: { email: true, fullName: true } } } }),
  ]);
  const resolveMember = memberResolver(members);
  const internalDomains = [
    ...new Set(members.map((m) => m.user.email.split("@")[1]?.toLowerCase()).filter((d): d is string => !!d && !FREE_MAIL_DOMAINS.has(d))),
  ];

  const touched = new Set<string>();
  const created: { id: string; accountId: string; accountName: string; finding: ExtractedFinding; occurredAt: Date }[] = [];
  let updated = 0;
  let dropped = 0;

  for (const { id } of pending) {
    const item = await prisma.sourceItem.findUnique({
      where: { id },
      include: { connection: { select: { provider: true } }, account: { select: { id: true, name: true, domain: true, ownerUserId: true } } },
    });
    if (!item) continue;
    const markRead = () => prisma.sourceItem.update({ where: { id }, data: { extractedHash: item.contentHash } });
    const content = [item.title, item.contentText].filter(Boolean).join("\n\n");
    if (!item.account || content.length < MIN_CONTENT_CHARS) {
      await markRead();
      continue;
    }
    const account = item.account;

    const known = await prisma.extractedItem.findMany({
      where: { orgId, accountId: account.id, status: "open", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: KNOWN_LIMIT,
      select: { id: true, type: true, summary: true, dueDate: true, madeBy: true },
    });
    const refs = new Map(known.map((k, i) => [`K${i + 1}`, k.id]));

    const result = await extractFromItem(model, {
      org: { name: org.name, internalDomains },
      account: { name: account.name, domain: account.domain },
      item: {
        kind: item.kind,
        provider: item.connection.provider,
        title: item.title,
        author: item.author,
        occurredAt: item.occurredAt,
        container: item.containerLabel,
        content: item.contentText ?? item.title ?? "",
      },
      known: known.map((k, i) => ({
        ref: `K${i + 1}`,
        type: k.type,
        summary: k.summary,
        dueDate: k.dueDate?.toISOString().slice(0, 10) ?? null,
        madeBy: k.madeBy,
      })),
    });
    dropped += result.dropped;

    // The item counts as read only once what it said is stored.
    await prisma.$transaction(async (tx) => {
      for (const f of result.items) {
        const ownerUserId =
          resolveMember(f.ownerEmail) ?? resolveMember(f.madeBy) ?? (f.type === "commitment" ? account.ownerUserId : null);
        const row = await tx.extractedItem.create({
          data: {
            orgId,
            accountId: account.id,
            type: f.type,
            summary: f.summary,
            madeBy: f.madeBy,
            ownerUserId,
            dueDate: f.dueDate ? new Date(`${f.dueDate}T00:00:00Z`) : null,
            confidence: f.confidence,
            sourceItemId: item.id,
            sourceExcerpt: f.excerpt,
            origin: "extracted",
            visibleToUserId: item.visibleToUserId,
          },
          select: { id: true },
        });
        created.push({ id: row.id, accountId: account.id, accountName: account.name, finding: f, occurredAt: item.occurredAt });
      }
      for (const u of result.updates) {
        const targetId = refs.get(u.ref);
        if (!targetId) continue;
        const target = await tx.extractedItem.findUnique({ where: { id: targetId }, select: { details: true } });
        const details = { ...((target?.details as Prisma.JsonObject | null) ?? {}), statusChange: { status: u.status, sourceItemId: item.id, excerpt: u.excerpt, at: item.occurredAt.toISOString() } };
        const changed = await tx.extractedItem.updateMany({ where: { id: targetId, status: "open" }, data: { status: u.status, details } });
        updated += changed.count;
      }
      await tx.sourceItem.update({ where: { id }, data: { extractedHash: item.contentHash } });
    });
    if (result.items.length > 0 || result.updates.length > 0) touched.add(account.id);
  }

  await recordInWorldModel(prisma, orgId, created);
  return { processed: pending.length, created: created.length, updated, dropped, accounts: [...touched], more: pending.length === BATCH };
}

/**
 * Commitments become World Model entities related to their account, so the account graph agents
 * share stays complete. Best effort: Postgres stays the source of truth if this fails.
 */
async function recordInWorldModel(
  prisma: PrismaClient,
  orgId: string,
  items: { id: string; accountId: string; accountName: string; finding: ExtractedFinding; occurredAt: Date }[],
) {
  if (items.length === 0) return;
  try {
    const wm = await WorldModel.open({ storage: prismaWorldStorage(prisma), namespace: orgId });
    for (const it of items) {
      // Observation time, not wall clock: re-ingesting the same item stays a no-op.
      const source = { kind: "pipeline", by: "extract", at: it.occurredAt };
      const account = await wm.upsertEntity({ type: "account", externalKey: { system: "kept", id: it.accountId }, name: it.accountName, source });
      const entity = await wm.upsertEntity({
        type: it.finding.type,
        externalKey: { system: "kept", id: it.id },
        name: it.finding.summary,
        attrs: { dueDate: it.finding.dueDate, madeBy: it.finding.madeBy, status: "open" },
        source,
      });
      await wm.relate({ from: entity.id, type: "concerns", to: account.id, source });
      await prisma.extractedItem.update({ where: { id: it.id }, data: { worldModelRef: entity.id } });
    }
  } catch (err) {
    console.warn(`world model ingest for org ${orgId} failed: ${(err as Error).message}`);
  }
}

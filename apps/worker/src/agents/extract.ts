import { DelayedError, type Job, type Queue } from "bullmq";
import { closeFlagsForCommitment, type Prisma, type PrismaClient } from "@kept/db";
import { extractFromItem, looksLikeContract, readContractTerms, type ChatModel, type ExtractedFinding, type Transcriber } from "@kept/agents";
import type { ConnectorConfig } from "@kept/connectors";
import { pageOf } from "@kept/documents";
import { WorldModel } from "@kept/world-model";
import { prismaWorldStorage } from "@kept/world-model/prisma";
import type { AccountUpdatePayload, AgentRunJobData, ExtractJobData } from "@kept/shared";
import { FREE_MAIL_DOMAINS } from "../matching/match.js";
import { readPendingDocuments } from "./documents.js";

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
  /** For downloading files routed to a client; null without TOKEN_ENCRYPTION_KEY. */
  config: ConnectorConfig | null;
  /** OCR for scans; null without OPENAI_API_KEY. */
  transcriber: Transcriber | null;
  /** One extraction per org at a time (a lock shared by every worker process). */
  lock: OrgLock;
}

export interface OrgLock {
  /** Takes the lock for ttlMs; returns a release function, or null when someone else holds it. */
  acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
}

/** Longer than one extraction job (the worker's lockDuration), so a held lock never expires mid-job. */
const EXTRACT_LOCK_MS = 10 * 60 * 1000;
/** A job that finds its org already being extracted waits this long and tries again. */
const RETRY_LOCKED_MS = 15_000;

export function createExtractProcessor(deps: Deps) {
  return async (job: Job<ExtractJobData>, token?: string) => {
    const { orgId } = job.data;
    if (!deps.model) return { skipped: "OPENAI_API_KEY is not set" };

    // Two jobs for the same org would read the same items and store each finding twice.
    // The job that finds the org taken waits, then runs and picks up whatever is still pending.
    const release = await deps.lock.acquire(`extract:${orgId}`, EXTRACT_LOCK_MS);
    if (!release) {
      await job.moveToDelayed(Date.now() + RETRY_LOCKED_MS, token);
      throw new DelayedError();
    }
    try {
      // Files routed to a client are read first, so their text is extracted in this same job.
      const documents = await readPendingDocuments(deps.prisma, deps.config, deps.transcriber, orgId);
      const result = await extractOrg(deps.prisma, deps.model, orgId);
      for (const accountId of result.accounts) await queueAccountRun(deps.prisma, deps.agentRunQueue, orgId, accountId);
      if (result.more || documents.more) await deps.extractQueue.add("extract", { orgId }, { removeOnComplete: true, removeOnFail: 100 });
      return { ...result, accounts: result.accounts.length, documentsRead: documents.read, documentsSkipped: documents.skipped };
    } finally {
      await release();
    }
  };
}

/** One run per account at a time in the queue: a run that hasn't started yet will see the new data anyway. */
export async function queueAccountRun(
  prisma: PrismaClient,
  queue: Queue<AgentRunJobData>,
  orgId: string,
  accountId: string,
  trigger: "new_data" | "schedule" = "new_data",
) {
  const waiting = await prisma.agentRun.count({ where: { orgId, accountId, status: "queued" } });
  if (waiting > 0) return null;
  const run = await prisma.agentRun.create({ data: { orgId, accountId, trigger } });
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
      AND kind NOT IN ('crm_record', 'dataset') AND extracted_hash IS DISTINCT FROM content_hash
      -- Files are extracted once read (or OCR'd); until then they're only a name.
      AND (kind <> 'document' OR coalesce(metadata->>'contentStatus', 'read') IN ('read', 'ocr'))
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
            // Where in the document the quote is, for "MSA, p. 4".
            ...(item.kind === "document" && item.contentText ? { details: { page: pageOf(item.contentText, f.excerpt) } } : {}),
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
        // Kept or replaced: its flags are done. A broken promise keeps its flag; that still needs someone.
        if (changed.count > 0 && u.status !== "broken") {
          const reason = u.status === "fulfilled" ? `Promise kept: "${u.excerpt}"` : `Promise replaced: "${u.excerpt}"`;
          await closeFlagsForCommitment(tx, orgId, targetId, reason);
        }
      }
      await tx.sourceItem.update({ where: { id }, data: { extractedHash: item.contentHash } });
    });
    if (result.items.length > 0 || result.updates.length > 0) touched.add(account.id);

    // A contract may state the renewal date and value: suggested onto the company, never set silently.
    if (item.kind === "document" && item.contentText && looksLikeContract(item.title, item.contentText)) {
      await proposeContractTerms(prisma, model, { orgId, account, item: { id: item.id, title: item.title, content: item.contentText } });
    }
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

/**
 * Reads a contract's renewal date and yearly value and, where they differ from the company's,
 * proposes setting them (an "update company" action in Approvals). Never twice for the same terms.
 */
async function proposeContractTerms(
  prisma: PrismaClient,
  model: ChatModel,
  ctx: { orgId: string; account: { id: string; name: string }; item: { id: string; title: string | null; content: string } },
) {
  const today = new Date().toISOString().slice(0, 10);
  const { terms } = await readContractTerms(model, { title: ctx.item.title, content: ctx.item.content, accountName: ctx.account.name, today });
  if (!terms) return;
  const current = await prisma.account.findUniqueOrThrow({
    where: { id: ctx.account.id },
    select: { renewalDate: true, annualValueCents: true, currency: true },
  });
  const renewalDiffers = terms.renewalDate !== null && terms.renewalDate !== current.renewalDate?.toISOString().slice(0, 10);
  const valueDiffers =
    terms.annualValue !== null && (current.annualValueCents === null || BigInt(Math.round(terms.annualValue * 100)) !== current.annualValueCents);
  if (!renewalDiffers && !valueDiffers) return;

  const payload: AccountUpdatePayload = {
    renewalDate: renewalDiffers ? terms.renewalDate : null,
    annualValue: valueDiffers ? String(terms.annualValue) : null,
    currency: valueDiffers ? (terms.currency ?? current.currency ?? null) : null,
    noticeDays: terms.noticeDays,
    documentTitle: ctx.item.title ?? "a contract",
    excerpt: terms.excerpt,
  };
  const waiting = await prisma.proposedAction.findMany({
    where: { orgId: ctx.orgId, accountId: ctx.account.id, type: "update_account", status: { in: ["pending", "rejected", "done"] } },
    select: { payload: true },
  });
  const same = (p: unknown) => {
    const q = p as AccountUpdatePayload;
    return q.renewalDate === payload.renewalDate && q.annualValue === payload.annualValue && q.currency === payload.currency;
  };
  if (waiting.some((w) => same(w.payload))) return;

  const parts = [
    payload.renewalDate && `renewal date ${payload.renewalDate}`,
    payload.annualValue && `contract value ${payload.annualValue}${payload.currency ? ` ${payload.currency}` : ""} a year`,
  ].filter(Boolean);
  await prisma.proposedAction.create({
    data: {
      orgId: ctx.orgId,
      accountId: ctx.account.id,
      type: "update_account",
      payload: payload as unknown as Prisma.InputJsonValue,
      rationale: `"${payload.documentTitle}" states the ${parts.join(" and ")}${terms.noticeDays ? `, with ${terms.noticeDays} days' notice to cancel` : ""}.`,
    },
  });
}

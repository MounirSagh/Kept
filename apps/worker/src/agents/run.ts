import { DelayedError, type Job } from "bullmq";
import { Prisma, type PrismaClient } from "@kept/db";
import {
  flagDedupeKey, normalizeForMatch, runAccountAgents, truncate,
  type AccountContext, type ChatModel, type InvestigationTools, type SourceDoc, type StepRecord,
} from "@kept/agents";
import { canAct } from "@kept/connectors";
import type { ActionPayload, AgentRunJobData, CrmTaskPayload, ReminderPayload, SendEmailPayload, TicketPayload } from "@kept/shared";
import { recallForAccount } from "./memory.js";
import { accountData } from "./data.js";
import { accountHistory, openWorld, syncAccountWorld } from "./world.js";

const COMMITMENT_LIMIT = 60;
const RECENT_LIMIT = 8;
const CONTACT_LIMIT = 30;
const LINEAR_TEAM_LIMIT = 10;
/** Closed items stay in context this long, so the agents can see what was just delivered or missed. */
const RECENTLY_CLOSED_DAYS = 30;

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

function formatValue(cents: bigint | null, currency: string | null) {
  if (cents == null) return null;
  const amount = Number(cents) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency ?? ""}`.trim();
  }
}

/** "Logistics, Customer, 359 employees, Montreal, Quebec, Canada (America/Toronto). Moves freight..." */
function describeCompany(a: {
  industry: string | null; companyType: string | null; employeeCount: number | null;
  city: string | null; region: string | null; country: string | null; timezone: string | null; description: string | null;
}): string | null {
  const place = [a.city, a.region, a.country].filter(Boolean).join(", ");
  const facts = [
    a.industry,
    a.companyType,
    a.employeeCount != null ? `${a.employeeCount.toLocaleString("en-US")} employees` : null,
    place ? `${place}${a.timezone ? ` (${a.timezone})` : ""}` : a.timezone,
  ].filter(Boolean);
  const text = [facts.join(", "), a.description ? truncate(a.description.replace(/\s+/g, " "), 300) : null].filter(Boolean).join(". ");
  return text || null;
}

type DocRow = { id: string; title: string | null; author: string | null; occurred_at: Date; content_text: string | null; provider: string };
const toDoc = (r: DocRow): SourceDoc => ({
  id: r.id,
  provider: r.provider,
  title: r.title,
  author: r.author,
  occurredAt: r.occurred_at,
  content: r.content_text ?? r.title ?? "",
});

/**
 * Search and read over one account's synced items. Matched items are visible to everyone who can
 * see the account, so a run on the account may use all of them and nothing else.
 */
export function accountTools(prisma: PrismaClient, orgId: string, accountId: string): InvestigationTools {
  return {
    async search(query, limit) {
      const q = query.trim();
      if (!q) return [];
      const rows = await prisma.$queryRaw<DocRow[]>`
        SELECT s.id, s.title, s.author, s.occurred_at, s.content_text, c.provider::text AS provider
        FROM source_items s JOIN connections c ON c.id = s.connection_id
        WHERE s.org_id = ${orgId}::uuid AND s.account_id = ${accountId}::uuid
          AND s.match_status = 'matched' AND s.deleted_at IS NULL
          AND to_tsvector('english', coalesce(s.title, '') || ' ' || coalesce(s.content_text, ''))
              @@ websearch_to_tsquery('english', ${q})
        ORDER BY ts_rank(to_tsvector('english', coalesce(s.title, '') || ' ' || coalesce(s.content_text, '')),
                         websearch_to_tsquery('english', ${q})) DESC, s.occurred_at DESC
        LIMIT ${limit}`;
      return rows.map(toDoc);
    },
    async read(ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.sourceItem.findMany({
        where: { id: { in: ids }, orgId, accountId, matchStatus: "matched", deletedAt: null },
        select: { id: true, title: true, author: true, occurredAt: true, contentText: true, connection: { select: { provider: true } } },
      });
      return rows.map((r) => ({ id: r.id, provider: r.connection.provider, title: r.title, author: r.author, occurredAt: r.occurredAt, content: r.contentText ?? r.title ?? "" }));
    },
  };
}

export async function loadAccountContext(prisma: PrismaClient, orgId: string, accountId: string): Promise<AccountContext> {
  const closedSince = new Date(Date.now() - RECENTLY_CLOSED_DAYS * 24 * 60 * 60 * 1000);
  const [org, account, contacts, commitments, recent, openFlags] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, settings: true } }),
    prisma.account.findFirstOrThrow({
      where: { id: accountId, orgId, deletedAt: null },
      include: { owner: { select: { fullName: true, email: true } } },
    }),
    prisma.contact.findMany({
      where: { orgId, accountId, deletedAt: null },
      select: { fullName: true, email: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: CONTACT_LIMIT,
    }),
    prisma.extractedItem.findMany({
      where: { orgId, accountId, deletedAt: null, OR: [{ status: "open" }, { updatedAt: { gte: closedSince } }] },
      include: { owner: { select: { fullName: true, email: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: COMMITMENT_LIMIT,
    }),
    prisma.sourceItem.findMany({
      // CRM records and live data tables aren't activity.
      where: { orgId, accountId, matchStatus: "matched", deletedAt: null, kind: { notIn: ["crm_record", "dataset"] } },
      select: { id: true, title: true, author: true, occurredAt: true, contentText: true, connection: { select: { provider: true } } },
      orderBy: { occurredAt: "desc" },
      take: RECENT_LIMIT,
    }),
    prisma.flag.findMany({ where: { orgId, accountId, status: { in: ["open", "confirmed"] } }, select: { kind: true, title: true } }),
  ]);
  const pending = await prisma.proposedAction.findMany({
    where: { orgId, accountId, status: { in: ["pending", "approved"] } },
    select: { type: true, payload: true },
    orderBy: { createdAt: "asc" },
  });

  const profile = (org.settings as { profile?: { emailSignature?: string } } | null)?.profile;
  const memories = await recallForAccount(
    prisma,
    orgId,
    accountId,
    [account.name, ...commitments.slice(0, 10).map((c) => c.summary)].join(". "),
  );

  const [tools, history] = await Promise.all([actionTools(prisma, orgId, accountId, account.crmExternalId), worldHistory(prisma, orgId, accountId)]);

  return {
    today: day(new Date())!,
    org: { name: org.name, emailSignature: profile?.emailSignature?.trim() || null },
    account: {
      name: account.name,
      domain: account.domain,
      ownerName: account.owner?.fullName ?? account.owner?.email ?? null,
      renewalDate: day(account.renewalDate),
      annualValue: formatValue(account.annualValueCents, account.currency),
      healthScore: account.healthScore,
      about: describeCompany(account),
    },
    contacts: contacts.map((c) => ({ name: c.fullName, email: c.email, title: c.title })),
    commitments: commitments.map((c) => ({
      id: c.id,
      type: c.type,
      summary: c.summary,
      dueDate: day(c.dueDate),
      status: c.status,
      madeBy: c.madeBy,
      owner: c.owner?.fullName ?? c.owner?.email ?? null,
      sourceItemId: c.sourceItemId,
      excerpt: c.sourceExcerpt,
    })),
    recent: recent.map((r) => ({
      id: r.id,
      provider: r.connection.provider,
      title: r.title,
      author: r.author,
      occurredAt: r.occurredAt,
      content: truncate(r.contentText ?? r.title ?? "", 4000),
    })),
    openFlags,
    pendingActions: pending.map((a) => describeAction(a.type, a.payload)),
    memories,
    history,
    // Filled in by the run when Zetaris is connected.
    datasets: [],
    tools,
  };
}

/**
 * Where Kept may act for this account: Linear teams seen in synced issues (those routed to this
 * account first), and the company's HubSpot record, each only with a connection allowed to write.
 */
export async function actionTools(prisma: PrismaClient, orgId: string, accountId: string, crmExternalId: string | null): Promise<AccountContext["tools"]> {
  const connections = await prisma.connection.findMany({
    where: { orgId, provider: { in: ["linear", "hubspot"] }, status: "active" },
    select: { id: true, provider: true, scopes: true },
  });
  const linear = connections.filter((c) => c.provider === "linear" && canAct(c.provider, c.scopes)).map((c) => c.id);
  const crmTasks = !!crmExternalId && /^hubspot:\d+$/.test(crmExternalId) && connections.some((c) => c.provider === "hubspot" && canAct(c.provider, c.scopes));
  if (linear.length === 0) return { linearTeams: [], crmTasks };

  const [teams, mapped] = await Promise.all([
    prisma.sourceItem.groupBy({
      by: ["containerId", "containerLabel"],
      where: { orgId, connectionId: { in: linear }, deletedAt: null, containerId: { not: null } },
      _max: { occurredAt: true },
    }),
    prisma.sourceMapping.findMany({ where: { orgId, connectionId: { in: linear }, accountId }, select: { containerId: true } }),
  ]);
  const ours = new Set(mapped.map((m) => m.containerId));
  const byKey = new Map<string, { key: string; name: string; ours: boolean; last: number }>();
  for (const t of teams) {
    const key = t.containerId!;
    const last = t._max.occurredAt?.getTime() ?? 0;
    const prev = byKey.get(key);
    if (!prev || prev.last < last) byKey.set(key, { key, name: t.containerLabel ?? key, ours: ours.has(key), last });
  }
  const linearTeams = [...byKey.values()]
    .sort((a, b) => Number(b.ours) - Number(a.ours) || b.last - a.last)
    .slice(0, LINEAR_TEAM_LIMIT)
    .map(({ key, name }) => ({ key, name }));
  return { linearTeams, crmTasks };
}

/** Brings the World Model up to date with the account, then reads its history. Best effort. */
async function worldHistory(prisma: PrismaClient, orgId: string, accountId: string): Promise<string[]> {
  try {
    const wm = await openWorld(prisma, orgId);
    await syncAccountWorld(wm, prisma, orgId, accountId);
    return accountHistory(wm, accountId);
  } catch (err) {
    console.warn(`world model for account ${accountId} failed: ${(err as Error).message}`);
    return [];
  }
}

/** One line per waiting action, so the advisor doesn't propose it again. */
function describeAction(type: string, payload: Prisma.JsonValue): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (type === "send_email") return `Email to ${(p.to as string[] | undefined)?.join(", ")}: "${p.subject}"`;
  if (type === "schedule_reminder") return `Reminder on ${p.remindOn}: ${p.title}`;
  if (type === "create_ticket") return `Linear issue in ${p.teamKey}: "${p.title}"`;
  if (type === "update_crm") return `HubSpot task due ${p.dueDate}: "${p.subject}"`;
  if (type === "update_account") return `Company update from ${p.documentTitle}`;
  return `Team alert: ${truncate(String(p.message ?? ""), 160)}`;
}

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

/** A run that has been "running" longer than this belongs to a worker that died; it doesn't block others. */
const STALE_RUN_MS = 30 * 60 * 1000;
/** A run that finds its account already under review waits this long and tries again. */
const RETRY_BUSY_MS = 30_000;

export function createAgentRunProcessor(prisma: PrismaClient, model: ChatModel | null, encryptionKey: string | null = null) {
  return async (job: Job<AgentRunJobData>, token?: string) => {
    const { runId } = job.data;
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run || run.status === "completed" || run.status === "cancelled" || run.status === "failed") return { skipped: true };
    // Still "running": a worker died mid-run and BullMQ handed the job back. Starting over would
    // silently pay for the whole run again, so it's closed; new activity on the account queues a fresh one.
    if (run.status === "running") {
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: "failed", finishedAt: new Date(), error: "Interrupted: the worker stopped during the run" },
      });
      return { interrupted: true };
    }
    if (!model) throw new Error("OPENAI_API_KEY is not set on the worker");
    if (!run.accountId) throw new Error("Agent runs need an account");
    const { orgId, accountId } = run;

    // One run per account at a time: two at once would raise the same flags and draft the same actions.
    // The check and the claim happen under a per-account lock, so two runs can't both see the account free.
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-run:${accountId}`}, 0))`;
      const busy = await tx.agentRun.count({
        where: { accountId, status: "running", id: { not: runId }, startedAt: { gte: new Date(Date.now() - STALE_RUN_MS) } },
      });
      if (busy > 0) return false;
      await tx.agentRun.update({ where: { id: runId }, data: { status: "running", startedAt: new Date(), error: null } });
      return true;
    });
    if (!claimed) {
      await job.moveToDelayed(Date.now() + RETRY_BUSY_MS, token);
      throw new DelayedError();
    }

    // A retried job continues the step numbering instead of colliding with the failed attempt's steps.
    let stepIndex = await prisma.agentStep.count({ where: { runId } });
    // Cost is added to the run with each step, so a run that fails partway still shows what it spent.
    const onStep = async (s: StepRecord) => {
      await prisma.$transaction([
        prisma.agentStep.create({
          data: {
            runId,
            stepIndex: stepIndex++,
            agent: s.agent,
            action: s.action,
            inputSummary: s.inputSummary.slice(0, 500),
            output: s.output as Prisma.InputJsonValue,
            verdict: s.verdict ?? null,
            inputTokens: s.usage.inputTokens,
            outputTokens: s.usage.outputTokens,
            costUsd: s.usage.costUsd,
            durationMs: s.durationMs,
          },
        }),
        prisma.agentRun.update({
          where: { id: runId },
          data: {
            inputTokens: { increment: s.usage.inputTokens },
            outputTokens: { increment: s.usage.outputTokens },
            costUsd: { increment: s.usage.costUsd },
          },
        }),
      ]);
    };

    try {
      const account = await prisma.account.findFirstOrThrow({ where: { id: accountId, orgId }, select: { id: true, name: true, domain: true, crmExternalId: true } });
      // Live data through Zetaris, when connected: the planner sees what exists, the investigator queries it.
      const data = await accountData(prisma, encryptionKey, orgId, account);
      const ctx = { ...(await loadAccountContext(prisma, orgId, accountId)), datasets: data.available };
      const tracing = process.env.LANGSMITH_TRACING === "true";
      const result = await runAccountAgents(
        ctx,
        { model, tools: { ...accountTools(prisma, orgId, accountId), queryData: data.query }, onStep },
        // The LangSmith trace takes the run's id, so a run links straight to its trace.
        { runId: tracing ? runId : undefined, runName: `account-run ${ctx.account.name}`, tags: [`org:${orgId}`], metadata: { orgId, accountId, runId } },
      );

      const saved = await saveProposals(prisma, { orgId, accountId, runId }, result);

      await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          finishedAt: new Date(),
          plan: result.plan as unknown as Prisma.InputJsonValue,
          criticIterations: result.criticRounds,
          error: null,
          langsmithTraceId: tracing ? runId : null,
        },
      });
      return { questions: result.plan.questions.length, ...saved };
    } catch (err) {
      // Back to queued so BullMQ's retry runs it; the worker's failed handler marks it failed after the last attempt.
      await prisma.agentRun.update({ where: { id: runId }, data: { status: "queued", error: (err as Error).message } });
      throw err;
    }
  };
}

/** Stores flags (skipping ones already raised for the same issue) and the actions proposed for them. */
async function saveProposals(
  prisma: PrismaClient,
  run: { orgId: string; accountId: string; runId: string },
  result: Awaited<ReturnType<typeof runAccountAgents>>,
) {
  const flagIds: (string | null)[] = [];
  let flags = 0;
  let merged = 0;
  for (const f of result.flags) {
    // A promise has one open flag at a time: new evidence about it goes onto that flag.
    const open = f.commitmentId
      ? await prisma.flag.findFirst({
          where: { orgId: run.orgId, extractedItemId: f.commitmentId, status: { in: ["open", "confirmed"] } },
          include: { evidence: { select: { excerpt: true } } },
          orderBy: { createdAt: "asc" },
        })
      : null;
    if (open) {
      const known = new Set(open.evidence.map((e) => normalizeForMatch(e.excerpt ?? "")));
      const fresh = f.evidence.filter((e) => !known.has(normalizeForMatch(e.excerpt)));
      const escalate = SEVERITY_RANK[f.severity] > SEVERITY_RANK[open.severity];
      await prisma.$transaction([
        prisma.flagEvidence.createMany({
          data: fresh.map((e) => ({ orgId: run.orgId, flagId: open.id, sourceItemId: e.sourceItemId, extractedItemId: e.commitmentId, stance: e.stance, excerpt: e.excerpt })),
        }),
        // A more severe reading of the same issue takes over the headline.
        prisma.flag.update({
          where: { id: open.id },
          data: escalate ? { severity: f.severity, kind: f.kind, title: f.title, explanation: f.explanation, confidence: f.confidence } : {},
        }),
      ]);
      flagIds.push(open.id);
      merged++;
      continue;
    }

    const dedupeKey = flagDedupeKey(run.accountId, f);
    try {
      // Evidence shares the flag's org through composite keys, so it's inserted by its own columns.
      const flag = await prisma.$transaction(async (tx) => {
        const created = await tx.flag.create({
          data: {
            orgId: run.orgId,
            accountId: run.accountId,
            runId: run.runId,
            extractedItemId: f.commitmentId,
            kind: f.kind,
            title: f.title,
            explanation: f.explanation,
            severity: f.severity,
            confidence: f.confidence,
            dedupeKey,
          },
          select: { id: true },
        });
        await tx.flagEvidence.createMany({
          data: f.evidence.map((e) => ({
            orgId: run.orgId,
            flagId: created.id,
            sourceItemId: e.sourceItemId,
            extractedItemId: e.commitmentId ?? (e.stance === "supports" ? f.commitmentId : null),
            stance: e.stance,
            excerpt: e.excerpt,
          })),
        });
        return created;
      });
      flagIds.push(flag.id);
      flags++;
    } catch (err) {
      // Already raised and closed by a person (dismissed or resolved): don't raise it again, or re-propose its actions.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        flagIds.push(null);
        continue;
      }
      throw err;
    }
  }

  let actions = 0;
  let replaced = 0;
  for (const a of result.actions) {
    if (a.flag !== null && flagIds[a.flag] === null) continue;
    const flagId = a.flag !== null ? flagIds[a.flag]! : null;
    const payload: ActionPayload =
      a.type === "send_email" ? { to: a.to, subject: a.subject, body: a.body }
      : a.type === "schedule_reminder" ? { title: a.title, remindOn: a.remindOn }
      : a.type === "create_ticket" ? ({ teamKey: a.teamKey, title: a.title, description: a.description } satisfies TicketPayload)
      : a.type === "update_crm" ? ({ subject: a.subject, body: a.body, dueDate: a.dueDate } satisfies CrmTaskPayload)
      : { message: a.message };

    const waiting = await prisma.proposedAction.findMany({
      where: { orgId: run.orgId, accountId: run.accountId, type: a.type, status: "pending" },
      select: { id: true, flagId: true, payload: true },
    });
    const recipients = (p: unknown) => [...((p as SendEmailPayload).to ?? [])].sort().join(",");
    if (a.type === "schedule_reminder" && waiting.some((w) => (w.payload as unknown as ReminderPayload).remindOn === a.remindOn)) continue;
    // One issue or CRM task per flag, or per title when it isn't about a flag.
    const titleOf = (p: unknown) => String((p as { title?: string; subject?: string }).title ?? (p as { subject?: string }).subject ?? "").trim().toLowerCase();
    if (
      (a.type === "create_ticket" || a.type === "update_crm") &&
      waiting.some((w) => (flagId !== null && w.flagId === flagId) || titleOf(w.payload) === titleOf(payload))
    ) continue;
    // A newer email to the same people about the same flag, or a newer alert about it, knows more:
    // it replaces the waiting one. Emails about different issues stay separate.
    const superseded = waiting.filter((w) =>
      a.type === "send_email" ? recipients(w.payload) === recipients(payload) && w.flagId === flagId
      : a.type === "internal_alert" ? flagId !== null && w.flagId === flagId
      : false,
    );
    if (superseded.length > 0) {
      await prisma.proposedAction.updateMany({
        where: { id: { in: superseded.map((w) => w.id) }, status: "pending" },
        data: { status: "rejected", decidedAt: new Date(), decisionNote: "Replaced by a newer suggestion" },
      });
      replaced += superseded.length;
    }

    await prisma.proposedAction.create({
      data: {
        orgId: run.orgId,
        accountId: run.accountId,
        runId: run.runId,
        flagId,
        type: a.type,
        payload: payload as unknown as Prisma.InputJsonValue,
        rationale: a.rationale,
      },
    });
    actions++;
  }
  return { flags, mergedFlags: merged, skippedFlags: result.flags.length - flags - merged, actions, replacedActions: replaced };
}

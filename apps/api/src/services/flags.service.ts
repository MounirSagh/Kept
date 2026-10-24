import type { Prisma } from "@kept/db";
import type { FlagDecisionInput, FlagDto, ProviderId } from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { learnQueue } from "../lib/queues.js";
import type { OrgActor } from "../types/express.js";
import { visibleAccountsWhere } from "./accounts.service.js";

/** Flags on accounts the actor can see, minus other people's private ones. */
function visibleFlagsWhere(actor: OrgActor): Prisma.FlagWhereInput {
  return {
    orgId: actor.orgId,
    account: visibleAccountsWhere(actor),
    OR: [{ visibleToUserId: null }, { visibleToUserId: actor.userId }],
  };
}

const include = {
  account: { select: { name: true, renewalDate: true, annualValueCents: true, currency: true } },
  extractedItem: { select: { id: true, summary: true, dueDate: true } },
  resolvedBy: { select: { fullName: true, email: true } },
  evidence: {
    include: {
      sourceItem: { select: { id: true, title: true, url: true, occurredAt: true, connection: { select: { provider: true } } } },
      extractedItem: { select: { id: true, summary: true } },
    },
  },
  _count: { select: { proposedActions: { where: { status: "pending" } } } },
} satisfies Prisma.FlagInclude;

type Row = Prisma.FlagGetPayload<{ include: typeof include }>;

function toDto(f: Row): FlagDto {
  return {
    id: f.id,
    accountId: f.accountId,
    accountName: f.account.name,
    accountRenewalDate: f.account.renewalDate?.toISOString().slice(0, 10) ?? null,
    accountValueCents: f.account.annualValueCents?.toString() ?? null,
    accountCurrency: f.account.currency,
    commitment: f.extractedItem
      ? { id: f.extractedItem.id, summary: f.extractedItem.summary, dueDate: f.extractedItem.dueDate?.toISOString().slice(0, 10) ?? null }
      : null,
    kind: f.kind,
    title: f.title,
    explanation: f.explanation,
    severity: f.severity,
    confidence: f.confidence == null ? null : Number(f.confidence),
    status: f.status,
    resolutionNote: f.resolutionNote,
    resolvedBy: f.resolvedBy ? (f.resolvedBy.fullName ?? f.resolvedBy.email) : null,
    createdAt: f.createdAt.toISOString(),
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    evidence: f.evidence.map((e) => ({
      stance: e.stance,
      excerpt: e.excerpt,
      source: e.sourceItem
        ? {
            id: e.sourceItem.id,
            title: e.sourceItem.title,
            provider: e.sourceItem.connection.provider as ProviderId,
            url: e.sourceItem.url,
            occurredAt: e.sourceItem.occurredAt.toISOString(),
          }
        : null,
      commitment: e.extractedItem ? { id: e.extractedItem.id, summary: e.extractedItem.summary } : null,
    })),
    pendingActions: f._count.proposedActions,
  };
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/**
 * Highest stakes first: severity, then the sooner renewal, then the bigger contract; newest first
 * when all else is equal (the query already returns newest first, and the sort is stable).
 */
function byStakes(a: FlagDto, b: FlagDto): number {
  const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (severity !== 0) return severity;
  // Undated renewals sort last.
  const renewal = (a.accountRenewalDate ?? "9999-12-31").localeCompare(b.accountRenewalDate ?? "9999-12-31");
  if (renewal !== 0) return renewal;
  const value = (f: FlagDto) => BigInt(f.accountValueCents ?? "0");
  const diff = value(b) - value(a);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
}

export async function listFlags(actor: OrgActor, filter: { status: "open" | "closed"; accountId?: string }) {
  const flags = await prisma.flag.findMany({
    where: {
      AND: [
        visibleFlagsWhere(actor),
        { status: filter.status === "open" ? { in: ["open", "confirmed"] } : { in: ["dismissed", "resolved"] } },
        filter.accountId ? { accountId: filter.accountId } : {},
      ],
    },
    include,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return flags.map(toDto).sort(byStakes);
}

const LABEL = { unkept_promise: "unkept promise", mismatch: "mismatch", deadline_risk: "deadline risk", churn_signal: "churn signal" } as const;

export async function decideFlag(actor: OrgActor, flagId: string, input: FlagDecisionInput) {
  const flag = await prisma.flag.findFirst({ where: { AND: [visibleFlagsWhere(actor), { id: flagId }] }, include: { account: { select: { name: true } } } });
  if (!flag) throw new HttpError(404, "Flag not found");
  const note = input.note?.trim() || null;
  const closing = input.status !== "confirmed";

  await prisma.$transaction(async (tx) => {
    await tx.flag.update({
      where: { id: flag.id },
      data: {
        status: input.status,
        resolutionNote: note,
        resolvedById: actor.userId,
        resolvedAt: closing ? new Date() : null,
      },
    });
    // A closed flag's suggestions no longer apply.
    if (closing) {
      await tx.proposedAction.updateMany({
        where: { flagId: flag.id, status: "pending" },
        data: { status: "rejected", decidedById: actor.userId, decidedAt: new Date(), decisionNote: `Flag ${input.status}` },
      });
    }
  });

  // What the next runs should know about this decision.
  const subject = `The ${LABEL[flag.kind]} flag "${flag.title}" on ${flag.account.name}`;
  const lesson =
    input.status === "dismissed"
      ? `${subject} was dismissed as not a real issue${note ? `: ${note}` : ""}. Don't raise it again unless something new happens.`
      : input.status === "resolved"
        ? `${subject} was resolved${note ? `: ${note}` : ""}.`
        : `${subject} was confirmed as a real issue${note ? `: ${note}` : ""}.`;
  await learnQueue.add("learn", { orgId: actor.orgId, accountId: flag.accountId, content: lesson, flagId: flag.id });

  const updated = await prisma.flag.findUniqueOrThrow({ where: { id: flag.id }, include });
  return toDto(updated);
}

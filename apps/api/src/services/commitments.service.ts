import { closeFlagsForCommitment, type ExtractedItem, type Prisma } from "@kept/db";
import type { CommitmentDto, CommitmentImportRow, CommitmentInput, ImportResultDto, PromiseSide, SeverityValue } from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import type { OrgActor } from "../types/express.js";
import { MAX_IMPORT_ROWS, canSeeAccount, membersByEmail, visibleAccountsWhere } from "./accounts.service.js";

/**
 * Promises, ours ("commitment") and the customer's ("obligation"), follow their account's visibility;
 * ones not tied to an account stay with whoever they're private to.
 */
function visibleCommitmentsWhere(actor: OrgActor): Prisma.ExtractedItemWhereInput {
  return {
    orgId: actor.orgId,
    type: { in: ["commitment", "obligation"] },
    deletedAt: null,
    OR: [{ account: visibleAccountsWhere(actor) }, { visibleToUserId: actor.userId }],
  };
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);

type Row = ExtractedItem & {
  account: { name: string } | null;
  sourceItem: { url: string | null } | null;
  flags?: { id: string; severity: SeverityValue; title: string }[];
};

const SEVERITY_RANK: Record<SeverityValue, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function toDto(c: Row): CommitmentDto {
  const details = c.details as { notes?: string } | null;
  return {
    id: c.id,
    accountId: c.accountId,
    accountName: c.account?.name ?? null,
    summary: c.summary,
    notes: details?.notes ?? null,
    madeBy: c.madeBy,
    ownerUserId: c.ownerUserId,
    dueDate: dateOnly(c.dueDate),
    status: c.status,
    type: c.type === "obligation" ? "obligation" : "commitment",
    origin: c.origin,
    sourceUrl: c.sourceItem?.url ?? null,
    sourcePage: typeof (c.details as { page?: unknown } | null)?.page === "number" ? ((c.details as { page: number }).page) : null,
    createdAt: c.createdAt.toISOString(),
    risk: (() => {
      const top = [...(c.flags ?? [])].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
      return top ? { flagId: top.id, severity: top.severity, title: top.title } : null;
    })(),
  };
}

const include = {
  account: { select: { name: true } },
  sourceItem: { select: { url: true } },
  // Open flags only: a resolved or dismissed one no longer puts the promise at risk.
  flags: { where: { status: { in: ["open", "confirmed"] } }, select: { id: true, severity: true, title: true } },
} satisfies Prisma.ExtractedItemInclude;

/** Open commitments first, soonest due first (undated last); then everything else, newest first. */
export async function listCommitments(actor: OrgActor, filter: { status?: string; accountId?: string; type?: PromiseSide }) {
  const rows = await prisma.extractedItem.findMany({
    where: {
      AND: [
        visibleCommitmentsWhere(actor),
        { type: filter.type ?? "commitment" },
        filter.status ? { status: filter.status as CommitmentDto["status"] } : {},
        filter.accountId ? { accountId: filter.accountId } : {},
      ],
    },
    include,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 1000,
  });
  const rank = (c: Row) => (c.status === "open" ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b)).map(toDto);
}

async function assertMember(orgId: string, userId: string | null) {
  if (!userId) return;
  if ((await prisma.membership.count({ where: { orgId, userId } })) === 0) {
    throw new HttpError(400, "The owner must be a member of this organization");
  }
}

async function findVisible(actor: OrgActor, id: string) {
  const c = await prisma.extractedItem.findFirst({ where: { AND: [visibleCommitmentsWhere(actor), { id }] } });
  if (!c) throw new HttpError(404, "Not found");
  return c;
}

export async function createCommitment(actor: OrgActor, input: CommitmentInput) {
  if (!(await canSeeAccount(actor, input.accountId))) throw new HttpError(404, "Account not found");
  await assertMember(actor.orgId, input.ownerUserId);
  const c = await prisma.extractedItem.create({
    data: {
      orgId: actor.orgId,
      accountId: input.accountId,
      type: input.type ?? "commitment",
      summary: input.summary,
      details: input.notes ? { notes: input.notes } : {},
      madeBy: input.madeBy,
      ownerUserId: input.ownerUserId,
      dueDate: toDate(input.dueDate),
      status: input.status,
      origin: "manual",
      createdById: actor.userId,
    },
    include,
  });
  return toDto(c);
}

export async function updateCommitment(actor: OrgActor, id: string, input: Partial<CommitmentInput>) {
  const existing = await findVisible(actor, id);
  if (input.accountId && input.accountId !== existing.accountId && !(await canSeeAccount(actor, input.accountId))) {
    throw new HttpError(404, "Account not found");
  }
  if (input.ownerUserId !== undefined) await assertMember(actor.orgId, input.ownerUserId);
  const details = existing.details as Record<string, unknown>;
  const c = await prisma.extractedItem.update({
    where: { id },
    data: {
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.notes !== undefined ? { details: { ...details, notes: input.notes } } : {}),
      ...(input.madeBy !== undefined ? { madeBy: input.madeBy } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: toDate(input.dueDate) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    include,
  });
  if (input.status === "fulfilled" && existing.status !== "fulfilled") {
    await closeFlagsForCommitment(prisma, actor.orgId, id, "Marked fulfilled");
    return toDto({ ...c, flags: [] });
  }
  return toDto(c);
}

export async function deleteCommitment(actor: OrgActor, id: string) {
  await findVisible(actor, id);
  await prisma.extractedItem.update({ where: { id }, data: { deletedAt: new Date() } });
  await closeFlagsForCommitment(prisma, actor.orgId, id, "Commitment deleted");
}

/**
 * Imports commitments from a spreadsheet. The account column holds a name or an email domain,
 * matched against accounts the importer can see. Re-importing the same account + commitment +
 * due date updates it instead of duplicating.
 */
export async function importCommitments(actor: OrgActor, rows: (CommitmentImportRow & { row: number })[]): Promise<ImportResultDto> {
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, `Import at most ${MAX_IMPORT_ROWS} rows at a time`);
  const accounts = await prisma.account.findMany({ where: visibleAccountsWhere(actor), select: { id: true, name: true, domain: true } });
  const byName = new Map<string, string[]>();
  const byDomain = new Map<string, string>();
  for (const a of accounts) {
    const key = a.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), a.id]);
    if (a.domain) byDomain.set(a.domain.toLowerCase(), a.id);
  }
  const owners = await membersByEmail(actor.orgId);
  const result: ImportResultDto = { created: 0, updated: 0, errors: [] };

  for (const r of rows) {
    const key = r.account.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    const named = byName.get(key) ?? [];
    if (named.length > 1) {
      result.errors.push({ row: r.row, message: `Several accounts are named "${r.account}"; use the domain instead` });
      continue;
    }
    const accountId = byDomain.get(key) ?? named[0];
    if (!accountId) {
      result.errors.push({ row: r.row, message: `No account "${r.account}" that you can see` });
      continue;
    }
    const ownerUserId = r.ownerEmail ? owners.get(r.ownerEmail) : null;
    if (r.ownerEmail && !ownerUserId) {
      result.errors.push({ row: r.row, message: `No member with email ${r.ownerEmail}` });
      continue;
    }
    const dueDate = toDate(r.dueDate);
    const existing = await prisma.extractedItem.findFirst({
      where: { orgId: actor.orgId, type: "commitment", deletedAt: null, accountId, summary: r.summary, dueDate },
      select: { id: true },
    });
    const data = { status: r.status, madeBy: r.madeBy, ...(ownerUserId ? { ownerUserId } : {}) };
    if (existing) {
      await prisma.extractedItem.update({ where: { id: existing.id }, data });
      result.updated++;
    } else {
      await prisma.extractedItem.create({
        data: { orgId: actor.orgId, accountId, type: "commitment", summary: r.summary, dueDate, origin: "import", createdById: actor.userId, ...data },
      });
      result.created++;
    }
  }
  return result;
}

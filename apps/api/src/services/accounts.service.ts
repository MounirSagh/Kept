import type { Account, Prisma } from "@kept/db";
import {
  CRM_SYNCED_FIELDS, can,
  type AccountDto, type AccountImportRow, type AccountInput, type CompaniesQuery, type ImportResultDto, type PageDto,
} from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { rematchOrg } from "../lib/queues.js";
import type { OrgActor } from "../types/express.js";

/**
 * Which accounts an actor may see:
 * - owners and platform admins: every account in the org
 * - managers: accounts they own or were added to, plus accounts owned by anyone on their team
 * - members: accounts they own or were added to
 */
export function visibleAccountsWhere(actor: OrgActor): Prisma.AccountWhereInput {
  const base = { orgId: actor.orgId, deletedAt: null };
  if (actor.isPlatformAdmin || actor.role === "owner") return base;

  const reachable: Prisma.AccountWhereInput[] = [
    { ownerUserId: actor.userId },
    { members: { some: { userId: actor.userId } } },
  ];
  if (actor.role === "manager" && actor.teamId !== null) {
    reachable.push({ owner: { memberships: { some: { orgId: actor.orgId, teamId: actor.teamId } } } });
  }
  return { ...base, OR: reachable };
}

/** Contacts still active, counted with each account. */
const withContactCount = { _count: { select: { contacts: { where: { deletedAt: null } } } } } satisfies Prisma.AccountInclude;

function toDto(account: Account & { _count?: { contacts: number } }): AccountDto {
  const a = account;
  return {
    id: a.id,
    name: a.name,
    domain: a.domain,
    source: a.crmExternalId?.split(":")[0] ?? null,
    ownerUserId: a.ownerUserId,
    // BigInt doesn't survive JSON.stringify
    annualValueCents: a.annualValueCents?.toString() ?? null,
    currency: a.currency,
    renewalDate: a.renewalDate?.toISOString().slice(0, 10) ?? null,
    healthScore: a.healthScore,
    industry: a.industry,
    companyType: a.companyType,
    description: a.description,
    employeeCount: a.employeeCount,
    annualRevenueCents: a.annualRevenueCents?.toString() ?? null,
    city: a.city,
    region: a.region,
    postalCode: a.postalCode,
    country: a.country,
    timezone: a.timezone,
    linkedinUrl: a.linkedinUrl,
    contactCount: a._count?.contacts ?? 0,
  };
}

const cents = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : BigInt(v));

/**
 * The columns an input sets. Fields left out of the input are left alone. For accounts a CRM
 * imported, the fields it syncs are skipped: the next sync would overwrite them anyway.
 */
function accountData(input: AccountInput, crmLinked: boolean): Prisma.AccountUncheckedUpdateInput {
  const data: Prisma.AccountUncheckedUpdateInput = {
    name: input.name,
    domain: normalizeDomain(input.domain),
    ownerUserId: input.ownerUserId,
    industry: input.industry,
    companyType: input.companyType,
    description: input.description,
    employeeCount: input.employeeCount,
    annualRevenueCents: cents(input.annualRevenueCents),
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    country: input.country,
    timezone: input.timezone,
    linkedinUrl: input.linkedinUrl,
    renewalDate: input.renewalDate === undefined ? undefined : input.renewalDate && new Date(`${input.renewalDate}T00:00:00Z`),
    annualValueCents: cents(input.annualValueCents),
    currency: input.currency,
  };
  if (crmLinked) for (const field of CRM_SYNCED_FIELDS) delete (data as Record<string, unknown>)[field];
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

export async function listAccounts(actor: OrgActor) {
  const accounts = await prisma.account.findMany({
    where: visibleAccountsWhere(actor),
    include: withContactCount,
    orderBy: { name: "asc" },
  });
  return accounts.map(toDto);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One page of the Companies table: search, filters and sort are applied in the database. */
export async function listAccountsPage(actor: OrgActor, query: Required<Pick<CompaniesQuery, "page" | "pageSize" | "sort" | "dir">> & CompaniesQuery): Promise<PageDto<AccountDto>> {
  const q = query.q?.trim();
  const today = new Date(new Date().toISOString().slice(0, 10));
  const filters: Prisma.AccountWhereInput[] = [visibleAccountsWhere(actor)];
  if (q) {
    filters.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { domain: { contains: q, mode: "insensitive" } },
        { industry: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (query.owner) filters.push({ ownerUserId: query.owner === "none" ? null : query.owner });
  if (query.source) filters.push({ crmExternalId: query.source === "crm" ? { not: null } : null });
  if (query.type) filters.push({ companyType: query.type });
  if (query.renewal === "passed") filters.push({ renewalDate: { lt: today } });
  else if (query.renewal) {
    const days = query.renewal === "30d" ? 30 : 90;
    filters.push({ renewalDate: { gte: today, lte: new Date(today.getTime() + days * DAY_MS) } });
  }

  const dir = query.dir;
  const order: Record<NonNullable<CompaniesQuery["sort"]>, Prisma.AccountOrderByWithRelationInput> = {
    name: { name: dir },
    contactCount: { contacts: { _count: dir } },
    annualValue: { annualValueCents: { sort: dir, nulls: "last" } },
    renewalDate: { renewalDate: { sort: dir, nulls: "last" } },
    createdAt: { createdAt: dir },
  };
  const where = { AND: filters };
  const [items, total] = await Promise.all([
    prisma.account.findMany({
      where,
      include: withContactCount,
      // Name then id break ties, so rows never repeat or vanish between pages.
      orderBy: [order[query.sort], { name: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.account.count({ where }),
  ]);
  return { items: items.map(toDto), total, page: query.page, pageSize: query.pageSize };
}

export async function getAccount(actor: OrgActor, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { AND: [visibleAccountsWhere(actor), { id: accountId }] },
    include: withContactCount,
  });
  return account && toDto(account);
}

export async function canSeeAccount(actor: OrgActor, accountId: string) {
  const count = await prisma.account.count({
    where: { AND: [visibleAccountsWhere(actor), { id: accountId }] },
  });
  return count > 0;
}

/**
 * Who can read a synced item:
 * - matched items follow their account's visibility (visibleAccountsWhere);
 * - unmatched items from a member's own account (mailbox, calendar) stay private to that member;
 * - unmatched items from workspace tools (Slack, Linear...) are visible to owners only, for review.
 * Every reader of source_items must filter with this.
 */
export function visibleSourceItemsWhere(actor: OrgActor): Prisma.SourceItemWhereInput {
  const own: Prisma.SourceItemWhereInput = { visibleToUserId: actor.userId };
  const matched: Prisma.SourceItemWhereInput = { matchStatus: "matched", account: visibleAccountsWhere(actor) };
  const forReview: Prisma.SourceItemWhereInput[] = can(actor, { action: "org.manage" }) ? [{ visibleToUserId: null }] : [];
  return { orgId: actor.orgId, deletedAt: null, OR: [own, matched, ...forReview] };
}

function normalizeDomain(value: string | null): string | null {
  const d = value?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:].*$/, "");
  return d || null;
}

async function assertOwnerIsMember(orgId: string, ownerUserId: string | null) {
  if (!ownerUserId) return;
  const member = await prisma.membership.count({ where: { orgId, userId: ownerUserId } });
  if (member === 0) throw new HttpError(400, "The owner must be a member of this organization");
}

function assertCanManage(actor: OrgActor) {
  if (!can(actor, { action: "account.manage" })) throw new HttpError(403, "Forbidden");
}

export async function createAccount(actor: OrgActor, input: AccountInput) {
  assertCanManage(actor);
  await assertOwnerIsMember(actor.orgId, input.ownerUserId);
  const account = await prisma.account.create({
    data: { ...(accountData(input, false) as Omit<Prisma.AccountUncheckedCreateInput, "orgId">), orgId: actor.orgId },
    include: withContactCount,
  });
  await rematchOrg(actor.orgId);
  return toDto(account);
}

export async function updateAccount(actor: OrgActor, accountId: string, input: AccountInput) {
  assertCanManage(actor);
  await assertOwnerIsMember(actor.orgId, input.ownerUserId);
  const existing = await prisma.account.findFirst({ where: { id: accountId, orgId: actor.orgId, deletedAt: null } });
  if (!existing) throw new HttpError(404, "Not found");
  const account = await prisma.account.update({
    where: { id: accountId },
    data: accountData(input, existing.crmExternalId !== null),
    include: withContactCount,
  });
  if (account.domain !== existing.domain) await rematchOrg(actor.orgId);
  return toDto(account);
}

/** Soft delete: the account disappears and its items are routed again (usually to unmatched). */
export async function deleteAccount(actor: OrgActor, accountId: string) {
  assertCanManage(actor);
  const result = await prisma.account.updateMany({
    where: { id: accountId, orgId: actor.orgId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new HttpError(404, "Not found");
  await prisma.sourceMapping.deleteMany({ where: { orgId: actor.orgId, accountId } });
  await rematchOrg(actor.orgId);
}

export const MAX_IMPORT_ROWS = 5000;

/** Members by lowercased email, to resolve owner columns in imports. */
export async function membersByEmail(orgId: string) {
  const members = await prisma.membership.findMany({ where: { orgId }, select: { userId: true, user: { select: { email: true } } } });
  return new Map(members.map((m) => [m.user.email.toLowerCase(), m.userId]));
}

/**
 * Creates or updates accounts from a spreadsheet. A row updates an existing account with the
 * same domain, else the same name (case-insensitive); otherwise it creates one.
 */
export async function importAccounts(actor: OrgActor, rows: (AccountImportRow & { row: number })[]): Promise<ImportResultDto> {
  assertCanManage(actor);
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, `Import at most ${MAX_IMPORT_ROWS} rows at a time`);
  const owners = await membersByEmail(actor.orgId);
  const result: ImportResultDto = { created: 0, updated: 0, errors: [] };

  for (const r of rows) {
    const ownerUserId = r.ownerEmail ? owners.get(r.ownerEmail) : null;
    if (r.ownerEmail && !ownerUserId) {
      result.errors.push({ row: r.row, message: `No member with email ${r.ownerEmail}` });
      continue;
    }
    const domain = normalizeDomain(r.domain);
    const existing =
      (domain ? await prisma.account.findFirst({ where: { orgId: actor.orgId, deletedAt: null, domain } }) : null) ??
      (await prisma.account.findFirst({ where: { orgId: actor.orgId, deletedAt: null, name: { equals: r.name, mode: "insensitive" } } }));
    // Only columns present in the file overwrite existing values.
    const data = {
      name: r.name,
      ...(domain ? { domain } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(r.renewalDate ? { renewalDate: new Date(`${r.renewalDate}T00:00:00Z`) } : {}),
      ...(r.annualValue !== null ? { annualValueCents: BigInt(Math.round(r.annualValue * 100)) } : {}),
      ...(r.currency ? { currency: r.currency } : {}),
    };
    if (existing) {
      await prisma.account.update({ where: { id: existing.id }, data });
      result.updated++;
    } else {
      await prisma.account.create({ data: { orgId: actor.orgId, ...data } });
      result.created++;
    }
  }
  if (result.created + result.updated > 0) await rematchOrg(actor.orgId);
  return result;
}

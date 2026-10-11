import type { Account, Prisma } from "@kept/db";
import { prisma } from "../lib/prisma.js";
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

function toDto(account: Account) {
  const { id, name, domain, ownerUserId, annualValueCents, currency, renewalDate, healthScore } = account;
  return {
    id,
    name,
    domain,
    ownerUserId,
    // BigInt doesn't survive JSON.stringify
    annualValueCents: annualValueCents?.toString() ?? null,
    currency,
    renewalDate,
    healthScore,
  };
}

export async function listAccounts(actor: OrgActor) {
  const accounts = await prisma.account.findMany({
    where: visibleAccountsWhere(actor),
    orderBy: { name: "asc" },
  });
  return accounts.map(toDto);
}

export async function getAccount(actor: OrgActor, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { AND: [visibleAccountsWhere(actor), { id: accountId }] },
  });
  return account && toDto(account);
}

export async function canSeeAccount(actor: OrgActor, accountId: string) {
  const count = await prisma.account.count({
    where: { AND: [visibleAccountsWhere(actor), { id: accountId }] },
  });
  return count > 0;
}

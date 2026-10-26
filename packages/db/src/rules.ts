// Rules both the API and the worker apply to the database, kept in one place so they can't drift.

import type { Prisma, PrismaClient } from "./generated/prisma/client.js";

/** Who is looking: their org, role and team. Structurally the same as the API's actor. */
export interface Viewer {
  orgId: string;
  userId: string;
  role: "owner" | "manager" | "member" | null;
  teamId: string | null;
  isPlatformAdmin: boolean;
}

/**
 * Which accounts a viewer may see:
 * - owners and platform admins: every account in the org
 * - managers: accounts they own or were added to, plus accounts owned by anyone on their team
 * - members: accounts they own or were added to
 */
export function visibleAccountsWhere(viewer: Viewer): Prisma.AccountWhereInput {
  const base = { orgId: viewer.orgId, deletedAt: null };
  if (viewer.isPlatformAdmin || viewer.role === "owner") return base;

  const reachable: Prisma.AccountWhereInput[] = [
    { ownerUserId: viewer.userId },
    { members: { some: { userId: viewer.userId } } },
  ];
  if (viewer.role === "manager" && viewer.teamId !== null) {
    reachable.push({ owner: { memberships: { some: { orgId: viewer.orgId, teamId: viewer.teamId } } } });
  }
  return { ...base, OR: reachable };
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * A promise that was kept, replaced or removed no longer needs its flags: they're resolved with
 * the reason, and their suggestions still waiting for a decision are withdrawn.
 */
export async function closeFlagsForCommitment(db: Db, orgId: string, extractedItemId: string, reason: string) {
  const open = await db.flag.findMany({
    where: { orgId, extractedItemId, status: { in: ["open", "confirmed"] } },
    select: { id: true },
  });
  if (open.length === 0) return 0;
  const ids = open.map((f) => f.id);
  const now = new Date();
  await db.flag.updateMany({ where: { id: { in: ids } }, data: { status: "resolved", resolvedAt: now, resolutionNote: reason } });
  await db.proposedAction.updateMany({
    where: { flagId: { in: ids }, status: "pending" },
    data: { status: "rejected", decidedAt: now, decisionNote: reason },
  });
  return ids.length;
}

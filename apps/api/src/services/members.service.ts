import { can, validateMemberTarget, type MemberTarget, type OrgRole } from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import type { OrgActor } from "../types/express.js";
import { assertTeamInOrg } from "./teams.service.js";

export async function listMembers(orgId: string) {
  const memberships = await prisma.membership.findMany({
    where: { orgId },
    include: { user: { select: { email: true, fullName: true, avatarUrl: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => ({
    userId: m.userId,
    ...m.user,
    role: m.role,
    teamId: m.teamId,
    joinedAt: m.joinedAt,
  }));
}

async function findTarget(orgId: string, userId: string): Promise<MemberTarget> {
  const membership = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!membership) throw new HttpError(404, "Not found");
  return { userId, role: membership.role, teamId: membership.teamId };
}

/** An org must always keep at least one owner. */
async function assertNotLastOwner(orgId: string, target: MemberTarget) {
  if (target.role !== "owner") return;
  const owners = await prisma.membership.count({ where: { orgId, role: "owner" } });
  if (owners <= 1) throw new HttpError(409, "An organization needs at least one owner");
}

export async function updateMember(
  actor: OrgActor,
  userId: string,
  changes: { role?: OrgRole; teamId?: string | null },
) {
  const target = await findTarget(actor.orgId, userId);
  const next: MemberTarget = {
    userId,
    role: changes.role ?? target.role,
    teamId: changes.teamId === undefined ? target.teamId : changes.teamId,
  };
  if (!can(actor, { action: "member.update", target, next })) throw new HttpError(403, "Forbidden");
  const invalid = validateMemberTarget(next);
  if (invalid) throw new HttpError(400, invalid);
  await assertTeamInOrg(actor.orgId, next.teamId);
  if (next.role !== "owner") await assertNotLastOwner(actor.orgId, target);

  await prisma.membership.update({
    where: { orgId_userId: { orgId: actor.orgId, userId } },
    data: { role: next.role, teamId: next.teamId },
  });
}

export async function removeMember(actor: OrgActor, userId: string) {
  const target = await findTarget(actor.orgId, userId);
  if (!can(actor, { action: "member.remove", target })) throw new HttpError(403, "Forbidden");
  await assertNotLastOwner(actor.orgId, target);
  await prisma.membership.delete({ where: { orgId_userId: { orgId: actor.orgId, userId } } });
}

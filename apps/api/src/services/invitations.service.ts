import { createHash, randomBytes } from "node:crypto";
import { Prisma, type Invitation, type User } from "@kept/db";
import { can, validateMemberTarget, type MemberTarget } from "@kept/shared";
import { env } from "../env.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import type { OrgActor } from "../types/express.js";
import { assertTeamInOrg } from "./teams.service.js";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toDto(invitation: Invitation) {
  const { id, email, role, teamId, expiresAt, createdAt } = invitation;
  return { id, email, role, teamId, expiresAt, createdAt };
}

/** Owners see every pending invitation; managers see the ones into their own team. */
export async function listInvitations(actor: OrgActor) {
  const seesAll = can(actor, { action: "team.manage" });
  if (!seesAll && actor.teamId === null) return [];
  const invitations = await prisma.invitation.findMany({
    where: {
      orgId: actor.orgId,
      status: "pending",
      expiresAt: { gt: new Date() },
      ...(seesAll ? {} : { teamId: actor.teamId }),
    },
    orderBy: { createdAt: "desc" },
  });
  return invitations.map(toDto);
}

export async function createInvitation(actor: OrgActor, email: string, target: MemberTarget) {
  if (!can(actor, { action: "invitation.create", target })) throw new HttpError(403, "Forbidden");
  const invalid = validateMemberTarget(target);
  if (invalid) throw new HttpError(400, invalid);
  await assertTeamInOrg(actor.orgId, target.teamId);

  const alreadyMember = await prisma.membership.count({
    where: { orgId: actor.orgId, user: { email } },
  });
  if (alreadyMember > 0) throw new HttpError(409, "That person is already a member");

  const pending = await prisma.invitation.count({
    where: { orgId: actor.orgId, email, status: "pending", expiresAt: { gt: new Date() } },
  });
  if (pending > 0) throw new HttpError(409, "That person already has a pending invitation");

  const token = randomBytes(32).toString("base64url");
  const invitation = await prisma.invitation.create({
    data: {
      orgId: actor.orgId,
      email,
      role: target.role,
      teamId: target.teamId,
      tokenHash: hashToken(token),
      invitedById: actor.userId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
  const acceptUrl = new URL("/invite", env.WEB_ORIGIN);
  acceptUrl.searchParams.set("token", token);
  return { ...toDto(invitation), acceptUrl: acceptUrl.toString() };
}

export async function revokeInvitation(actor: OrgActor, invitationId: string) {
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, orgId: actor.orgId, status: "pending" },
  });
  if (!invitation) throw new HttpError(404, "Not found");
  const target = { role: invitation.role, teamId: invitation.teamId };
  if (!can(actor, { action: "invitation.revoke", target })) throw new HttpError(403, "Forbidden");
  await prisma.invitation.updateMany({
    where: { id: invitationId, status: "pending" },
    data: { status: "revoked" },
  });
}

export async function acceptInvitation(user: User, token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { org: { select: { id: true, name: true, slug: true } } },
  });
  if (!invitation || invitation.status !== "pending") throw new HttpError(404, "Invitation not found");
  if (invitation.expiresAt <= new Date()) {
    await prisma.invitation.updateMany({
      where: { id: invitation.id, status: "pending" },
      data: { status: "expired" },
    });
    throw new HttpError(410, "Invitation has expired");
  }
  if (invitation.email !== user.email) {
    throw new HttpError(403, "This invitation was sent to a different email address");
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Claiming the invitation first makes a double accept fail cleanly.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: "pending" },
        data: { status: "accepted", acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw new HttpError(404, "Invitation not found");
      await tx.membership.create({
        data: {
          orgId: invitation.orgId,
          userId: user.id,
          role: invitation.role,
          teamId: invitation.teamId,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "You are already a member of this organization");
    }
    throw err;
  }
  return { org: invitation.org, role: invitation.role, teamId: invitation.teamId };
}

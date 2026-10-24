import { createHash, randomBytes } from "node:crypto";
import { Prisma, type Invitation, type User } from "@kept/db";
import { can, validateMemberTarget, type ImportResultDto, type MemberTarget, type OrgRole } from "@kept/shared";
import { invitationEmail } from "../emails/invitation.js";
import { env } from "../env.js";
import { HttpError } from "../lib/http-error.js";
import { queueEmail } from "../lib/mailer.js";
import { prisma } from "../lib/prisma.js";
import type { OrgActor } from "../types/express.js";
import { assertTeamInOrg } from "./teams.service.js";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  const acceptUrl = new URL("/invite", env.WEB_ORIGIN);
  acceptUrl.searchParams.set("token", token);
  return { tokenHash: hashToken(token), acceptUrl: acceptUrl.toString() };
}

/** Queues the invite email for the worker. Never throws: if it can't be queued, the inviter shares the link. */
async function emailInvitation(invitation: Invitation, acceptUrl: string, inviterId: string) {
  const [org, inviter, team] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: invitation.orgId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: inviterId }, select: { fullName: true, email: true } }),
    invitation.teamId ? prisma.team.findUnique({ where: { id: invitation.teamId }, select: { name: true } }) : null,
  ]);
  return queueEmail(
    invitationEmail({
      to: invitation.email,
      orgName: org.name,
      inviterName: inviter?.fullName ?? inviter?.email ?? "Someone",
      role: invitation.role,
      teamName: team?.name ?? null,
      acceptUrl,
      expiresAt: invitation.expiresAt,
    }),
  );
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

  const { tokenHash, acceptUrl } = newToken();
  const invitation = await prisma.invitation.create({
    data: {
      orgId: actor.orgId,
      email,
      role: target.role,
      teamId: target.teamId,
      tokenHash,
      invitedById: actor.userId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
  const emailQueued = await emailInvitation(invitation, acceptUrl, actor.userId);
  return { ...toDto(invitation), acceptUrl, emailQueued };
}

/**
 * Issues a new link for a pending invitation, emailing it unless `email` is false (when the
 * inviter wants to share the link themselves). Only the token's hash is stored, so the old
 * link can't be recovered: the new one replaces it (the old one stops working) and the
 * expiry restarts.
 */
export async function resendInvitation(actor: OrgActor, invitationId: string, opts: { email?: boolean } = {}) {
  const existing = await prisma.invitation.findFirst({
    where: { id: invitationId, orgId: actor.orgId, status: "pending" },
  });
  if (!existing) throw new HttpError(404, "Not found");
  const target = { role: existing.role, teamId: existing.teamId };
  if (!can(actor, { action: "invitation.create", target })) throw new HttpError(403, "Forbidden");

  const { tokenHash, acceptUrl } = newToken();
  const invitation = await prisma.invitation.update({
    where: { id: invitationId },
    data: { tokenHash, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
  });
  const emailQueued = opts.email === false ? false : await emailInvitation(invitation, acceptUrl, actor.userId);
  return { ...toDto(invitation), acceptUrl, emailQueued };
}

/**
 * Bulk invitations from a spreadsheet. Each row goes through the same checks as a single
 * invite (permissions, team, existing member, pending invite); failures are reported per row.
 * A manager's blank team means their own team.
 */
export async function importInvitations(
  actor: OrgActor,
  rows: { row: number; email: string; role: OrgRole; team: string | null }[],
): Promise<ImportResultDto> {
  if (rows.length > 1000) throw new HttpError(400, "Invite at most 1,000 people at a time");
  const teams = await prisma.team.findMany({ where: { orgId: actor.orgId }, select: { id: true, name: true } });
  const teamByName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
  const isManager = actor.role === "manager" && !actor.isPlatformAdmin;
  const result: ImportResultDto = { created: 0, updated: 0, errors: [] };

  for (const r of rows) {
    let teamId: string | null = null;
    if (r.team) {
      const id = teamByName.get(r.team.trim().toLowerCase());
      if (!id) {
        result.errors.push({ row: r.row, message: `No team named "${r.team}"` });
        continue;
      }
      teamId = id;
    } else if (isManager) {
      teamId = actor.teamId;
    }
    try {
      await createInvitation(actor, r.email, { role: r.role, teamId });
      result.created++;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      const message =
        err.status === 403
          ? isManager
            ? "Managers can only invite members into their own team"
            : "You can't send this invitation"
          : err.message;
      result.errors.push({ row: r.row, message });
    }
  }
  return result;
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

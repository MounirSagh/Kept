import { Prisma } from "@kept/db";
import type { ImportResultDto } from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";

const teamSelect = { id: true, name: true } as const;

function rethrowDuplicateName(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new HttpError(409, "A team with that name already exists");
  }
  throw err;
}

export function listTeams(orgId: string) {
  return prisma.team.findMany({ where: { orgId }, select: teamSelect, orderBy: { name: "asc" } });
}

/** Throws 400 unless `teamId` is null or a team in `orgId`. */
export async function assertTeamInOrg(orgId: string, teamId: string | null) {
  if (teamId === null) return;
  const count = await prisma.team.count({ where: { id: teamId, orgId } });
  if (count === 0) throw new HttpError(400, "Unknown team");
}

export function createTeam(orgId: string, name: string) {
  return prisma.team.create({ data: { orgId, name }, select: teamSelect }).catch(rethrowDuplicateName);
}

export async function renameTeam(orgId: string, teamId: string, name: string) {
  await assertTeamExists(orgId, teamId);
  return prisma.team
    .update({ where: { id: teamId }, data: { name }, select: teamSelect })
    .catch(rethrowDuplicateName);
}

/** Refuses while people are still on the team; pending invitations into it are revoked. */
export async function deleteTeam(orgId: string, teamId: string) {
  await assertTeamExists(orgId, teamId);
  await prisma.$transaction(async (tx) => {
    const members = await tx.membership.count({ where: { teamId } });
    if (members > 0) throw new HttpError(409, "Move this team's members to another team first");
    await tx.invitation.updateMany({
      where: { teamId, status: "pending" },
      data: { status: "revoked", teamId: null },
    });
    await tx.invitation.updateMany({ where: { teamId }, data: { teamId: null } });
    await tx.team.delete({ where: { id: teamId } });
  });
}

async function assertTeamExists(orgId: string, teamId: string) {
  const count = await prisma.team.count({ where: { id: teamId, orgId } });
  if (count === 0) throw new HttpError(404, "Not found");
}

/** Creates the teams that don't exist yet (by name, case-insensitive); existing ones are left as they are. */
export async function importTeams(orgId: string, rows: { row: number; name: string }[]): Promise<ImportResultDto> {
  if (rows.length > 1000) throw new HttpError(400, "Import at most 1,000 teams at a time");
  const existing = new Set((await prisma.team.findMany({ where: { orgId }, select: { name: true } })).map((t) => t.name.trim().toLowerCase()));
  const result: ImportResultDto = { created: 0, updated: 0, unchanged: 0, errors: [] };
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (existing.has(key)) {
      result.unchanged!++;
      continue;
    }
    await prisma.team.create({ data: { orgId, name: r.name.trim() } });
    existing.add(key);
    result.created++;
  }
  return result;
}

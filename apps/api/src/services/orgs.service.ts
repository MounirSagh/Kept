import type { Prisma } from "@kept/db";
import type { OrgDetailsDto, OrgProfile } from "@kept/shared";
import { prisma } from "../lib/prisma.js";

export function createOrganization(ownerUserId: string, name: string, slug: string) {
  return prisma.organization.create({
    data: {
      name,
      slug,
      memberships: { create: { userId: ownerUserId, role: "owner" } },
    },
  });
}

/** The org's settings JSON holds the profile under "profile", next to future settings. */
function profileOf(settings: Prisma.JsonValue): OrgProfile {
  const s = settings as { profile?: OrgProfile } | null;
  return s?.profile ?? {};
}

export async function getOrganization(orgId: string): Promise<OrgDetailsDto> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true, slug: true, settings: true } });
  return { id: org.id, name: org.name, slug: org.slug, profile: profileOf(org.settings) };
}

export async function updateOrganization(orgId: string, changes: { name?: string; profile?: OrgProfile }): Promise<OrgDetailsDto> {
  const current = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const settings = { ...((current.settings as Record<string, unknown> | null) ?? {}) };
  if (changes.profile) settings.profile = changes.profile;
  await prisma.organization.update({
    where: { id: orgId },
    data: { ...(changes.name ? { name: changes.name } : {}), settings: settings as Prisma.InputJsonValue },
  });
  return getOrganization(orgId);
}

export function listMemberships(userId: string) {
  return prisma.membership.findMany({
    where: { userId },
    include: { org: { select: { id: true, name: true, slug: true } } },
    orderBy: { joinedAt: "asc" },
  });
}

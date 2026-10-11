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

export function renameOrganization(orgId: string, name: string) {
  return prisma.organization.update({
    where: { id: orgId },
    data: { name },
    select: { id: true, name: true, slug: true },
  });
}

export function listMemberships(userId: string) {
  return prisma.membership.findMany({
    where: { userId },
    include: { org: { select: { id: true, name: true, slug: true } } },
    orderBy: { joinedAt: "asc" },
  });
}

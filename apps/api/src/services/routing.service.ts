import { PROVIDERS, isProviderId } from "@kept/connectors";
import { can, type RoutingDto, type RoutingMappingInput } from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { rematchOrg } from "../lib/queues.js";
import type { OrgActor } from "../types/express.js";

function assertOwner(actor: OrgActor) {
  if (!can(actor, { action: "org.manage" })) throw new HttpError(403, "Forbidden");
}

/** What owners route by hand: containers seen in synced data, with their current mapping. */
export async function getRouting(actor: OrgActor): Promise<RoutingDto> {
  assertOwner(actor);
  const orgId = actor.orgId;
  const [statusCounts, groups, mappings, connections] = await Promise.all([
    prisma.sourceItem.groupBy({ by: ["matchStatus"], where: { orgId, deletedAt: null }, _count: { _all: true } }),
    prisma.sourceItem.groupBy({
      by: ["connectionId", "containerId", "containerLabel"],
      where: { orgId, deletedAt: null, containerId: { not: null } },
      _count: { _all: true },
      _max: { occurredAt: true },
    }),
    prisma.sourceMapping.findMany({ where: { orgId } }),
    prisma.connection.findMany({ where: { orgId }, select: { id: true, provider: true, label: true } }),
  ]);

  const connectionById = new Map(connections.map((c) => [c.id, c]));
  const mappingByKey = new Map(mappings.map((m) => [`${m.connectionId}:${m.containerId}`, m]));
  // A container's label can change (renamed channel); keep the most recent one per container.
  const containers = new Map<string, RoutingDto["containers"][number]>();
  for (const g of groups) {
    const connection = connectionById.get(g.connectionId);
    if (!connection || !isProviderId(connection.provider) || !g.containerId) continue;
    const key = `${g.connectionId}:${g.containerId}`;
    const lastActivityAt = (g._max.occurredAt ?? new Date(0)).toISOString();
    const existing = containers.get(key);
    const mapping = mappingByKey.get(key);
    containers.set(key, {
      connectionId: g.connectionId,
      provider: connection.provider,
      connectionLabel: connection.label ?? PROVIDERS[connection.provider].name,
      containerId: g.containerId,
      containerLabel: existing && existing.lastActivityAt > lastActivityAt ? existing.containerLabel : (g.containerLabel ?? g.containerId),
      itemCount: (existing?.itemCount ?? 0) + g._count._all,
      lastActivityAt: existing && existing.lastActivityAt > lastActivityAt ? existing.lastActivityAt : lastActivityAt,
      mapping: mapping ? { accountId: mapping.accountId, ignored: mapping.ignored } : null,
    });
  }

  return {
    counts: Object.fromEntries(statusCounts.map((s) => [s.matchStatus, s._count._all])),
    containers: [...containers.values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
  };
}

export async function setMapping(actor: OrgActor, connectionId: string, containerId: string, input: RoutingMappingInput) {
  assertOwner(actor);
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, orgId: actor.orgId }, select: { id: true } });
  if (!connection) throw new HttpError(404, "Not found");

  if (!input.accountId && !input.ignored) {
    await prisma.sourceMapping.deleteMany({ where: { connectionId, containerId } });
  } else {
    if (input.accountId) {
      const account = await prisma.account.count({ where: { id: input.accountId, orgId: actor.orgId, deletedAt: null } });
      if (account === 0) throw new HttpError(400, "Unknown account");
    }
    const sample = await prisma.sourceItem.findFirst({
      where: { connectionId, containerId },
      orderBy: { occurredAt: "desc" },
      select: { containerLabel: true },
    });
    const data = {
      accountId: input.ignored ? null : input.accountId,
      ignored: input.ignored,
      containerLabel: sample?.containerLabel ?? null,
      createdById: actor.userId,
    };
    await prisma.sourceMapping.upsert({
      where: { connectionId_containerId: { connectionId, containerId } },
      create: { orgId: actor.orgId, connectionId, containerId, ...data },
      update: data,
    });
  }
  await rematchOrg(actor.orgId);
}

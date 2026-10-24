import type { Connection, User } from "@kept/db";
import {
  OAuthError, PROVIDER_IDS, PROVIDERS, TOKEN_KEY_VERSION, authorizeUrl, connectionClient, encryptToken, exchangeCode,
  isProviderId, signState, verifyState, type ProviderId,
} from "@kept/connectors";
import { can, type Actor, type ConnectionDto, type ConnectionsDto } from "@kept/shared";
import { OAUTH_REDIRECT_URI, connectors } from "../lib/connectors.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { scheduleSync, syncNow, unscheduleSync } from "../lib/sync-schedule.js";
import type { OrgActor } from "../types/express.js";

/** A claim older than this belongs to a worker that died mid-sync. */
const SYNC_CLAIM_TTL_MS = 30 * 60 * 1000;

function definition(provider: string) {
  if (!isProviderId(provider)) throw new HttpError(404, "Unknown provider");
  return PROVIDERS[provider];
}

function toDto(c: Connection & { _count: { sourceItems: number } }): ConnectionDto {
  return {
    id: c.id,
    provider: c.provider as ProviderId,
    scope: c.ownerUserId ? "personal" : "org",
    label: c.label,
    status: c.status,
    ownerUserId: c.ownerUserId,
    connectedById: c.connectedById,
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    syncing: !!c.syncStartedAt && Date.now() - c.syncStartedAt.getTime() < SYNC_CLAIM_TTL_MS,
    lastError: c.lastError,
    itemCount: c._count.sourceItems,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Workspace connections plus the actor's own; owners also see every member's personal connections. */
export async function listConnections(actor: OrgActor): Promise<ConnectionsDto> {
  const seesAll = can(actor, { action: "org.manage" });
  const connections = await prisma.connection.findMany({
    where: {
      orgId: actor.orgId,
      provider: { in: PROVIDER_IDS },
      ...(seesAll ? {} : { OR: [{ ownerUserId: null }, { ownerUserId: actor.userId }] }),
    },
    include: { _count: { select: { sourceItems: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    providers: PROVIDER_IDS.map((id) => ({
      id,
      name: PROVIDERS[id].name,
      scope: PROVIDERS[id].scope,
      reads: PROVIDERS[id].reads,
      configured: !!connectors?.apps[id],
    })),
    connections: connections.map(toDto),
  };
}

/** Returns the provider's consent URL. The signed state ties the callback to this user and org. */
export function startAuthorization(actor: OrgActor, provider: string) {
  const def = definition(provider);
  if (!can(actor, { action: "connection.create", scope: def.scope })) throw new HttpError(403, "Forbidden");
  if (!connectors) throw new HttpError(503, "Connecting tools isn't set up on this server yet (TOKEN_ENCRYPTION_KEY is missing)");
  const app = connectors.apps[def.id];
  if (!app) throw new HttpError(503, `${def.name} isn't configured on this server yet`);
  const state = signState({ provider: def.id, orgId: actor.orgId, userId: actor.userId }, connectors.stateSecret);
  return { url: authorizeUrl(def, app, OAUTH_REDIRECT_URI, state) };
}

/**
 * Finishes OAuth: checks the state, exchanges the code, identifies the account, stores the
 * encrypted tokens and starts syncing. Must be called by the same user who started the flow,
 * so nobody can get a teammate to connect their mailbox to a different org.
 */
export async function completeAuthorization(user: User, code: string, stateToken: string) {
  if (!connectors) throw new HttpError(503, "Connecting tools isn't set up on this server");
  const state = verifyState(stateToken, connectors.stateSecret);
  if (!state) throw new HttpError(400, "This connection attempt expired. Try connecting again.");
  if (state.userId !== user.id) throw new HttpError(403, "This connection was started by someone else");

  const def = definition(state.provider);
  const app = connectors.apps[def.id];
  if (!app) throw new HttpError(503, `${def.name} isn't configured on this server`);

  // Re-check membership and permission: they may have changed during the consent screen.
  const membership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: state.orgId, userId: user.id } } });
  const actor: Actor = {
    userId: user.id,
    isPlatformAdmin: user.isPlatformAdmin,
    role: membership?.role ?? null,
    teamId: membership?.teamId ?? null,
  };
  if (!membership && !user.isPlatformAdmin) throw new HttpError(403, "You're no longer a member of this organization");
  if (!can(actor, { action: "connection.create", scope: def.scope })) throw new HttpError(403, "Forbidden");

  let exchanged;
  try {
    exchanged = await exchangeCode(def, app, code, OAUTH_REDIRECT_URI);
  } catch (err) {
    if (err instanceof OAuthError) throw new HttpError(400, err.message);
    throw err;
  }
  const { tokens, raw } = exchanged;
  const identity = await def.identify(connectionClient({ def, app, tokens, onTokens: async () => {} }), raw);
  const ownerUserId = def.scope === "personal" ? user.id : null;

  const existing = await prisma.connection.findUnique({
    where: { orgId_provider_externalAccountId: { orgId: state.orgId, provider: def.id, externalAccountId: identity.externalAccountId } },
  });
  if (existing?.ownerUserId && existing.ownerUserId !== user.id) {
    throw new HttpError(409, `${identity.label} is already connected by another member`);
  }

  const key = connectors.encryptionKey;
  const secrets = {
    label: identity.label,
    accessTokenEnc: encryptToken(tokens.accessToken, key),
    refreshTokenEnc: tokens.refreshToken ? encryptToken(tokens.refreshToken, key) : null,
    tokenKeyVersion: TOKEN_KEY_VERSION,
    tokenExpiresAt: tokens.expiresAt ?? null,
    scopes: tokens.scopes,
    status: "active" as const,
    lastError: null,
    connectedById: user.id,
  };
  const connection = await prisma.connection.upsert({
    where: { orgId_provider_externalAccountId: { orgId: state.orgId, provider: def.id, externalAccountId: identity.externalAccountId } },
    create: { orgId: state.orgId, provider: def.id, externalAccountId: identity.externalAccountId, ownerUserId, ...secrets },
    // Reconnecting keeps the sync cursors, so nothing is downloaded twice.
    update: secrets,
  });
  await scheduleSync(connection.id);

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: state.orgId }, select: { slug: true } });
  return { orgSlug: org.slug, provider: def.id, label: identity.label };
}

async function findManageable(actor: OrgActor, connectionId: string) {
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, orgId: actor.orgId } });
  if (!connection) throw new HttpError(404, "Not found");
  const scope = connection.ownerUserId ? "personal" : "org";
  if (!can(actor, { action: "connection.manage", scope, ownerUserId: connection.ownerUserId })) {
    throw new HttpError(403, "Forbidden");
  }
  return connection;
}

export async function syncConnection(actor: OrgActor, connectionId: string) {
  const connection = await findManageable(actor, connectionId);
  if (connection.status !== "active") throw new HttpError(409, "Reconnect this account before syncing");
  await syncNow(connection.id);
}

/**
 * Stops syncing and deletes everything synced from the connection (cascade).
 * TODO: once commitments are extracted, decide whether they outlive the source they cite.
 */
export async function removeConnection(actor: OrgActor, connectionId: string) {
  const connection = await findManageable(actor, connectionId);
  await unscheduleSync(connection.id);
  await prisma.connection.delete({ where: { id: connection.id } });
}

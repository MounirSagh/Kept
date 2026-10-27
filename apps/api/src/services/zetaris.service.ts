import { randomUUID } from "node:crypto";
import type { Prisma } from "@kept/db";
import {
  DATASET_PARAMS, TOKEN_KEY_VERSION, ZetarisError, accountParams, bindDataset, decodeZetarisSecret, decryptToken, encodeZetarisSecret,
  encryptToken, normalizeRestUrl, paramsProblem, readOnlyProblem, zetarisConfig, zetarisLogin, zetarisQuery, type ZetarisAuth, type ZetarisConfig,
} from "@kept/connectors";
import {
  can, type ZetarisConnectInput, type ZetarisDatasetDto, type ZetarisDatasetInput, type ZetarisDto, type ZetarisTestDto, type ZetarisTestInput,
} from "@kept/shared";
import { connectors } from "../lib/connectors.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import type { OrgActor } from "../types/express.js";

// Zetaris is connected once per org by an owner, with an API key (no OAuth). Owners also define
// the datasets the agents may query: read-only SQL, filtered to the company being reviewed.

/** One Zetaris connection per org. */
const EXTERNAL_ID = "zetaris";
const MAX_DATASETS = 20;
const TEST_ROWS = 20;

function assertOwner(actor: OrgActor) {
  if (!can(actor, { action: "org.manage" })) throw new HttpError(403, "Only owners manage Zetaris");
}

function encryptionKey(): string {
  if (!connectors) throw new HttpError(503, "Connecting tools isn't set up on this server yet (TOKEN_ENCRYPTION_KEY is missing)");
  return connectors.encryptionKey;
}

async function findConnection(orgId: string) {
  return prisma.connection.findFirst({ where: { orgId, provider: "zetaris" } });
}

async function loadConnected(orgId: string) {
  const connection = await findConnection(orgId);
  const config = connection ? zetarisConfig(connection.syncState) : null;
  if (!connection || !config || !connection.accessTokenEnc) throw new HttpError(409, "Connect Zetaris first");
  return { connection, config, auth: decodeZetarisSecret(decryptToken(connection.accessTokenEnc, encryptionKey())) };
}

async function saveConfig(connectionId: string, syncState: Prisma.JsonValue, config: ZetarisConfig) {
  const state = (syncState ?? {}) as Record<string, unknown>;
  await prisma.connection.update({ where: { id: connectionId }, data: { syncState: { ...state, zetaris: config } as unknown as Prisma.InputJsonValue } });
}

export async function getZetaris(actor: OrgActor): Promise<ZetarisDto> {
  assertOwner(actor);
  const connection = await findConnection(actor.orgId);
  const config = connection ? zetarisConfig(connection.syncState) : null;
  const auth = connection?.accessTokenEnc && connectors ? decodeZetarisSecret(decryptToken(connection.accessTokenEnc, connectors.encryptionKey)) : null;
  return {
    connected: !!connection && !!config && connection.status === "active",
    restUrl: config?.restUrl ?? null,
    zetarisOrgId: config?.orgId ?? null,
    signIn: !auth ? null : "apiKey" in auth ? "api_key" : "password",
    username: auth && "username" in auth ? auth.username : null,
    lastError: connection?.lastError ?? null,
    datasets: (config?.datasets ?? []).map(({ id, name, description, sql }): ZetarisDatasetDto => ({ id, name, description, sql })),
    params: [...DATASET_PARAMS],
  };
}

/** Saves the connection after checking it answers `SELECT 1` with these settings. */
export async function connectZetaris(actor: OrgActor, input: ZetarisConnectInput): Promise<ZetarisDto> {
  assertOwner(actor);
  const restUrl = normalizeRestUrl(input.restUrl);
  if (!/^https?:\/\/[^\s]+$/.test(restUrl)) throw new HttpError(400, "Enter the Zetaris address, starting with http:// or https://");
  const existing = await findConnection(actor.orgId);
  const stored = existing?.accessTokenEnc ? decodeZetarisSecret(decryptToken(existing.accessTokenEnc, encryptionKey())) : null;

  // A new API key, a new sign-in, or what's stored (when only the address or org changed).
  let auth: ZetarisAuth | null = null;
  if (input.apiKey?.trim()) auth = { apiKey: input.apiKey.trim() };
  else if (input.username?.trim() && input.password) auth = { username: input.username.trim(), password: input.password };
  else if (input.username?.trim() && stored && "username" in stored && stored.username === input.username.trim()) auth = stored;
  else if (!input.username?.trim() && stored && "apiKey" in stored) auth = stored;
  if (!auth) throw new HttpError(400, input.username?.trim() ? "Add the password" : "Add the API key, or sign in with an email and password");

  let orgId = input.zetarisOrgId?.trim() ?? "";
  if (orgId && !/^\d+$/.test(orgId)) throw new HttpError(400, "The organization id is a number (Management → Organisation in Zetaris)");
  try {
    if ("apiKey" in auth) {
      if (!orgId) throw new HttpError(400, "With an API key, add the organization id (Management → Organisation in Zetaris)");
    } else {
      // The sign-in says which organization the user belongs to.
      orgId ||= (await zetarisLogin(restUrl, auth, { timeoutMs: 20_000, fresh: true })).orgId;
    }
    await zetarisQuery({ restUrl, orgId }, auth, "SELECT 1", { limit: 1, timeoutMs: 30_000 });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, err instanceof ZetarisError ? err.message : `Zetaris didn't answer: ${(err as Error).message}`);
  }

  const config: ZetarisConfig = { restUrl, orgId, datasets: existing ? (zetarisConfig(existing.syncState)?.datasets ?? []) : [] };
  const data = {
    label: restUrl.replace(/^https?:\/\//, ""),
    accessTokenEnc: encryptToken(encodeZetarisSecret(auth), encryptionKey()),
    tokenKeyVersion: TOKEN_KEY_VERSION,
    scopes: [],
    status: "active" as const,
    lastError: null,
    connectedById: actor.userId,
    syncState: { zetaris: config } as unknown as Prisma.InputJsonValue,
  };
  if (existing) await prisma.connection.update({ where: { id: existing.id }, data });
  else await prisma.connection.create({ data: { orgId: actor.orgId, provider: "zetaris", externalAccountId: EXTERNAL_ID, ...data } });
  return getZetaris(actor);
}

/** Removes the connection and the data tables kept as evidence from it. */
export async function disconnectZetaris(actor: OrgActor) {
  assertOwner(actor);
  await prisma.connection.deleteMany({ where: { orgId: actor.orgId, provider: "zetaris" } });
}

function checkDataset(input: ZetarisDatasetInput): ZetarisDatasetInput {
  const name = input.name.trim();
  const description = input.description.trim();
  const sql = input.sql.trim();
  if (!name || name.length > 80) throw new HttpError(400, "Give the dataset a short name");
  if (!description || description.length > 500) throw new HttpError(400, "Describe what it shows and when it matters (the agents read this)");
  if (sql.length > 5000) throw new HttpError(400, "The query is too long");
  const problem = readOnlyProblem(sql) ?? paramsProblem(sql);
  if (problem) throw new HttpError(400, problem);
  return { name, description, sql };
}

export async function addDataset(actor: OrgActor, input: ZetarisDatasetInput): Promise<ZetarisDto> {
  assertOwner(actor);
  const { connection, config } = await loadConnected(actor.orgId);
  if (config.datasets.length >= MAX_DATASETS) throw new HttpError(400, `Up to ${MAX_DATASETS} datasets`);
  const dataset = { id: randomUUID(), ...checkDataset(input) };
  if (config.datasets.some((d) => d.name.toLowerCase() === dataset.name.toLowerCase())) throw new HttpError(409, "A dataset already has this name");
  await saveConfig(connection.id, connection.syncState, { ...config, datasets: [...config.datasets, dataset] });
  return getZetaris(actor);
}

export async function updateDataset(actor: OrgActor, datasetId: string, input: ZetarisDatasetInput): Promise<ZetarisDto> {
  assertOwner(actor);
  const { connection, config } = await loadConnected(actor.orgId);
  if (!config.datasets.some((d) => d.id === datasetId)) throw new HttpError(404, "Dataset not found");
  const checked = checkDataset(input);
  if (config.datasets.some((d) => d.id !== datasetId && d.name.toLowerCase() === checked.name.toLowerCase())) throw new HttpError(409, "A dataset already has this name");
  await saveConfig(connection.id, connection.syncState, { ...config, datasets: config.datasets.map((d) => (d.id === datasetId ? { ...d, ...checked } : d)) });
  return getZetaris(actor);
}

export async function deleteDataset(actor: OrgActor, datasetId: string): Promise<ZetarisDto> {
  assertOwner(actor);
  const { connection, config } = await loadConnected(actor.orgId);
  await saveConfig(connection.id, connection.syncState, { ...config, datasets: config.datasets.filter((d) => d.id !== datasetId) });
  // Its saved results go too.
  await prisma.sourceItem.deleteMany({ where: { connectionId: connection.id, externalId: { startsWith: `zetaris:${datasetId}:` } } });
  return getZetaris(actor);
}

/** Runs a dataset's SQL for one company, as the agents would, and returns the first rows. */
export async function testDataset(actor: OrgActor, input: ZetarisTestInput): Promise<ZetarisTestDto> {
  assertOwner(actor);
  const problem = readOnlyProblem(input.sql) ?? paramsProblem(input.sql);
  if (problem) throw new HttpError(400, problem);
  const { config, auth } = await loadConnected(actor.orgId);
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, orgId: actor.orgId, deletedAt: null },
    select: { id: true, name: true, domain: true, crmExternalId: true },
  });
  if (!account) throw new HttpError(404, "Company not found");
  const sql = bindDataset(input.sql, accountParams(account));
  if (!sql) return { sql: null, columns: [], rows: [], note: `${account.name} lacks a value this query needs (a domain, or a HubSpot id): it won't be queried for them.` };
  try {
    const result = await zetarisQuery(config, auth, sql, { limit: TEST_ROWS });
    return { sql, columns: result.columns, rows: result.rows, note: result.rows.length === 0 ? "No rows for this company." : null };
  } catch (err) {
    throw new HttpError(400, err instanceof ZetarisError ? err.message : (err as Error).message);
  }
}

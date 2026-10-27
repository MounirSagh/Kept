// Zetaris: the org's data harness. Kept runs read-only SQL through it, live, so the agents can
// check what the warehouse, billing or support systems say about a client while reviewing it.
// Two ways in:
//   - an API key and the organization id, on the engine's REST API (a URL ending in /api/v1.0,
//     POST /sql-editor/sqls/run) or the web app's proxy (POST /api/proxy/sql-editor/sqls/run-query)
//   - the email and password of a Zetaris user, signing in like the web app does
//     (POST /api/auth/login, which also gives the organization id), then querying through its proxy

import { randomUUID } from "node:crypto";

export interface ZetarisSettings {
  /** The engine's REST base (…/api/v1.0) or the web app's origin. */
  restUrl: string;
  /** Numeric id from Management → Organisation; with a sign-in, the one it reports. */
  orgId: string;
}

export interface ZetarisResult {
  columns: string[];
  rows: unknown[][];
}

export type ZetarisAuth = { apiKey: string } | { username: string; password: string };

export class ZetarisError extends Error {}

const DEFAULT_TIMEOUT_MS = 60_000;

export function normalizeRestUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const isEngineApi = (restUrl: string) => /\/api\/v1\.0$/.test(normalizeRestUrl(restUrl));

/** The web app (gateway) for a cluster address: https://api.<cluster>/api/v1.0 → https://new-ui.<cluster>. */
export function gatewayOrigin(restUrl: string): string {
  return normalizeRestUrl(restUrl)
    .replace(/\/api\/v1\.0$/, "")
    .replace(/\/login$/, "")
    .replace(/^(https?:\/\/)api\./, "$1new-ui.");
}

/** What's stored (encrypted) for a connection: an API key as is, or the sign-in as JSON. */
export function encodeZetarisSecret(auth: ZetarisAuth): string {
  return "apiKey" in auth ? auth.apiKey : JSON.stringify({ username: auth.username, password: auth.password });
}

export function decodeZetarisSecret(plain: string): ZetarisAuth {
  if (plain.startsWith("{")) {
    try {
      const v = JSON.parse(plain) as { username?: string; password?: string };
      if (v.username && v.password) return { username: v.username, password: v.password };
    } catch {
      // Not JSON: an API key that happens to start with a brace.
    }
  }
  return { apiKey: plain };
}

type Session = { token: string; orgId: string; expiresAt: number };
const sessions = new Map<string, Session>();
/** Sessions are renewed a little before the token says they end. */
const SESSION_MARGIN_MS = 60_000;
const DEFAULT_SESSION_MS = 30 * 60_000;

function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Signs in as a Zetaris user, like the web app. Returns a session token and the user's organization id. */
export async function zetarisLogin(
  restUrl: string,
  credentials: { username: string; password: string },
  opts: { fetch?: typeof fetch; timeoutMs?: number; fresh?: boolean } = {},
): Promise<Session> {
  const origin = gatewayOrigin(restUrl);
  const key = `${origin}|${credentials.username}`;
  const cached = sessions.get(key);
  if (!opts.fresh && cached && cached.expiresAt - SESSION_MARGIN_MS > Date.now()) return cached;

  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Request-ID": randomUUID() },
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ZetarisError(`Can't reach Zetaris at ${origin}: ${(err as Error).message}`);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Reported below.
  }
  if (!res.ok) throw new ZetarisError(`Zetaris refused the sign-in${typeof json.msg === "string" ? ` (${json.msg})` : ` (${res.status})`}`);
  const token = [json.idToken, json.token, json.accessToken].find((t): t is string => typeof t === "string" && t.length > 0);
  if (!token) throw new ZetarisError("Zetaris's sign-in didn't return a session");
  const claims = jwtClaims(token);
  const orgId = json.orgId ?? claims.orgId;
  if (orgId === undefined || orgId === null || orgId === "") throw new ZetarisError("Zetaris's sign-in didn't say which organization");
  const exp = typeof claims.exp === "number" ? claims.exp * 1000 : Date.now() + DEFAULT_SESSION_MS;
  const session = { token, orgId: String(orgId), expiresAt: exp };
  sessions.set(key, session);
  return session;
}

async function runSql(
  url: string,
  body: unknown,
  token: string,
  orgId: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number },
): Promise<{ status: number; text: string; html: boolean }> {
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Org-ID": orgId,
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ZetarisError(`Can't reach Zetaris at ${new URL(url).origin}: ${(err as Error).message}`);
  }
  return { status: res.status, text: await res.text(), html: (res.headers.get("content-type") ?? "").includes("text/html") };
}

/** Runs one SQL statement and returns its columns and rows (at most `limit`). */
export async function zetarisQuery(
  settings: ZetarisSettings,
  auth: string | ZetarisAuth,
  sql: string,
  opts: { limit?: number; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<ZetarisResult> {
  const credentials = typeof auth === "string" ? { apiKey: auth } : auth;
  const limit = opts.limit ?? 100;
  let out: { status: number; text: string; html: boolean };

  if ("apiKey" in credentials) {
    const base = normalizeRestUrl(settings.restUrl);
    const [url, body] = isEngineApi(base)
      ? [`${base}/sql-editor/sqls/run`, { queryId: randomUUID(), sql, source: "SqlEditor", limit }]
      : [`${base}/api/proxy/sql-editor/sqls/run-query`, { sql, limit }];
    out = await runSql(url, body, credentials.apiKey, settings.orgId, opts);
    if (out.status === 401 || out.status === 403) throw new ZetarisError("Zetaris refused the API key or organization id");
  } else {
    // Signed in: through the web app's proxy, as the web app does. A session that ended is renewed once.
    const url = `${gatewayOrigin(settings.restUrl)}/api/proxy/sql-editor/sqls/run-query`;
    let session = await zetarisLogin(settings.restUrl, credentials, opts);
    out = await runSql(url, { sql, limit }, session.token, settings.orgId || session.orgId, opts);
    if (out.status === 401) {
      session = await zetarisLogin(settings.restUrl, credentials, { ...opts, fresh: true });
      out = await runSql(url, { sql, limit }, session.token, settings.orgId || session.orgId, opts);
    }
    if (out.status === 401 || out.status === 403) throw new ZetarisError("Zetaris refused the session for this organization");
  }

  if (out.status < 200 || out.status >= 300) throw new ZetarisError(`Zetaris answered ${out.status}: ${out.text.slice(0, 300)}`);
  if (out.html) throw new ZetarisError("Zetaris answered with a web page: check the URL (the engine's …/api/v1.0, or the web app's address)");
  let json: unknown;
  try {
    json = out.text ? JSON.parse(out.text) : null;
  } catch {
    throw new ZetarisError("Zetaris didn't answer with JSON");
  }
  return parseResult(json, limit);
}

/** Zetaris answers `{ headers: [{ name }], data: [[...]] }`; older or proxied answers vary a little. */
export function parseResult(json: unknown, limit = Infinity): ZetarisResult {
  const root = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const holder = (Array.isArray(root.data) || Array.isArray(root.rows) ? root : (root.result ?? root.results ?? root)) as Record<string, unknown>;
  const raw = (Array.isArray(holder.data) ? holder.data : Array.isArray(holder.rows) ? holder.rows : []) as unknown[];
  const declared = (Array.isArray(holder.headers) ? holder.headers : Array.isArray(holder.columns) ? holder.columns : []) as unknown[];
  let columns = declared.map((c, i) =>
    typeof c === "string" ? c : c && typeof c === "object" ? String((c as { name?: unknown }).name ?? (c as { label?: unknown }).label ?? `col${i + 1}`) : `col${i + 1}`,
  );
  // Rows as objects: their keys are the columns.
  if (raw.length > 0 && raw[0] && typeof raw[0] === "object" && !Array.isArray(raw[0])) {
    if (columns.length === 0) columns = Object.keys(raw[0] as object);
    const rows = raw.map((r) => columns.map((c) => (r as Record<string, unknown>)[c] ?? null));
    return { columns, rows: rows.slice(0, limit) };
  }
  const rows = raw.filter(Array.isArray) as unknown[][];
  if (columns.length === 0 && rows[0]) columns = rows[0].map((_, i) => `col${i + 1}`);
  return { columns, rows: rows.slice(0, limit) };
}

/* Read-only datasets ---------------------------------------------------------------------- */

/** Statements that change something; a query must start with SELECT or WITH, so this catches writes inside one. */
const WRITES = /\b(insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|refresh|register|compile|call|exec|execute)\b/i;

/** Strips string literals and comments, so keywords inside them don't count. */
function code(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** A dataset is one SELECT (or WITH … SELECT): Kept never changes anything in Zetaris. Returns the problem, or null. */
export function readOnlyProblem(sql: string): string | null {
  const body = code(sql).trim().replace(/;\s*$/, "");
  if (!body) return "Write a SELECT query";
  if (body.includes(";")) return "Use a single statement";
  if (!/^(select|with)\b/i.test(body)) return "Only SELECT queries can be used";
  const write = body.match(WRITES);
  if (write) return `"${write[1]!.toUpperCase()}" isn't allowed: datasets only read`;
  return null;
}

/** What a dataset's SQL can be filtered by, filled in for the company being reviewed. */
export const DATASET_PARAMS = ["domain", "account_name", "crm_id", "account_id"] as const;
export type DatasetParam = (typeof DATASET_PARAMS)[number];
export type DatasetParams = Partial<Record<DatasetParam, string | null>>;

const PARAM = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function paramsUsed(sql: string): string[] {
  return [...new Set([...sql.matchAll(PARAM)].map((m) => m[1]!))];
}

/** Problems with a dataset's parameters: unknown names, or none at all (it must be filtered to one company). */
export function paramsProblem(sql: string): string | null {
  const used = paramsUsed(sql);
  const unknown = used.filter((p) => !(DATASET_PARAMS as readonly string[]).includes(p));
  if (unknown.length) return `Unknown parameter {{${unknown[0]}}}. Use ${DATASET_PARAMS.map((p) => `{{${p}}}`).join(", ")}`;
  if (used.length === 0) return `Filter by the company with ${DATASET_PARAMS.map((p) => `{{${p}}}`).join(", ")}, so its results never include other clients`;
  return null;
}

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The dataset's SQL for one company, its parameters as SQL string literals. Null when the company
 * lacks a value the query needs (no domain, not from the CRM): the dataset doesn't apply to it.
 */
export function bindDataset(sql: string, params: DatasetParams): string | null {
  let missing = false;
  const bound = sql.replace(PARAM, (_all, name: string) => {
    const value = params[name as DatasetParam];
    if (value === undefined || value === null || value === "") {
      missing = true;
      return "NULL";
    }
    return literal(value);
  });
  return missing ? null : bound.trim().replace(/;\s*$/, "");
}

/** A result as a plain-text table the model can read and quote: header, then one row per line. */
export function renderTable(result: ZetarisResult, maxChars = 6000): string {
  const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\s+/g, " ").trim();
  const lines = [result.columns.join(" | "), ...result.rows.map((r) => r.map(cell).join(" | "))];
  let out = "";
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) {
      out += `\n[... ${lines.length - out.split("\n").length} more rows]`;
      break;
    }
    out += (out ? "\n" : "") + line;
  }
  return result.rows.length === 0 ? `${result.columns.join(" | ")}\n(no rows)` : out;
}

/* Stored settings ----------------------------------------------------------------------------- */

export interface ZetarisDataset {
  id: string;
  /** Short, for people and the model: "Product usage by month". */
  name: string;
  /** What it shows and when it matters; the planner reads this to decide when to check it. */
  description: string;
  sql: string;
}

/** Kept in the Zetaris connection's settings; the API key is stored encrypted, apart. */
export interface ZetarisConfig extends ZetarisSettings {
  datasets: ZetarisDataset[];
}

export function zetarisConfig(syncState: unknown): ZetarisConfig | null {
  const z = (syncState as { zetaris?: Partial<ZetarisConfig> } | null)?.zetaris;
  if (!z?.restUrl || !z.orgId) return null;
  return { restUrl: z.restUrl, orgId: z.orgId, datasets: Array.isArray(z.datasets) ? z.datasets : [] };
}

/** The values a dataset can be filtered by, for one company. */
export function accountParams(account: { id: string; name: string; domain: string | null; crmExternalId: string | null }): DatasetParams {
  return {
    domain: account.domain,
    account_name: account.name,
    crm_id: account.crmExternalId?.match(/^hubspot:(\d+)$/)?.[1] ?? null,
    account_id: account.id,
  };
}

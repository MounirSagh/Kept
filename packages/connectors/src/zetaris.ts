// Zetaris: the org's data harness. Kept runs read-only SQL through it, live, so the agents can
// check what the warehouse, billing or support systems say about a client while reviewing it.
// Two ways in, both with an API key and the Zetaris organization id:
//   - the engine's REST API, a URL ending in /api/v1.0 (POST /sql-editor/sqls/run)
//   - the web app's proxy, an origin like https://zetaris.example.com (POST /api/proxy/sql-editor/sqls/run-query)

import { randomUUID } from "node:crypto";

export interface ZetarisSettings {
  /** The engine's REST base (…/api/v1.0) or the web app's origin. */
  restUrl: string;
  /** Numeric id from Management → Organisation. */
  orgId: string;
}

export interface ZetarisResult {
  columns: string[];
  rows: unknown[][];
}

export class ZetarisError extends Error {}

const DEFAULT_TIMEOUT_MS = 60_000;

export function normalizeRestUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const isEngineApi = (restUrl: string) => /\/api\/v1\.0$/.test(normalizeRestUrl(restUrl));

/** Runs one SQL statement and returns its columns and rows (at most `limit`). */
export async function zetarisQuery(
  settings: ZetarisSettings,
  apiKey: string,
  sql: string,
  opts: { limit?: number; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<ZetarisResult> {
  const base = normalizeRestUrl(settings.restUrl);
  const limit = opts.limit ?? 100;
  const [url, body] = isEngineApi(base)
    ? [`${base}/sql-editor/sqls/run`, { queryId: randomUUID(), sql, source: "SqlEditor", limit }]
    : [`${base}/api/proxy/sql-editor/sqls/run-query`, { sql, limit }];

  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Org-ID": settings.orgId,
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ZetarisError(`Can't reach Zetaris at ${base}: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new ZetarisError("Zetaris refused the API key or organization id");
  if (!res.ok) throw new ZetarisError(`Zetaris answered ${res.status}: ${text.slice(0, 300)}`);
  if ((res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new ZetarisError("Zetaris answered with a web page: check the URL (the engine's …/api/v1.0, or the web app's address)");
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
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

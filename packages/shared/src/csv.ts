// CSV import, shared by the web preview and the tests. Parsing happens in the browser so
// people see exactly what will be imported; the API validates every row again.

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/**
 * RFC 4180-style parsing: quoted fields, "" escapes, commas and newlines inside quotes, CRLF,
 * and the BOM Excel adds. Semicolon-separated files (European Excel) are detected from the header.
 */
export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === sep) {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ""));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows };
}

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Finds each wanted column by any of its accepted names. -1 when absent. */
export function findColumns<K extends string>(headers: string[], names: Record<K, string[]>): Record<K, number> {
  const normalized = headers.map(normalizeHeader);
  const out = {} as Record<K, number>;
  for (const key of Object.keys(names) as K[]) {
    out[key] = normalized.findIndex((h) => names[key].some((n) => normalizeHeader(n) === h));
  }
  return out;
}

/** A calendar date as YYYY-MM-DD, or null. ISO dates are taken as-is; other formats go through Date.parse. */
export function parseDateCell(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "$48,000", "48000.50", "48k", "USD 1.2m" -> number. Anything else is rejected rather than
 * guessed: a stray character usually means a typo. Dot thousands separators ("12.000") are not supported.
 */
export function parseMoneyCell(value: string): number | null {
  const v = value.trim().replace(/^[A-Za-z]{3}\s*|\s*[A-Za-z]{3}$/g, "").replace(/[$€£¥,\s]/g, "");
  const m = /^(-?\d+(?:\.\d+)?)([kKmM])?$/.exec(v);
  if (!m) return null;
  const scale = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  return Number(m[1]) * scale;
}

export type ImportError = { row: number; message: string };

// --------------------------------------------------------------- accounts

export interface AccountImportRow {
  name: string;
  domain: string | null;
  ownerEmail: string | null;
  renewalDate: string | null;
  annualValue: number | null;
  currency: string | null;
}

export const ACCOUNT_COLUMNS = {
  name: ["name", "account", "account name", "company", "company name", "client", "customer"],
  domain: ["domain", "email domain", "website", "url", "site"],
  ownerEmail: ["owner", "owner email", "account owner", "csm", "csm email"],
  renewalDate: ["renewal", "renewal date", "renews", "renews on", "contract end", "contract end date"],
  annualValue: ["annual value", "arr", "acv", "contract value", "revenue", "value"],
  currency: ["currency"],
};

/** Row numbers in errors are spreadsheet rows (header = row 1). */
export function toAccountRows(table: CsvTable): { rows: (AccountImportRow & { row: number })[]; errors: ImportError[] } {
  const col = findColumns(table.headers, ACCOUNT_COLUMNS);
  const errors: ImportError[] = [];
  const rows: (AccountImportRow & { row: number })[] = [];
  if (col.name < 0) return { rows, errors: [{ row: 1, message: "No account name column (expected e.g. \"Name\" or \"Account\")" }] };

  table.rows.forEach((cells, i) => {
    const row = i + 2;
    const cell = (k: keyof typeof col) => (col[k] >= 0 ? (cells[col[k]] ?? "").trim() : "");
    const name = cell("name");
    if (!name) return errors.push({ row, message: "Missing account name" });
    const rawDate = cell("renewalDate");
    const renewalDate = parseDateCell(rawDate);
    if (rawDate && !renewalDate) return errors.push({ row, message: `Can't read renewal date "${rawDate}"` });
    const rawValue = cell("annualValue");
    const annualValue = parseMoneyCell(rawValue);
    if (rawValue && annualValue === null) return errors.push({ row, message: `Can't read annual value "${rawValue}"` });
    const currency = cell("currency").toUpperCase() || null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) return errors.push({ row, message: `Currency should be a 3-letter code like USD, got "${currency}"` });
    rows.push({ row, name, domain: cell("domain") || null, ownerEmail: cell("ownerEmail").toLowerCase() || null, renewalDate, annualValue, currency });
  });
  return { rows, errors };
}

// ------------------------------------------------------------ commitments

export type CommitmentStatusValue = "open" | "fulfilled" | "broken";

export interface CommitmentImportRow {
  /** Account name or email domain. */
  account: string;
  summary: string;
  dueDate: string | null;
  ownerEmail: string | null;
  madeBy: string | null;
  status: CommitmentStatusValue;
}

export const COMMITMENT_COLUMNS = {
  account: ["account", "account name", "client", "customer", "company", "domain"],
  summary: ["commitment", "summary", "promise", "description", "what", "title"],
  dueDate: ["due", "due date", "deadline", "by", "due by"],
  ownerEmail: ["owner", "owner email", "assignee", "responsible"],
  madeBy: ["made by", "promised by", "committed by", "who"],
  status: ["status", "state"],
};

const STATUS_WORDS: Record<string, CommitmentStatusValue> = {
  "": "open", open: "open", pending: "open", "in progress": "open", todo: "open", "to do": "open",
  done: "fulfilled", fulfilled: "fulfilled", kept: "fulfilled", complete: "fulfilled", completed: "fulfilled", delivered: "fulfilled",
  broken: "broken", missed: "broken", failed: "broken", late: "broken",
};

export function toCommitmentRows(table: CsvTable): { rows: (CommitmentImportRow & { row: number })[]; errors: ImportError[] } {
  const col = findColumns(table.headers, COMMITMENT_COLUMNS);
  const errors: ImportError[] = [];
  const rows: (CommitmentImportRow & { row: number })[] = [];
  const missing = [col.account < 0 && "account", col.summary < 0 && "commitment"].filter(Boolean);
  if (missing.length) return { rows, errors: [{ row: 1, message: `Missing column: ${missing.join(" and ")}` }] };

  table.rows.forEach((cells, i) => {
    const row = i + 2;
    const cell = (k: keyof typeof col) => (col[k] >= 0 ? (cells[col[k]] ?? "").trim() : "");
    const account = cell("account");
    const summary = cell("summary");
    if (!account) return errors.push({ row, message: "Missing account" });
    if (!summary) return errors.push({ row, message: "Missing commitment" });
    const rawDate = cell("dueDate");
    const dueDate = parseDateCell(rawDate);
    if (rawDate && !dueDate) return errors.push({ row, message: `Can't read due date "${rawDate}"` });
    const rawStatus = cell("status").toLowerCase();
    const status = STATUS_WORDS[rawStatus];
    if (!status) return errors.push({ row, message: `Unknown status "${cell("status")}" (use open, fulfilled or broken)` });
    rows.push({ row, account, summary, dueDate, ownerEmail: cell("ownerEmail").toLowerCase() || null, madeBy: cell("madeBy") || null, status });
  });
  return { rows, errors };
}

// ------------------------------------------------------------------ teams

export interface TeamImportRow {
  name: string;
}

export const TEAM_COLUMNS = { name: ["name", "team", "team name"] };

export function toTeamRows(table: CsvTable): { rows: (TeamImportRow & { row: number })[]; errors: ImportError[] } {
  const col = findColumns(table.headers, TEAM_COLUMNS);
  if (col.name < 0) return { rows: [], errors: [{ row: 1, message: 'No team name column (expected "Name" or "Team")' }] };
  const errors: ImportError[] = [];
  const rows: (TeamImportRow & { row: number })[] = [];
  const seen = new Set<string>();
  table.rows.forEach((cells, i) => {
    const row = i + 2;
    const name = (cells[col.name] ?? "").trim();
    if (!name) return errors.push({ row, message: "Missing team name" });
    if (name.length > 100) return errors.push({ row, message: "Team names are at most 100 characters" });
    if (seen.has(name.toLowerCase())) return errors.push({ row, message: `"${name}" appears twice in the file` });
    seen.add(name.toLowerCase());
    rows.push({ row, name });
  });
  return { rows, errors };
}

// ----------------------------------------------------- members (invitations)

export interface InvitationImportRow {
  email: string;
  role: "owner" | "manager" | "member";
  /** Team name; blank means no team (or, for a manager, their own team). */
  team: string | null;
}

export const INVITATION_COLUMNS = {
  email: ["email", "email address", "work email"],
  role: ["role"],
  team: ["team", "team name"],
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function toInvitationRows(table: CsvTable): { rows: (InvitationImportRow & { row: number })[]; errors: ImportError[] } {
  const col = findColumns(table.headers, INVITATION_COLUMNS);
  if (col.email < 0) return { rows: [], errors: [{ row: 1, message: 'No email column (expected "Email")' }] };
  const errors: ImportError[] = [];
  const rows: (InvitationImportRow & { row: number })[] = [];
  const seen = new Set<string>();
  table.rows.forEach((cells, i) => {
    const row = i + 2;
    const cell = (k: keyof typeof col) => (col[k] >= 0 ? (cells[col[k]] ?? "").trim() : "");
    const email = cell("email").toLowerCase();
    if (!EMAIL_SHAPE.test(email)) return errors.push({ row, message: email ? `"${email}" isn't an email address` : "Missing email" });
    if (seen.has(email)) return errors.push({ row, message: `${email} appears twice in the file` });
    seen.add(email);
    const rawRole = cell("role").toLowerCase() || "member";
    if (rawRole !== "owner" && rawRole !== "manager" && rawRole !== "member") {
      return errors.push({ row, message: `Unknown role "${cell("role")}" (use owner, manager or member)` });
    }
    rows.push({ row, email, role: rawRole, team: cell("team") || null });
  });
  return { rows, errors };
}

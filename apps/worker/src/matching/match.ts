// Deterministic routing of a synced item to a client account. No model calls: every result
// comes from an explicit rule and carries the reason, so "why can my team see this?" always
// has an answer. Rules, in order:
//   1. An owner's mapping of the item's container (Slack channel, Linear team, Notion parent).
//   2. HubSpot records: companies are accounts; contacts follow their company.
//   3. Participants: a known contact's email, else an account's email domain.
// One account -> matched. Several -> ambiguous (owners review). None -> unmatched.

export type MatchStatus = "matched" | "unmatched" | "ambiguous" | "ignored";

export interface MatchResult {
  status: MatchStatus;
  accountId: string | null;
  reason: string;
}

export interface MatchContext {
  /** The org's own email domains (members' work domains): never evidence of a client. */
  internalDomains: Set<string>;
  /** Normalized account domain -> account ids. */
  accountsByDomain: Map<string, string[]>;
  /** Lowercased contact email -> account id (contacts without an account are absent). */
  contactAccounts: Map<string, string>;
  /** CRM key ("hubspot:123") -> account id. */
  accountsByCrmId: Map<string, string>;
  /** `${connectionId}:${containerId}` -> owner decision. */
  mappings: Map<string, { accountId: string | null; ignored: boolean; label: string | null }>;
}

export interface MatchInput {
  connectionId: string;
  provider: string;
  containerId: string | null;
  containerLabel: string | null;
  author: string | null;
  metadata: Record<string, unknown>;
}

/** Shared mailbox providers: an address there says nothing about which company someone is from. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de",
  "mail.com", "yandex.com", "zoho.com", "fastmail.com", "hey.com",
]);

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:].*$/, "");
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Every email address in the item's participant fields (from, to, cc, attendees, organizer, author). */
export function participantEmails(input: Pick<MatchInput, "author" | "metadata">): string[] {
  const values: unknown[] = [input.author];
  for (const key of ["from", "to", "cc", "attendees", "organizer", "modifiedBy"]) values.push(input.metadata[key]);
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(EMAIL)) out.add(m[0].toLowerCase());
    else if (Array.isArray(v)) v.forEach(visit);
  };
  values.forEach(visit);
  return [...out];
}

/** Looks up a domain and its parents, so mail.northwind.com finds northwind.com. */
function accountsForDomain(domain: string, ctx: MatchContext): string[] {
  const labels = domain.split(".");
  for (let i = 0; i <= labels.length - 2; i++) {
    const hit = ctx.accountsByDomain.get(labels.slice(i).join("."));
    if (hit) return hit;
  }
  return [];
}

function isInternal(domain: string, ctx: MatchContext): boolean {
  for (const internal of ctx.internalDomains) if (domain === internal || domain.endsWith(`.${internal}`)) return true;
  return false;
}

function decide(candidates: Map<string, string>, what: string): MatchResult {
  if (candidates.size === 1) {
    const [[accountId, evidence]] = [...candidates.entries()] as [[string, string]];
    return { status: "matched", accountId, reason: evidence };
  }
  if (candidates.size > 1) {
    return { status: "ambiguous", accountId: null, reason: `${what} point to ${candidates.size} accounts: ${[...candidates.values()].join("; ")}` };
  }
  return { status: "unmatched", accountId: null, reason: "" };
}

export function matchItem(input: MatchInput, ctx: MatchContext): MatchResult {
  // 1. Owner mapping of the container.
  if (input.containerId) {
    const mapping = ctx.mappings.get(`${input.connectionId}:${input.containerId}`);
    const label = mapping?.label ?? input.containerLabel ?? input.containerId;
    if (mapping?.ignored) return { status: "ignored", accountId: null, reason: `${label} is marked as not client-related` };
    if (mapping?.accountId) return { status: "matched", accountId: mapping.accountId, reason: `${label} is mapped to this account` };
  }

  // 2. HubSpot records carry their own CRM identity.
  if (input.provider === "hubspot") {
    const object = input.metadata.object;
    const company = object === "companies" ? input.metadata.id : object === "contacts" ? input.metadata.associatedcompanyid : undefined;
    if (company) {
      const accountId = ctx.accountsByCrmId.get(`hubspot:${String(company)}`);
      if (accountId) return { status: "matched", accountId, reason: `HubSpot company ${String(company)}` };
    }
  }

  // 3. Participants: known contacts first (precise), then email domains.
  const emails = participantEmails(input);
  const byContact = new Map<string, string>();
  for (const email of emails) {
    const accountId = ctx.contactAccounts.get(email);
    if (accountId && !byContact.has(accountId)) byContact.set(accountId, `contact ${email}`);
  }
  if (byContact.size > 0) return decide(byContact, "contacts");

  const byDomain = new Map<string, string>();
  for (const email of emails) {
    const domain = email.split("@")[1]!;
    if (FREE_MAIL_DOMAINS.has(domain) || isInternal(domain, ctx)) continue;
    for (const accountId of accountsForDomain(domain, ctx)) if (!byDomain.has(accountId)) byDomain.set(accountId, `email domain ${domain}`);
  }
  const result = decide(byDomain, "email domains");
  if (result.status !== "unmatched") return result;

  return {
    status: "unmatched",
    accountId: null,
    reason: input.containerId
      ? `${input.containerLabel ?? input.containerId} isn't mapped to an account`
      : emails.length > 0
        ? "no participant belongs to a known account"
        : "no participants or mapping to match on",
  };
}

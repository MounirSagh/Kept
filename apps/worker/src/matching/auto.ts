import type { PrismaClient } from "@kept/db";
import { normalizeDomain } from "./match.js";

// Automatic routing of containers (Slack channels, Linear teams, Notion parents, Drive and
// OneDrive folders). Still no model: a container is routed only on explicit evidence, and the
// mapping records it, so the Routing page can say why. Two kinds of evidence:
//   - its name names one client: "#ext-halcyon", "Halcyon Freight" team, "Drive › Clients › Halcyon";
//   - its people are one client's: messages in it already routed, by contact or email domain, to
//     that client and almost no other.
// Kept never changes a mapping an owner made, and doesn't route a container an owner left unrouted.

/** Messages routed by their people needed before a container follows them. */
export const MIN_PEOPLE_ITEMS = 3;
/** Share of a container's people-routed messages that must point to the same client. */
export const MIN_PEOPLE_SHARE = 0.8;

/** Company suffixes and filler: "Halcyon Freight Inc." is named by "halcyon freight". */
const FILLER = new Set([
  "inc", "llc", "ltd", "limited", "gmbh", "corp", "corporation", "co", "company", "sa", "sas", "sarl", "ag", "bv", "nv",
  "plc", "pty", "group", "holdings", "the", "and", "of",
]);

/** Words a channel or team is often called that say nothing about a client, even if a client is named so. */
const GENERIC = new Set([
  "general", "random", "support", "sales", "team", "teams", "eng", "engineering", "dev", "ops", "product", "marketing",
  "design", "data", "internal", "alerts", "help", "announcements", "customer", "customers", "client", "clients", "success",
  "partners", "partner", "shared", "ext", "external", "project", "projects", "drive", "onedrive", "folder", "folders",
  "docs", "notes", "files", "documents", "contracts", "finance", "legal", "billing", "infra", "platform", "mobile", "web",
  "backend", "frontend", "growth", "onboarding", "release", "releases", "standup", "social", "hiring", "office",
]);

const MIN_TOKEN = 4;

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * The word sequences that name an account in a container's name: its name without suffixes, the
 * same words run together ("halcyonfreight"), and its domain's first label. A one-word key must be
 * at least four letters and not a generic word.
 */
export function accountKeys(account: { name: string; domain: string | null }): string[][] {
  const keys: string[][] = [];
  const add = (key: string[]) => {
    if (key.length === 0) return;
    if (key.length === 1 && (key[0]!.length < MIN_TOKEN || GENERIC.has(key[0]!))) return;
    if (!keys.some((k) => k.join(" ") === key.join(" "))) keys.push(key);
  };
  const words = tokens(account.name).filter((t) => !FILLER.has(t));
  add(words);
  if (words.length > 1) add([words.join("")]);
  if (account.domain) add([normalizeDomain(account.domain).split(".")[0] ?? ""].filter(Boolean));
  return keys;
}

const containsRun = (haystack: string[], needle: string[]) => {
  for (let i = 0; i + needle.length <= haystack.length; i++) if (needle.every((t, j) => haystack[i + j] === t)) return true;
  return false;
};

/**
 * The account a container's name names, if exactly one does. When several do ("halcyon" and
 * "halcyon freight" in "#halcyon-freight"), the longest name wins; a tie names none.
 */
export function accountNamedBy(label: string, accounts: { id: string; name: string; domain: string | null }[]): { accountId: string; key: string } | null {
  const words = tokens(label);
  const hits: { accountId: string; key: string; length: number }[] = [];
  for (const a of accounts) {
    let best: string[] | null = null;
    for (const key of accountKeys(a)) if (containsRun(words, key) && (!best || key.join(" ").length > best.join(" ").length)) best = key;
    if (best) hits.push({ accountId: a.id, key: best.join(" "), length: best.join(" ").length });
  }
  if (hits.length === 0) return null;
  hits.sort((x, y) => y.length - x.length);
  if (hits.length > 1 && hits[1]!.length === hits[0]!.length) return null;
  return { accountId: hits[0]!.accountId, key: hits[0]!.key };
}

/** Item match reasons that come from the item's own people (rule 3 of matchItem). */
export const PEOPLE_REASON = /^(contact |email domain |shared with )/;

export interface ContainerEvidence {
  label: string;
  /** Account id -> items in the container routed to it by their people. */
  people: Map<string, number>;
}

export type AutoDecision = { accountId: string; reason: string } | null;

/**
 * Whether a container should follow a client, and why. Name and people must not disagree: a
 * channel called #halcyon full of Northwind's people is left for an owner.
 */
export function decideContainer(
  evidence: ContainerEvidence,
  accounts: { id: string; name: string; domain: string | null }[],
): AutoDecision {
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "a client";
  const total = [...evidence.people.values()].reduce((s, n) => s + n, 0);
  const [top, topCount] = [...evidence.people.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const peopleAgree = top !== null && topCount >= MIN_PEOPLE_ITEMS && topCount / total >= MIN_PEOPLE_SHARE;
  const plural = (n: number) => (n === 1 ? "message" : "messages");

  const named = accountNamedBy(evidence.label, accounts);
  if (named) {
    // Someone else's people dominate the container: the name may be a coincidence.
    if (top !== null && top !== named.accountId && topCount >= MIN_PEOPLE_ITEMS) return null;
    const people = top === named.accountId ? `, and ${topCount} of its ${total} ${plural(total)} with clients are from their people` : "";
    const name = nameOf(named.accountId);
    // The words matched, when they aren't simply the name without suffixes ("halcyonfreight" for Halcyon Freight Inc.).
    const plain = tokens(name).filter((t) => !FILLER.has(t)).join(" ");
    const words = plain === named.key ? "" : ` ("${named.key}")`;
    return { accountId: named.accountId, reason: `Its name matches ${name}${words}${people}` };
  }
  if (peopleAgree) {
    return { accountId: top, reason: `${topCount} of its ${total} ${plural(total)} with clients are from ${nameOf(top)}'s people` };
  }
  return null;
}

/**
 * Routes containers nobody routed yet, after items were matched (so people-routed items count).
 * Returns the containers it routed, whose items need matching again.
 */
export async function autoRoute(prisma: PrismaClient, orgId: string): Promise<{ connectionId: string; containerId: string }[]> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  if ((org.settings as { routing?: { auto?: boolean } } | null)?.routing?.auto === false) return [];

  const [accounts, mappings, containers, routed] = await Promise.all([
    prisma.account.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true, domain: true } }),
    prisma.sourceMapping.findMany({ where: { orgId }, select: { connectionId: true, containerId: true } }),
    prisma.sourceItem.groupBy({
      by: ["connectionId", "containerId", "containerLabel"],
      where: { orgId, deletedAt: null, containerId: { not: null }, connection: { provider: { not: "hubspot" } } },
      _max: { occurredAt: true },
    }),
    prisma.sourceItem.groupBy({
      by: ["connectionId", "containerId", "accountId", "matchReason"],
      where: { orgId, deletedAt: null, containerId: { not: null }, matchStatus: "matched" },
      _count: { _all: true },
    }),
  ]);
  if (accounts.length === 0) return [];

  const decided = new Set(mappings.map((m) => `${m.connectionId}:${m.containerId}`));
  const evidence = new Map<string, ContainerEvidence & { connectionId: string; containerId: string; last: number }>();
  for (const c of containers) {
    const key = `${c.connectionId}:${c.containerId}`;
    if (decided.has(key)) continue;
    const last = c._max.occurredAt?.getTime() ?? 0;
    const prev = evidence.get(key);
    // A renamed container: its latest name counts.
    if (!prev || prev.last < last) {
      evidence.set(key, { connectionId: c.connectionId, containerId: c.containerId!, label: c.containerLabel ?? c.containerId!, people: prev?.people ?? new Map(), last });
    }
  }
  for (const r of routed) {
    const e = evidence.get(`${r.connectionId}:${r.containerId}`);
    if (!e || !r.accountId || !PEOPLE_REASON.test(r.matchReason ?? "")) continue;
    e.people.set(r.accountId, (e.people.get(r.accountId) ?? 0) + r._count._all);
  }

  const created: { connectionId: string; containerId: string }[] = [];
  for (const e of evidence.values()) {
    const decision = decideContainer(e, accounts);
    if (!decision) continue;
    // An owner may have decided meanwhile: never overwrite.
    const res = await prisma.sourceMapping.createMany({
      data: [{ orgId, connectionId: e.connectionId, containerId: e.containerId, containerLabel: e.label, accountId: decision.accountId, origin: "auto", reason: decision.reason }],
      skipDuplicates: true,
    });
    if (res.count > 0) created.push({ connectionId: e.connectionId, containerId: e.containerId });
  }
  return created;
}

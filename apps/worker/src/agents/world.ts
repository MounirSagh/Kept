import type { PrismaClient } from "@kept/db";
import { externalId, WorldModel, type Entity, type Provenance, type Relationship } from "@kept/world-model";
import { prismaWorldStorage } from "@kept/world-model/prisma";

// The World Model is the org's shared, time-aware graph: accounts, the people at them and the
// promises made to them, each change kept with where it came from. Postgres holds the current
// state; the World Model remembers how it got there, which is what the agents read from it:
// how a client's terms moved, its track record over all time, and people who changed companies.

const COMMITMENT_LIMIT = 500;
const HISTORY_CHANGES = 5;
const BROKEN_SHOWN = 3;

export const openWorld = (prisma: PrismaClient, orgId: string) => WorldModel.open({ storage: prismaWorldStorage(prisma), namespace: orgId });

export const accountEntityId = (accountId: string) => externalId("account", "kept", accountId);
const personEntityId = (email: string) => externalId("person", "email", email.toLowerCase());

/** The account terms tracked over time, as stored on the account entity. */
export type AccountTerms = {
  renewalDate: string | null;
  annualValue: string | null;
  owner: string | null;
};

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

function formatValue(cents: bigint | null, currency: string | null) {
  if (cents == null) return null;
  return `${(Number(cents) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency ?? "USD"}`;
}

const changed = (entity: Entity | undefined, attrs: Record<string, unknown>) =>
  !entity || Object.entries(attrs).some(([k, v]) => (entity.attrs[k] ?? null) !== v);

/**
 * Records the account's terms, people and promises in the World Model where they differ from what
 * it already holds. Writes nothing when nothing changed, so it is cheap to run before every run.
 */
export async function syncAccountWorld(wm: WorldModel, prisma: PrismaClient, orgId: string, accountId: string) {
  const [account, contacts, commitments] = await Promise.all([
    prisma.account.findFirstOrThrow({
      where: { id: accountId, orgId },
      select: { name: true, renewalDate: true, annualValueCents: true, currency: true, ownerUserId: true, updatedAt: true, owner: { select: { email: true } } },
    }),
    prisma.contact.findMany({
      where: { orgId, accountId, deletedAt: null, email: { not: null } },
      select: { email: true, fullName: true, title: true, updatedAt: true },
    }),
    prisma.extractedItem.findMany({
      where: { orgId, accountId, deletedAt: null },
      select: { id: true, type: true, summary: true, status: true, dueDate: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: COMMITMENT_LIMIT,
    }),
  ]);
  const graph = wm.view("graph");
  const source = (at: Date): Provenance => ({ kind: "pipeline", by: "account-sync", at });
  let writes = 0;

  const entityId = accountEntityId(accountId);
  const terms: AccountTerms & { ownerUserId: string | null } = {
    renewalDate: day(account.renewalDate),
    annualValue: formatValue(account.annualValueCents, account.currency),
    owner: account.owner?.email ?? null,
    ownerUserId: account.ownerUserId,
  };
  const current = graph.entity(entityId);
  if (changed(current, terms) || current?.name !== account.name) {
    await wm.upsertEntity({ type: "account", externalKey: { system: "kept", id: accountId }, name: account.name, attrs: terms, source: source(account.updatedAt) });
    writes++;
  }

  for (const c of contacts) {
    const id = personEntityId(c.email!);
    const attrs = { email: c.email!.toLowerCase(), title: c.title ?? null };
    const person = graph.entity(id);
    if (changed(person, attrs) || (c.fullName && person?.name !== c.fullName)) {
      await wm.upsertEntity({ type: "person", externalKey: { system: "email", id: attrs.email }, name: c.fullName ?? attrs.email, attrs, source: source(c.updatedAt) });
      writes++;
    }
    // Relating them to a new account closes the edge to the old one: that's how a move is remembered.
    const at = graph.neighborsOf(id, { via: "works_at" });
    if (!at.some((e) => e.id === entityId)) {
      await wm.relate({ from: id, type: "works_at", to: entityId, source: source(c.updatedAt) });
      writes++;
    }
  }

  const concerning = new Set(graph.incoming(entityId, { via: "concerns" }).map((e) => e.id));
  for (const c of commitments) {
    const id = externalId(c.type, "kept", c.id);
    const attrs = { status: c.status, dueDate: day(c.dueDate) };
    if (changed(graph.entity(id), attrs)) {
      await wm.upsertEntity({ type: c.type, externalKey: { system: "kept", id: c.id }, name: c.summary, attrs, source: source(c.updatedAt) });
      writes++;
    }
    if (!concerning.has(id)) {
      await wm.relate({ from: id, type: "concerns", to: entityId, source: source(c.updatedAt) });
      writes++;
    }
  }
  return { writes };
}

/** Records terms set from an approved contract, with where they came from and who approved them. */
export async function recordTermsChange(
  wm: WorldModel,
  accountId: string,
  change: { renewalDate?: Date; annualValueCents?: bigint; currency: string | null; via: string; at: Date },
) {
  // Formatted as syncAccountWorld does, so its next pass sees no difference.
  const attrs: Record<string, unknown> = {};
  if (change.renewalDate) attrs.renewalDate = day(change.renewalDate);
  if (change.annualValueCents !== undefined) attrs.annualValue = formatValue(change.annualValueCents, change.currency);
  if (Object.keys(attrs).length === 0) return;
  await wm.upsertEntity({ type: "account", externalKey: { system: "kept", id: accountId }, attrs, source: { kind: "agent", by: change.via, at: change.at } });
}

const TERM_LABELS: Record<string, string> = { renewalDate: "Renewal date", annualValue: "Yearly value" };

/**
 * What the World Model knows about an account beyond its current state, one line each:
 * how its terms changed and why, its track record across all time, and people who moved
 * between it and other clients. Other clients are named only when they share the account's
 * owner, so a flag never reveals a company some of its readers can't see.
 */
export function accountHistory(wm: WorldModel, accountId: string): string[] {
  const graph = wm.view("graph");
  const id = accountEntityId(accountId);
  const account = graph.entity(id);
  if (!account) return [];
  const lines: string[] = [];
  const events = wm.events();

  // 1. Term changes, oldest value to newest, with their source.
  const changes: string[] = [];
  const last: Record<string, unknown> = {};
  for (const e of events) {
    if (e.kind !== "upsertEntity") continue;
    const p = e.payload as Entity;
    if (p.id !== id) continue;
    for (const key of Object.keys(TERM_LABELS)) {
      if (!(key in p.attrs)) continue;
      const value = p.attrs[key] ?? null;
      const before = last[key];
      last[key] = value;
      if (before === undefined || before === value) continue;
      const via = p.source.by && p.source.by !== "account-sync" ? ` (${p.source.by})` : "";
      changes.push(`${TERM_LABELS[key]} changed from ${before ?? "unset"} to ${value ?? "unset"} on ${p.source.at.slice(0, 10)}${via}.`);
    }
  }
  lines.push(...changes.slice(-HISTORY_CHANGES));

  // 2. Track record over all time, for promises made to the client and by it.
  const items = graph.incoming(id, { via: "concerns" });
  const record = (type: string, who: string) => {
    const mine = items.filter((e) => e.type === type);
    const count = (s: string) => mine.filter((e) => e.attrs.status === s).length;
    const closed = count("fulfilled") + count("broken") + count("superseded");
    if (closed === 0) return;
    lines.push(`Track record, ${who}: ${mine.length} so far, ${count("fulfilled")} kept, ${count("broken")} broken, ${count("superseded")} replaced, ${count("open")} open.`);
    const broken = mine.filter((e) => e.attrs.status === "broken").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, BROKEN_SHOWN);
    for (const b of broken) lines.push(`Broken: "${b.name}"${b.attrs.dueDate ? ` (was due ${String(b.attrs.dueDate)})` : ""}, recorded ${b.updatedAt.slice(0, 10)}.`);
  };
  record("commitment", "promises the company made to this client");
  record("obligation", "promises this client made");

  // 3. People who moved: every works_at edge, in the order it was recorded.
  const stints = new Map<string, Relationship[]>();
  for (const e of events) {
    if (e.kind !== "relate") continue;
    const r = e.payload as Relationship;
    if (r.type !== "works_at") continue;
    stints.set(r.from, [...(stints.get(r.from) ?? []), r]);
  }
  const ownerUserId = account.attrs.ownerUserId ?? null;
  const nameOf = (otherId: string) => {
    const other = graph.entity(otherId);
    return other && ownerUserId !== null && other.attrs.ownerUserId === ownerUserId && other.name ? other.name : "another client";
  };
  for (const [personId, history] of stints) {
    if (history.length < 2 || !history.some((r) => r.to === id)) continue;
    const person = graph.entity(personId);
    const who = `${person?.name ?? "A contact"}${person?.attrs.email && person.attrs.email !== person.name ? ` (${String(person.attrs.email)})` : ""}`;
    for (let i = 1; i < history.length; i++) {
      const from = history[i - 1]!;
      const to = history[i]!;
      if (to.to === from.to) continue;
      const when = (to.validFrom ?? to.createdAt).slice(0, 10);
      if (to.to === id) lines.push(`${who} joined this client from ${nameOf(from.to)} on ${when}.`);
      else if (from.to === id) lines.push(`${who} left this client for ${nameOf(to.to)} on ${when}: no longer a contact here.`);
    }
  }
  return lines;
}

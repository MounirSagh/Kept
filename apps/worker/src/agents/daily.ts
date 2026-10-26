import type { Queue } from "bullmq";
import { visibleAccountsWhere, type PrismaClient, type Viewer } from "@kept/db";
import type { AgentRunJobData, EmailJobData } from "@kept/shared";
import { queueAccountRun } from "./extract.js";

/** Local hour (org time zone) at or after which the sweep and the digest go out. */
const SWEEP_HOUR = 6;
const DIGEST_HOUR = 8;
/** The sweep reviews promises due within this many days (or overdue up to OVERDUE_DAYS)... */
const DUE_WITHIN_DAYS = 7;
const OVERDUE_DAYS = 30;
/** ...and accounts renewing within this many days. */
const RENEWAL_WITHIN_DAYS = 30;
/** Accounts analyzed this recently are left alone: the run already saw the same state. */
const RECENT_RUN_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) => new Date(asDate(day).getTime() + n * DAY_MS);

/** The date and hour in a time zone; an unknown zone counts as UTC. */
export function localClock(timezone: string | undefined, now = new Date()): { day: string; hour: number } {
  const format = (tz: string) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
  let parts: Record<string, string>;
  try {
    parts = format(timezone || "UTC");
  } catch {
    parts = format("UTC");
  }
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

interface Deps {
  prisma: PrismaClient;
  agentRunQueue: Queue<AgentRunJobData>;
  emailQueue: Queue<EmailJobData>;
  webOrigin: string;
}

/** The hourly tick: each org gets its sweep and digests once per local day, at or after the set hour. */
export function createDailyProcessor(deps: Deps) {
  return async () => {
    const orgs = await deps.prisma.organization.findMany({ select: { id: true, slug: true, name: true, settings: true } });
    let sweeps = 0;
    let digests = 0;
    for (const org of orgs) {
      const timezone = (org.settings as { profile?: { timezone?: string } } | null)?.profile?.timezone;
      const { day, hour } = localClock(timezone);
      if (hour >= SWEEP_HOUR && (await claimSweep(deps.prisma, org.id, day))) {
        sweeps += await sweepOrg(deps, org.id, day);
      }
      if (hour >= DIGEST_HOUR) digests += await sendDigests(deps, org, day);
    }
    return { orgs: orgs.length, sweepRuns: sweeps, digests };
  };
}

/** Marks today's sweep as taken; false if this or another tick already did. */
async function claimSweep(prisma: PrismaClient, orgId: string, day: string) {
  const claimed = await prisma.organization.updateMany({
    where: { id: orgId, OR: [{ lastSweepOn: null }, { lastSweepOn: { not: asDate(day) } }] },
    data: { lastSweepOn: asDate(day) },
  });
  return claimed.count === 1;
}

/**
 * Agent runs for the accounts where time alone can change the picture: promises coming due or
 * overdue, or a renewal close. Without this, a promise nobody mentions again is never reviewed.
 */
export async function sweepOrg(deps: Deps, orgId: string, day: string): Promise<number> {
  const open = { deletedAt: null, status: "open" as const, type: { in: ["commitment" as const, "obligation" as const] } };
  const accounts = await deps.prisma.account.findMany({
    where: {
      orgId,
      deletedAt: null,
      extractedItems: { some: open },
      OR: [
        { extractedItems: { some: { ...open, dueDate: { gte: addDays(day, -OVERDUE_DAYS), lte: addDays(day, DUE_WITHIN_DAYS) } } } },
        { renewalDate: { gte: asDate(day), lte: addDays(day, RENEWAL_WITHIN_DAYS) } },
      ],
      agentRuns: { none: { createdAt: { gte: new Date(Date.now() - RECENT_RUN_HOURS * 60 * 60 * 1000) }, status: { not: "failed" } } },
    },
    select: { id: true },
  });
  let queued = 0;
  for (const a of accounts) if (await queueAccountRun(deps.prisma, deps.agentRunQueue, orgId, a.id, "schedule")) queued++;
  return queued;
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export interface DigestData {
  name: string | null;
  orgName: string;
  day: string;
  links: { flags: string; approvals: string; commitments: string; theirs: string };
  flags: { title: string; severity: keyof typeof SEVERITY_RANK; account: string; isNew: boolean }[];
  approvals: number;
  dueMine: { summary: string; account: string | null; dueDate: string; overdue: boolean }[];
  theirsOverdue: { summary: string; account: string | null; dueDate: string }[];
}

/** Each person's digest: what's at risk where they can see, what waits for them, what they owe. */
export async function sendDigests(deps: Deps, org: { id: string; slug: string; name: string }, day: string): Promise<number> {
  const { prisma } = deps;
  const members = await prisma.membership.findMany({
    where: { orgId: org.id, OR: [{ lastDigestOn: null }, { lastDigestOn: { not: asDate(day) } }] },
    include: { user: { select: { id: true, email: true, fullName: true, isPlatformAdmin: true } } },
  });
  const base = `${deps.webOrigin}/o/${org.slug}`;
  let sent = 0;

  for (const m of members) {
    // Claim first, so two overlapping ticks can't both send.
    const claimed = await prisma.membership.updateMany({
      where: { id: m.id, OR: [{ lastDigestOn: null }, { lastDigestOn: { not: asDate(day) } }] },
      data: { lastDigestOn: asDate(day) },
    });
    if (claimed.count === 0) continue;

    const viewer: Viewer = { orgId: org.id, userId: m.userId, role: m.role, teamId: m.teamId, isPlatformAdmin: m.user.isPlatformAdmin };
    const accounts = visibleAccountsWhere(viewer);
    const notPrivateToOthers = { OR: [{ visibleToUserId: null }, { visibleToUserId: m.userId }] };
    const [flags, approvals, dueMine, theirsOverdue] = await Promise.all([
      prisma.flag.findMany({
        where: { orgId: org.id, status: { in: ["open", "confirmed"] }, account: accounts, ...notPrivateToOthers },
        select: { title: true, severity: true, createdAt: true, account: { select: { name: true, renewalDate: true } } },
        take: 50,
      }),
      prisma.proposedAction.count({
        where: { orgId: org.id, status: "pending", AND: [notPrivateToOthers, { OR: [{ accountId: null }, { account: accounts }] }] },
      }),
      prisma.extractedItem.findMany({
        where: { orgId: org.id, deletedAt: null, status: "open", type: "commitment", ownerUserId: m.userId, dueDate: { lte: addDays(day, 2) } },
        select: { summary: true, dueDate: true, account: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
        take: 10,
      }),
      // What customers owe on the accounts this person owns: worth chasing.
      prisma.extractedItem.findMany({
        where: { orgId: org.id, deletedAt: null, status: "open", type: "obligation", dueDate: { lt: asDate(day) }, account: { AND: [accounts, { ownerUserId: m.userId }] } },
        select: { summary: true, dueDate: true, account: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
        take: 5,
      }),
    ]);
    if (flags.length === 0 && approvals === 0 && dueMine.length === 0 && theirsOverdue.length === 0) continue;

    const yesterday = Date.now() - DAY_MS;
    const data: DigestData = {
      name: m.user.fullName?.split(" ")[0] ?? null,
      orgName: org.name,
      day,
      links: { flags: `${base}/flags`, approvals: `${base}/approvals`, commitments: `${base}/commitments`, theirs: `${base}/commitments?side=theirs` },
      flags: flags
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.account.renewalDate?.getTime() ?? Infinity) - (b.account.renewalDate?.getTime() ?? Infinity))
        .map((f) => ({ title: f.title, severity: f.severity, account: f.account.name, isNew: f.createdAt.getTime() > yesterday })),
      approvals,
      dueMine: dueMine.map((c) => {
        const due = c.dueDate!.toISOString().slice(0, 10);
        return { summary: c.summary, account: c.account?.name ?? null, dueDate: due, overdue: due < day };
      }),
      theirsOverdue: theirsOverdue.map((c) => ({ summary: c.summary, account: c.account?.name ?? null, dueDate: c.dueDate!.toISOString().slice(0, 10) })),
    };
    await deps.emailQueue.add("digest", { to: m.user.email, ...renderDigest(data) });
    sent++;
  }
  return sent;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** The digest email: a subject that says what's inside, and short sections with links. */
export function renderDigest(d: DigestData): Pick<EmailJobData, "subject" | "html" | "text"> {
  const MAX_FLAGS = 5;
  const headline = [
    d.flags.length > 0 && plural(d.flags.length, "promise at risk", "promises at risk"),
    d.approvals > 0 && plural(d.approvals, "suggestion to review", "suggestions to review"),
    d.dueMine.length > 0 && plural(d.dueMine.length, "of yours due", "of yours due"),
  ].filter(Boolean);
  const subject = `Kept: ${headline.join(", ") || "your day"}`;

  type Section = { title: string; items: string[]; link: { href: string; label: string } };
  const sections: Section[] = [];
  if (d.flags.length > 0) {
    const fresh = d.flags.filter((f) => f.isNew).length;
    sections.push({
      title: `At risk${fresh ? ` (${fresh} new)` : ""}`,
      items: [
        ...d.flags.slice(0, MAX_FLAGS).map((f) => `[${f.severity}] ${f.account}: ${f.title}`),
        ...(d.flags.length > MAX_FLAGS ? [`and ${d.flags.length - MAX_FLAGS} more`] : []),
      ],
      link: { href: d.links.flags, label: "Review flags" },
    });
  }
  if (d.dueMine.length > 0) {
    sections.push({
      title: "Your promises due",
      items: d.dueMine.map((c) => `${c.overdue ? "Overdue since" : "Due"} ${shortDate(c.dueDate)}: ${c.summary}${c.account ? ` (${c.account})` : ""}`),
      link: { href: d.links.commitments, label: "Open commitments" },
    });
  }
  if (d.theirsOverdue.length > 0) {
    sections.push({
      title: "Customers owe you",
      items: d.theirsOverdue.map((c) => `${c.account ? `${c.account}: ` : ""}${c.summary} (was due ${shortDate(c.dueDate)})`),
      link: { href: d.links.theirs, label: "Their promises" },
    });
  }
  if (d.approvals > 0) {
    sections.push({
      title: "Waiting for your decision",
      items: [`${plural(d.approvals, "suggested follow-up", "suggested follow-ups")} (emails, reminders, alerts)`],
      link: { href: d.links.approvals, label: "Open approvals" },
    });
  }

  const greeting = `Good morning${d.name ? ` ${d.name}` : ""}, here's ${d.orgName} today.`;
  const text = [
    greeting,
    "",
    ...sections.flatMap((s) => [s.title, ...s.items.map((i) => `- ${i}`), `${s.link.label}: ${s.link.href}`, ""]),
  ].join("\n");
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#2b2a27;max-width:560px">`,
    `<p>${escapeHtml(greeting)}</p>`,
    ...sections.map(
      (s) =>
        `<h3 style="font-size:14px;margin:20px 0 6px">${escapeHtml(s.title)}</h3><ul style="margin:0;padding-left:18px">${s.items
          .map((i) => `<li>${escapeHtml(i)}</li>`)
          .join("")}</ul><p style="margin:8px 0 0"><a href="${escapeHtml(s.link.href)}" style="color:#155aa7">${escapeHtml(s.link.label)}</a></p>`,
    ),
    `</div>`,
  ].join("");
  return { subject, text, html };
}

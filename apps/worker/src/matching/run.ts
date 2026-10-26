import type { Job } from "bullmq";
import type { Prisma, PrismaClient } from "@kept/db";
import type { Queue } from "bullmq";
import type { ExtractJobData, MatchJobData } from "@kept/shared";
import { autoRoute } from "./auto.js";
import { linkFiles } from "./links.js";
import { FREE_MAIL_DOMAINS, matchItem, normalizeDomain, type MatchContext, type MatchResult } from "./match.js";

const BATCH = 500;

type Props = Record<string, string | null | undefined>;

const text = (v: string | null | undefined) => v?.trim() || null;
/** HubSpot option values are codes: "COMPUTER_SOFTWARE" → "Computer software". */
const label = (v: string | null | undefined) => {
  const t = text(v)?.replace(/_/g, " ").toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
};
/** "america_slash_new_york" → "America/New_York". */
const timezone = (v: string | null | undefined) =>
  text(v)
    ?.split("_slash_")
    .map((part) => part.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_"))
    .join("/") ?? null;
const number = (v: string | null | undefined) => {
  const n = Number(v);
  return text(v) && Number.isFinite(n) ? n : null;
};

/** The company profile HubSpot has; empty properties are left out so they don't erase what Kept knows. */
function companyProfile(p: Props) {
  const employees = number(p.numberofemployees);
  const revenue = number(p.annualrevenue);
  const profile = {
    industry: label(p.industry),
    companyType: label(p.type),
    description: text(p.description),
    employeeCount: employees === null ? null : Math.round(employees),
    annualRevenueCents: revenue === null ? null : BigInt(Math.round(revenue * 100)),
    city: text(p.city),
    region: text(p.state),
    postalCode: text(p.zip),
    country: text(p.country),
    timezone: timezone(p.timezone),
    linkedinUrl: text(p.linkedin_company_page),
  };
  return Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== null));
}

/**
 * HubSpot is the source of truth for the accounts and contacts it holds: companies become
 * accounts and contacts become contacts linked to their company. Runs on records not yet
 * matched (new or changed since the last run).
 */
export async function importCrm(prisma: PrismaClient, orgId: string) {
  const records = await prisma.sourceItem.findMany({
    where: { orgId, kind: "crm_record", matchStatus: "pending", connection: { provider: "hubspot" } },
    select: { metadata: true },
  });
  const props = (m: unknown) => m as Props;
  let accounts = 0;
  let contacts = 0;

  for (const { metadata } of records) {
    const p = props(metadata);
    if (p.object !== "companies" || !p.id) continue;
    const crmExternalId = `hubspot:${p.id}`;
    const data = {
      name: p.name || p.domain || `HubSpot company ${p.id}`,
      domain: p.domain ? normalizeDomain(p.domain) : null,
      ...companyProfile(p),
    };
    const linked = await prisma.account.findUnique({ where: { orgId_crmExternalId: { orgId, crmExternalId } }, select: { id: true } });
    // An account added by hand (or from a CSV) for the same company is adopted, not duplicated:
    // same domain, or same name when the company has no domain. HubSpot keeps it in sync from then on.
    const adopted = linked
      ? null
      : await prisma.account.findFirst({
          where: {
            orgId,
            crmExternalId: null,
            deletedAt: null,
            ...(data.domain ? { domain: data.domain } : { name: { equals: data.name, mode: "insensitive" as const } }),
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
    const target = linked ?? adopted;
    if (target) await prisma.account.update({ where: { id: target.id }, data: { ...data, crmExternalId, deletedAt: null } });
    else await prisma.account.create({ data: { orgId, crmExternalId, ...data } });
    accounts++;
  }

  for (const { metadata } of records) {
    const p = props(metadata);
    if (p.object !== "contacts" || !p.id) continue;
    const crmExternalId = `hubspot:contact:${p.id}`;
    const email = p.email?.trim().toLowerCase() || null;
    const account = p.associatedcompanyid
      ? await prisma.account.findUnique({ where: { orgId_crmExternalId: { orgId, crmExternalId: `hubspot:${p.associatedcompanyid}` } }, select: { id: true } })
      : null;
    const data = {
      fullName: [p.firstname, p.lastname].filter(Boolean).join(" ") || null,
      email,
      title: p.jobtitle || null,
      phone: text(p.phone),
      accountId: account?.id ?? null,
      crmExternalId,
      deletedAt: null,
    };
    // A contact created by hand (or from another source) with the same email is the same person.
    const existing =
      (await prisma.contact.findUnique({ where: { orgId_crmExternalId: { orgId, crmExternalId } }, select: { id: true } })) ??
      (email ? await prisma.contact.findFirst({ where: { orgId, email, deletedAt: null }, select: { id: true } }) : null);
    if (existing) await prisma.contact.update({ where: { id: existing.id }, data });
    else await prisma.contact.create({ data: { orgId, ...data } });
    contacts++;
  }
  return { accounts, contacts };
}

export async function loadContext(prisma: PrismaClient, orgId: string): Promise<MatchContext> {
  const [accounts, contacts, mappings, members] = await Promise.all([
    prisma.account.findMany({ where: { orgId, deletedAt: null }, select: { id: true, domain: true, crmExternalId: true } }),
    prisma.contact.findMany({ where: { orgId, deletedAt: null, accountId: { not: null }, email: { not: null } }, select: { email: true, accountId: true } }),
    prisma.sourceMapping.findMany({ where: { orgId }, select: { connectionId: true, containerId: true, accountId: true, ignored: true, containerLabel: true, origin: true } }),
    prisma.membership.findMany({ where: { orgId }, select: { user: { select: { email: true } } } }),
  ]);

  const accountsByDomain = new Map<string, string[]>();
  const accountsByCrmId = new Map<string, string>();
  for (const a of accounts) {
    if (a.domain) {
      const d = normalizeDomain(a.domain);
      accountsByDomain.set(d, [...(accountsByDomain.get(d) ?? []), a.id]);
    }
    if (a.crmExternalId) accountsByCrmId.set(a.crmExternalId, a.id);
  }

  const internalDomains = new Set<string>();
  for (const m of members) {
    const domain = m.user.email.split("@")[1]?.toLowerCase();
    if (domain && !FREE_MAIL_DOMAINS.has(domain)) internalDomains.add(domain);
  }

  return {
    internalDomains,
    accountsByDomain,
    accountsByCrmId,
    contactAccounts: new Map(contacts.map((c) => [c.email!.toLowerCase(), c.accountId!])),
    mappings: new Map(
      mappings.map((m) => [`${m.connectionId}:${m.containerId}`, { accountId: m.accountId, ignored: m.ignored, label: m.containerLabel, auto: m.origin === "auto" }]),
    ),
  };
}

/**
 * Matches pending items, or every item when rules changed (`all`). Writes only what changed.
 * Containers that the matched items (or their names) tie to one client are then routed to it
 * automatically, and their items matched again.
 */
export async function matchOrg(prisma: PrismaClient, orgId: string, all: boolean) {
  const crm = await importCrm(prisma, orgId);
  const counts: Record<string, number> = {};
  const evaluated = new Set<string>();
  await matchPass(prisma, orgId, await loadContext(prisma, orgId), all ? {} : { matchStatus: "pending" }, counts, evaluated);

  const routed = await autoRoute(prisma, orgId);
  let rematched = 0;
  if (routed.length > 0) {
    // Second pass over the newly routed containers only; counted apart, since these items were counted once already.
    const again: Record<string, number> = {};
    await matchPass(prisma, orgId, await loadContext(prisma, orgId), { OR: routed.map((r) => ({ connectionId: r.connectionId, containerId: r.containerId })) }, again, evaluated);
    rematched = Object.values(again).reduce((s, n) => s + n, 0);
  }

  // Files linked from client conversations follow them (after the rules, so links see final statuses).
  const linkedFiles = await linkFiles(prisma, orgId, [...evaluated]);
  return { ...counts, autoRouted: routed.length, rematched, linkedFiles, importedAccounts: crm.accounts, importedContacts: crm.contacts };
}

async function matchPass(
  prisma: PrismaClient,
  orgId: string,
  ctx: MatchContext,
  filter: Prisma.SourceItemWhereInput,
  counts: Record<string, number>,
  evaluated: Set<string>,
) {
  let cursor: string | undefined;
  for (;;) {
    const items = await prisma.sourceItem.findMany({
      where: { orgId, ...filter },
      select: {
        id: true, author: true, metadata: true, containerId: true, containerLabel: true,
        matchStatus: true, accountId: true, matchReason: true, connectionId: true,
        connection: { select: { provider: true } },
      },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (items.length === 0) break;
    cursor = items.at(-1)!.id;
    for (const i of items) evaluated.add(i.id);

    // Group identical outcomes so each group is one UPDATE.
    const groups = new Map<string, { result: MatchResult; ids: string[] }>();
    for (const item of items) {
      const result = matchItem(
        {
          connectionId: item.connectionId,
          provider: item.connection.provider,
          containerId: item.containerId,
          containerLabel: item.containerLabel,
          author: item.author,
          metadata: item.metadata as Record<string, unknown>,
        },
        ctx,
      );
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      if (item.matchStatus === result.status && item.accountId === result.accountId && item.matchReason === result.reason) continue;
      const key = `${result.status}|${result.accountId}|${result.reason}`;
      const group = groups.get(key) ?? { result, ids: [] };
      group.ids.push(item.id);
      groups.set(key, group);
    }
    for (const { result, ids } of groups.values()) {
      await prisma.sourceItem.updateMany({
        where: { id: { in: ids } },
        data: { matchStatus: result.status, accountId: result.accountId, matchReason: result.reason },
      });
    }
    if (items.length < BATCH) break;
  }
}

/** After matching, newly matched items are read for commitments. */
export function createMatchProcessor(prisma: PrismaClient, extractQueue: Queue<ExtractJobData>) {
  return async (job: Job<MatchJobData>) => {
    const result = await matchOrg(prisma, job.data.orgId, job.data.all ?? false);
    // Extraction finds its own work (matched items with unread content), so an extra job is cheap.
    await extractQueue.add("extract", { orgId: job.data.orgId }, { removeOnComplete: true, removeOnFail: 100 });
    return result;
  };
}

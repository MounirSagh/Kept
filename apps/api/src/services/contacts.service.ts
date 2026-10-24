import { Prisma, type Contact } from "@kept/db";
import { can, type ContactDto, type ContactInput, type ContactRowDto, type ContactsQuery, type PageDto } from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { rematchOrg } from "../lib/queues.js";
import type { OrgActor } from "../types/express.js";
import { canSeeAccount, visibleAccountsWhere } from "./accounts.service.js";

function toDto(c: Contact): ContactDto {
  return {
    id: c.id,
    accountId: c.accountId,
    fullName: c.fullName,
    email: c.email,
    title: c.title,
    phone: c.phone,
    source: c.crmExternalId?.split(":")[0] ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

async function assertVisibleAccount(actor: OrgActor, accountId: string) {
  if (!(await canSeeAccount(actor, accountId))) throw new HttpError(404, "Account not found");
}

function assertCanManage(actor: OrgActor) {
  if (!can(actor, { action: "account.manage" })) throw new HttpError(403, "Forbidden");
}

/** Emails are unique among active contacts in an org (a partial index); say so instead of failing with 500. */
async function save<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Another contact already uses this email");
    }
    throw err;
  }
}

/**
 * Contacts the actor may see: those at companies they can see. Contacts not linked to any
 * company (a CRM contact without one) are shown to people who manage the org, for cleanup.
 */
function visibleContactsWhere(actor: OrgActor): Prisma.ContactWhereInput {
  return {
    orgId: actor.orgId,
    deletedAt: null,
    OR: [{ account: visibleAccountsWhere(actor) }, ...(can(actor, { action: "org.manage" }) ? [{ accountId: null }] : [])],
  };
}

/** One page of the Contacts table, across every company the actor can see. */
export async function listContactsPage(
  actor: OrgActor,
  query: Required<Pick<ContactsQuery, "page" | "pageSize" | "sort" | "dir">> & ContactsQuery,
): Promise<PageDto<ContactRowDto>> {
  const q = query.q?.trim();
  const filters: Prisma.ContactWhereInput[] = [visibleContactsWhere(actor)];
  if (q) {
    filters.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { account: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (query.accountId) filters.push({ accountId: query.accountId === "none" ? null : query.accountId });
  if (query.source) filters.push({ crmExternalId: query.source === "crm" ? { not: null } : null });

  const dir = query.dir;
  const order: Record<NonNullable<ContactsQuery["sort"]>, Prisma.ContactOrderByWithRelationInput> = {
    name: { fullName: { sort: dir, nulls: "last" } },
    email: { email: { sort: dir, nulls: "last" } },
    company: { account: { name: dir } },
    createdAt: { createdAt: dir },
  };
  const where = { AND: filters };
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: { account: { select: { name: true } } },
      orderBy: [order[query.sort], { email: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.contact.count({ where }),
  ]);
  return { items: rows.map((c) => ({ ...toDto(c), accountName: c.account?.name ?? null })), total, page: query.page, pageSize: query.pageSize };
}

export async function listContacts(actor: OrgActor, accountId: string) {
  await assertVisibleAccount(actor, accountId);
  const contacts = await prisma.contact.findMany({
    where: { orgId: actor.orgId, accountId, deletedAt: null },
    orderBy: [{ fullName: { sort: "asc", nulls: "last" } }, { email: "asc" }],
  });
  return contacts.map(toDto);
}

export async function createContact(actor: OrgActor, accountId: string, input: ContactInput) {
  assertCanManage(actor);
  await assertVisibleAccount(actor, accountId);
  const contact = await save(() => prisma.contact.create({ data: { orgId: actor.orgId, accountId, ...input } }));
  // Emails from this address now route to the account.
  if (contact.email) await rematchOrg(actor.orgId);
  return toDto(contact);
}

async function findManaged(actor: OrgActor, contactId: string) {
  assertCanManage(actor);
  const contact = await prisma.contact.findFirst({ where: { id: contactId, orgId: actor.orgId, deletedAt: null } });
  if (!contact || !contact.accountId) throw new HttpError(404, "Contact not found");
  await assertVisibleAccount(actor, contact.accountId);
  if (contact.crmExternalId) throw new HttpError(409, "This contact is kept in sync from your CRM; edit it there");
  return contact;
}

export async function updateContact(actor: OrgActor, contactId: string, input: ContactInput) {
  const existing = await findManaged(actor, contactId);
  const contact = await save(() => prisma.contact.update({ where: { id: existing.id }, data: input }));
  if (contact.email !== existing.email) await rematchOrg(actor.orgId);
  return toDto(contact);
}

/** Soft delete: their emails stop routing to the account. */
export async function deleteContact(actor: OrgActor, contactId: string) {
  const existing = await findManaged(actor, contactId);
  await prisma.contact.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  if (existing.email) await rematchOrg(actor.orgId);
}

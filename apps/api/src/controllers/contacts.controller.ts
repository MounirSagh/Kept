import type { Request, Response } from "express";
import { z } from "zod";
import { PAGE_SIZES } from "@kept/shared";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as contacts from "../services/contacts.service.js";

const accountParams = z.object({ accountId: z.uuid() });
const contactParams = z.object({ contactId: z.uuid() });
const optional = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);
const body = z
  .object({
    fullName: optional(200),
    email: z.string().trim().toLowerCase().max(320).nullable().transform((v) => v || null).refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Invalid email"),
    title: optional(200),
    phone: optional(50),
  })
  .refine((c) => c.fullName || c.email, "Give the contact a name or an email");

const pageQuery = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((n) => (PAGE_SIZES as readonly number[]).includes(n)).default(25),
  sort: z.enum(["name", "email", "company", "createdAt"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  accountId: z.union([z.uuid(), z.literal("none")]).optional(),
  source: z.enum(["crm", "kept"]).optional(),
});

export async function listPage(req: Request, res: Response) {
  res.json(await contacts.listContactsPage(currentActor(req), parse(pageQuery, req.query)));
}

export async function list(req: Request, res: Response) {
  const { accountId } = parse(accountParams, req.params);
  res.json(await contacts.listContacts(currentActor(req), accountId));
}

export async function create(req: Request, res: Response) {
  const { accountId } = parse(accountParams, req.params);
  res.status(201).json(await contacts.createContact(currentActor(req), accountId, parse(body, req.body)));
}

export async function update(req: Request, res: Response) {
  const { contactId } = parse(contactParams, req.params);
  res.json(await contacts.updateContact(currentActor(req), contactId, parse(body, req.body)));
}

export async function remove(req: Request, res: Response) {
  const { contactId } = parse(contactParams, req.params);
  await contacts.deleteContact(currentActor(req), contactId);
  res.status(204).end();
}

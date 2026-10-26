import type { Request, Response } from "express";
import { z } from "zod";
import { PAGE_SIZES } from "@kept/shared";
import { HttpError } from "../lib/http-error.js";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as accounts from "../services/accounts.service.js";

const accountParams = z.object({ accountId: z.uuid() });
/** Optional text: blank becomes null, absent stays absent (left unchanged). */
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
/** A whole or decimal amount in currency units, stored as integer cents. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Use a number like 48000 or 48000.50")
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? String(Math.round(Number(v) * 100)) : null));

const accountBody = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(253).nullable().transform((d) => d || null),
  ownerUserId: z.uuid().nullable(),
  industry: text(100),
  companyType: text(50),
  description: text(5000),
  employeeCount: z.number().int().min(0).max(10_000_000).nullable().optional(),
  annualRevenue: amount,
  city: text(100),
  region: text(100),
  postalCode: text(20),
  country: text(100),
  timezone: text(64),
  linkedinUrl: text(300),
  renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().optional(),
  annualValue: amount,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code").nullable().optional(),
});

/** The form sends amounts in currency units; the service stores cents. */
function toInput(body: z.infer<typeof accountBody>) {
  const { annualRevenue, annualValue, ...rest } = body;
  return { ...rest, annualRevenueCents: annualRevenue, annualValueCents: annualValue };
}

const pageQuery = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((n) => (PAGE_SIZES as readonly number[]).includes(n)).default(25),
  sort: z.enum(["name", "contactCount", "annualValue", "renewalDate", "createdAt"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  owner: z.union([z.uuid(), z.literal("none")]).optional(),
  source: z.enum(["crm", "kept"]).optional(),
  renewal: z.enum(["30d", "90d", "passed"]).optional(),
  type: z.string().trim().max(50).optional(),
});

export async function listPage(req: Request, res: Response) {
  res.json(await accounts.listAccountsPage(currentActor(req), parse(pageQuery, req.query)));
}

export async function list(req: Request, res: Response) {
  res.json(await accounts.listAccounts(currentActor(req)));
}

export async function get(req: Request, res: Response) {
  const { accountId } = parse(accountParams, req.params);
  const account = await accounts.getAccount(currentActor(req), accountId);
  if (!account) throw new HttpError(404, "Not found");
  res.json(account);
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await accounts.createAccount(currentActor(req), toInput(parse(accountBody, req.body))));
}

export async function update(req: Request, res: Response) {
  const { accountId } = parse(accountParams, req.params);
  res.json(await accounts.updateAccount(currentActor(req), accountId, toInput(parse(accountBody, req.body))));
}

export async function documents(req: Request, res: Response) {
  const { accountId } = parse(accountParams, req.params);
  res.json(await accounts.listAccountDocuments(currentActor(req), accountId));
}

export async function remove(req: Request, res: Response) {
  const { accountId } = parse(accountParams, req.params);
  await accounts.deleteAccount(currentActor(req), accountId);
  res.status(204).end();
}

const importBody = z.object({
  rows: z.array(
    z.object({
      row: z.number().int().positive(),
      name: z.string().trim().min(1).max(200),
      domain: z.string().trim().max(253).nullable(),
      ownerEmail: z.string().trim().toLowerCase().max(320).nullable(),
      renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      annualValue: z.number().finite().nonnegative().nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    }),
  ),
});

export async function importRows(req: Request, res: Response) {
  res.json(await accounts.importAccounts(currentActor(req), parse(importBody, req.body).rows));
}

import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@kept/db";
import { parse } from "../lib/validate.js";
import { currentActor, currentUser } from "../middlewares/auth.js";
import { createOrganization, getOrganization, updateOrganization } from "../services/orgs.service.js";

// Blank inputs become absent, so the stored profile only holds what was filled in.
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const profileSchema = z.object({
  legalName: text(200),
  website: text(300),
  industry: text(100),
  description: text(2000),
  email: z.union([z.literal(""), z.email().trim()]).optional().transform((v) => v || undefined),
  phone: text(50),
  address: z
    .object({ line1: text(200), line2: text(200), city: text(100), region: text(100), postalCode: text(20), country: text(100) })
    .optional(),
  timezone: text(64).refine((tz) => !tz || Intl.supportedValuesOf("timeZone").includes(tz), "Unknown time zone"),
  currency: z.string().trim().toUpperCase().regex(/^([A-Z]{3})?$/, "Use a 3-letter currency code").optional().transform((v) => v || undefined),
  emailSignature: text(2000),
});
const updateBody = z.object({ name: z.string().trim().min(1).max(100).optional(), profile: profileSchema.optional() });

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(50),
});

export async function create(req: Request, res: Response) {
  const body = createBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: z.flattenError(body.error) });
    return;
  }
  try {
    const org = await createOrganization(currentUser(req).id, body.data.name, body.data.slug);
    res.status(201).json(org);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: "Slug already taken" });
      return;
    }
    throw err;
  }
}

export async function get(req: Request, res: Response) {
  res.json(await getOrganization(currentActor(req).orgId));
}

export async function update(req: Request, res: Response) {
  res.json(await updateOrganization(currentActor(req).orgId, parse(updateBody, req.body)));
}

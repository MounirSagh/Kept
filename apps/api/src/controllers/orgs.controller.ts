import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@kept/db";
import { parse } from "../lib/validate.js";
import { currentActor, currentUser } from "../middlewares/auth.js";
import { createOrganization, renameOrganization } from "../services/orgs.service.js";

const renameBody = z.object({ name: z.string().trim().min(1).max(100) });

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

export async function rename(req: Request, res: Response) {
  const { name } = parse(renameBody, req.body);
  res.json(await renameOrganization(currentActor(req).orgId, name));
}

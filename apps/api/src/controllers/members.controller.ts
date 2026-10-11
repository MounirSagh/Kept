import type { Request, Response } from "express";
import { z } from "zod";
import { ORG_ROLES } from "@kept/shared";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as members from "../services/members.service.js";

const memberParams = z.object({ userId: z.uuid() });
const updateBody = z
  .object({ role: z.enum(ORG_ROLES), teamId: z.uuid().nullable() })
  .partial()
  .refine((b) => b.role !== undefined || b.teamId !== undefined);

export async function list(req: Request, res: Response) {
  res.json(await members.listMembers(currentActor(req).orgId));
}

export async function update(req: Request, res: Response) {
  const { userId } = parse(memberParams, req.params);
  await members.updateMember(currentActor(req), userId, parse(updateBody, req.body));
  res.status(204).end();
}

export async function remove(req: Request, res: Response) {
  const { userId } = parse(memberParams, req.params);
  await members.removeMember(currentActor(req), userId);
  res.status(204).end();
}

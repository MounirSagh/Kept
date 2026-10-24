import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as flags from "../services/flags.service.js";

const params = z.object({ flagId: z.uuid() });
const listQuery = z.object({ status: z.enum(["open", "closed"]).default("open"), accountId: z.uuid().optional() });
const decision = z.object({
  status: z.enum(["confirmed", "dismissed", "resolved"]),
  note: z.string().trim().max(2000).optional(),
});

export async function list(req: Request, res: Response) {
  res.json(await flags.listFlags(currentActor(req), parse(listQuery, req.query)));
}

export async function decide(req: Request, res: Response) {
  const { flagId } = parse(params, req.params);
  res.json(await flags.decideFlag(currentActor(req), flagId, parse(decision, req.body)));
}

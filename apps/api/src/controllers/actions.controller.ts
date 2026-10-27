import type { Request, Response } from "express";
import { z } from "zod";
import type { ActionPayload } from "@kept/shared";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as actions from "../services/actions.service.js";

const params = z.object({ actionId: z.uuid() });
const listQuery = z.object({ view: z.enum(["pending", "history"]).default("pending"), accountId: z.uuid().optional() });
const decision = z.object({
  decision: z.enum(["approve", "reject"]),
  // Checked against the action's type in the service.
  payload: z.record(z.string(), z.unknown()).optional(),
  note: z.string().trim().max(2000).optional(),
});

export async function list(req: Request, res: Response) {
  res.json(await actions.listActions(currentActor(req), parse(listQuery, req.query)));
}

export async function decide(req: Request, res: Response) {
  const { actionId } = parse(params, req.params);
  const input = parse(decision, req.body);
  res.json(await actions.decideAction(currentActor(req), actionId, { ...input, payload: input.payload as ActionPayload | undefined }));
}

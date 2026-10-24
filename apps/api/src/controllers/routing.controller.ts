import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../lib/validate.js";
import { currentActor } from "../middlewares/auth.js";
import * as routing from "../services/routing.service.js";

const mappingParams = z.object({ connectionId: z.uuid(), containerId: z.string().min(1).max(500) });
const mappingBody = z.object({ accountId: z.uuid().nullable(), ignored: z.boolean() });

export async function get(req: Request, res: Response) {
  res.json(await routing.getRouting(currentActor(req)));
}

export async function setMapping(req: Request, res: Response) {
  const { connectionId, containerId } = parse(mappingParams, req.params);
  await routing.setMapping(currentActor(req), connectionId, containerId, parse(mappingBody, req.body));
  res.status(204).end();
}

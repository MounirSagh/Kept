import type { Request, Response } from "express";
import { z } from "zod";
import { TriggerType } from "@kept/db";
import { currentActor } from "../middlewares/auth.js";
import * as agentRuns from "../services/agent-runs.service.js";

const runParams = z.object({ runId: z.uuid() });
const createBody = z.object({
  accountId: z.uuid().optional(),
  trigger: z.enum(TriggerType),
  triggerRef: z.string().min(1).optional(),
});

export async function create(req: Request, res: Response) {
  const body = createBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const run = await agentRuns.createAgentRun(currentActor(req), body.data);
  res.status(201).json(run);
}

export async function list(req: Request, res: Response) {
  res.json(await agentRuns.listAgentRuns(currentActor(req)));
}

export async function get(req: Request, res: Response) {
  const params = runParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const run = await agentRuns.getAgentRun(currentActor(req), params.data.runId);
  if (!run) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(run);
}

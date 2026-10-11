import { Router } from "express";
import * as agentRuns from "../controllers/agent-runs.controller.js";

export const agentRunsRouter = Router({ mergeParams: true });

agentRunsRouter.get("/", agentRuns.list);
agentRunsRouter.post("/", agentRuns.create);
agentRunsRouter.get("/:runId", agentRuns.get);

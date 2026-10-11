import { Queue } from "bullmq";
import { AGENT_RUN_QUEUE, type AgentRunJobData } from "@kept/shared";
import { redis } from "./redis.js";

export const agentRunQueue = new Queue<AgentRunJobData>(AGENT_RUN_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

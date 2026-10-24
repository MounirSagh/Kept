import { Queue } from "bullmq";
import {
  ACTION_QUEUE, AGENT_RUN_QUEUE, EMAIL_QUEUE, LEARN_QUEUE, MATCH_QUEUE, SOURCE_SYNC_QUEUE,
  type ActionJobData, type AgentRunJobData, type EmailJobData, type LearnJobData, type MatchJobData, type SourceSyncJobData,
} from "@kept/shared";
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

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    // Emails can carry invite links, which exist nowhere else in plain text: drop jobs once done.
    removeOnComplete: true,
    removeOnFail: { age: 24 * 60 * 60 },
  },
});

export const sourceSyncQueue = new Queue<SourceSyncJobData>(SOURCE_SYNC_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export const matchQueue = new Queue<MatchJobData>(MATCH_QUEUE, {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: 100 },
});

/**
 * Routing rules changed (accounts, contacts or mappings): re-evaluate every item in the org.
 * No fixed job id: BullMQ would drop the job if one with that id were already running, losing the change.
 * Matching is idempotent, so an extra run is harmless.
 */
export function rematchOrg(orgId: string) {
  return matchQueue.add("match", { orgId, all: true });
}

/** Approved actions. One attempt: the worker records failures itself, and a retried send could reach a customer twice. */
export const actionQueue = new Queue<ActionJobData>(ACTION_QUEUE, {
  connection: redis,
  defaultJobOptions: { attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 },
});

/** Lessons from people's decisions, stored in H-MEM by the worker (embedding needs OpenAI). */
export const learnQueue = new Queue<LearnJobData>(LEARN_QUEUE, {
  connection: redis,
  defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true, removeOnFail: 1000 },
});

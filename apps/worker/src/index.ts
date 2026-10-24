import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { createPrismaClient } from "@kept/db";
import { connectorConfig } from "@kept/connectors";
import { openAIChatModel } from "@kept/agents";
import {
  ACTION_QUEUE, AGENT_RUN_QUEUE, EMAIL_QUEUE, EXTRACT_QUEUE, LEARN_QUEUE, MATCH_QUEUE, SOURCE_SYNC_QUEUE,
  type ActionJobData, type AgentRunJobData, type EmailJobData, type ExtractJobData, type LearnJobData,
  type MatchJobData, type SourceSyncJobData,
} from "@kept/shared";
import { createActionProcessor } from "./agents/execute.js";
import { createExtractProcessor } from "./agents/extract.js";
import { createLearnProcessor } from "./agents/memory.js";
import { createAgentRunProcessor } from "./agents/run.js";
import { env } from "./env.js";
import { createEmailProcessor } from "./send-email.js";
import { createMatchProcessor } from "./matching/run.js";
import { createSourceSyncProcessor } from "./sync-source.js";

const prisma = createPrismaClient(env.DATABASE_URL);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const model = env.OPENAI_API_KEY ? openAIChatModel({ apiKey: env.OPENAI_API_KEY }) : null;
if (!model) console.warn("OPENAI_API_KEY not set: extraction and agent runs will wait until it is");

const agentRunQueue = new Queue<AgentRunJobData>(AGENT_RUN_QUEUE, {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
});
const worker = new Worker<AgentRunJobData>(AGENT_RUN_QUEUE, createAgentRunProcessor(prisma, model), {
  connection,
  concurrency: env.WORKER_CONCURRENCY,
});

worker.on("ready", () => console.log(`worker listening on queue "${AGENT_RUN_QUEUE}"`));
worker.on("completed", (job) => console.log(`run ${job.data.runId} completed`));
worker.on("failed", async (job, err) => {
  console.error(`run ${job?.data.runId} failed:`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await prisma.agentRun.update({
      where: { id: job.data.runId },
      data: { status: "failed", error: err.message, finishedAt: new Date() },
    });
  }
});

const emailWorker = new Worker<EmailJobData>(
  EMAIL_QUEUE,
  createEmailProcessor({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }),
  { connection, concurrency: 5 },
);

// Log recipient and subject only: the body can contain an invite link.
emailWorker.on("ready", () => console.log(`worker listening on queue "${EMAIL_QUEUE}"`));
emailWorker.on("completed", (job) => console.log(`email "${job.data.subject}" sent to ${job.data.to}`));
emailWorker.on("failed", (job, err) => {
  const final = !job || job.attemptsMade >= (job.opts.attempts ?? 1) || err.name === "UnrecoverableError";
  console.error(`email "${job?.data.subject}" to ${job?.data.to} ${final ? "failed" : "will retry"}: ${err.message}`);
});

const connectors = connectorConfig(process.env);
if (!connectors) console.warn("TOKEN_ENCRYPTION_KEY not set: source sync jobs will fail until it is");
const sourceSyncQueue = new Queue<SourceSyncJobData>(SOURCE_SYNC_QUEUE, { connection });
const matchQueue = new Queue<MatchJobData>(MATCH_QUEUE, { connection });
const extractQueue = new Queue<ExtractJobData>(EXTRACT_QUEUE, {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 30_000 } },
});
const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection,
  defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: { age: 24 * 60 * 60 } },
});
const syncWorker = new Worker<SourceSyncJobData>(
  SOURCE_SYNC_QUEUE,
  createSourceSyncProcessor(prisma, connectors, sourceSyncQueue, matchQueue),
  // Syncs are network-bound and long; the per-connection claim prevents overlap.
  { connection, concurrency: 4, lockDuration: 5 * 60 * 1000 },
);
syncWorker.on("ready", () => console.log(`worker listening on queue "${SOURCE_SYNC_QUEUE}"`));
syncWorker.on("completed", (job, result) => console.log(`sync ${job.data.connectionId}: ${JSON.stringify(result)}`));
syncWorker.on("failed", (job, err) => console.error(`sync ${job?.data.connectionId} failed: ${err.message}`));

// Matching is CPU- and database-bound and runs per org; one at a time keeps ordering simple.
const matchWorker = new Worker<MatchJobData>(MATCH_QUEUE, createMatchProcessor(prisma, extractQueue), { connection, concurrency: 1 });
matchWorker.on("ready", () => console.log(`worker listening on queue "${MATCH_QUEUE}"`));
matchWorker.on("completed", (job, result) => console.log(`matched org ${job.data.orgId}: ${JSON.stringify(result)}`));
matchWorker.on("failed", (job, err) => console.error(`matching org ${job?.data.orgId} failed: ${err.message}`));

// One org at a time per worker slot; model calls dominate, and their rate limits are per API key.
const extractWorker = new Worker<ExtractJobData>(
  EXTRACT_QUEUE,
  createExtractProcessor({ prisma, model, extractQueue, agentRunQueue }),
  { connection, concurrency: 2, lockDuration: 10 * 60 * 1000 },
);
extractWorker.on("ready", () => console.log(`worker listening on queue "${EXTRACT_QUEUE}"`));
extractWorker.on("completed", (job, result) => console.log(`extracted org ${job.data.orgId}: ${JSON.stringify(result)}`));
extractWorker.on("failed", (job, err) => console.error(`extraction for org ${job?.data.orgId} failed: ${err.message}`));

const actionWorker = new Worker<ActionJobData>(
  ACTION_QUEUE,
  createActionProcessor({ prisma, config: connectors, emailQueue, webOrigin: env.WEB_ORIGIN }),
  { connection, concurrency: 2 },
);
actionWorker.on("ready", () => console.log(`worker listening on queue "${ACTION_QUEUE}"`));
actionWorker.on("completed", (job, result) => console.log(`action ${job.data.actionId}: ${JSON.stringify(result)}`));
actionWorker.on("failed", (job, err) => console.error(`action ${job?.data.actionId} failed: ${err.message}`));

const learnWorker = new Worker<LearnJobData>(LEARN_QUEUE, createLearnProcessor(prisma), { connection, concurrency: 1 });
learnWorker.on("ready", () => console.log(`worker listening on queue "${LEARN_QUEUE}"`));
learnWorker.on("failed", (job, err) => console.error(`learning for org ${job?.data.orgId} failed: ${err.message}`));

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  await Promise.all([worker.close(), emailWorker.close(), syncWorker.close(), matchWorker.close(), extractWorker.close(), actionWorker.close(), learnWorker.close()]);
  await Promise.all([sourceSyncQueue.close(), matchQueue.close(), extractQueue.close(), emailQueue.close(), agentRunQueue.close()]);
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

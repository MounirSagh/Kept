import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createPrismaClient } from "@kept/db";
import { AGENT_RUN_QUEUE, type AgentRunJobData } from "@kept/shared";
import { env } from "./env.js";
import { createAgentRunProcessor } from "./process-agent-run.js";

const prisma = createPrismaClient(env.DATABASE_URL);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker<AgentRunJobData>(AGENT_RUN_QUEUE, createAgentRunProcessor(prisma), {
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

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

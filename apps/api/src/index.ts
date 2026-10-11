import { app } from "./app.js";
import { env } from "./env.js";
import { prisma } from "./lib/prisma.js";
import { agentRunQueue } from "./lib/queues.js";
import { redis } from "./lib/redis.js";

const server = app.listen(env.API_PORT, () => {
  console.log(`api listening on :${env.API_PORT}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await agentRunQueue.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

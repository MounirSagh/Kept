import { Router } from "express";
import type { HealthDto } from "@kept/shared";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const [postgres, redisStatus] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
  ]);
  const ok = postgres.status === "fulfilled" && redisStatus.status === "fulfilled";

  const body: HealthDto = {
    status: ok ? "ok" : "degraded",
    postgres: postgres.status === "fulfilled",
    redis: redisStatus.status === "fulfilled",
  };
  res.status(ok ? 200 : 503).json(body);
});

import { Redis } from "ioredis";
import { env } from "../env.js";

// maxRetriesPerRequest: null is required for connections shared with BullMQ.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

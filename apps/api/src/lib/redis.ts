import { Redis } from "ioredis";
import { env } from "../env.js";

// maxRetriesPerRequest: null is required for connections shared with BullMQ.
// family 0: IPv4 or IPv6, as private networks like Railway's are IPv6 only.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, family: 0 });

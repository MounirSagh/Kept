import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  API_PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.url(),
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  // Optional until the Clerk webhook is configured; the webhook route returns 503 without it.
  CLERK_WEBHOOK_SIGNING_SECRET: z.preprocess((v) => v || undefined, z.string().startsWith("whsec_").optional()),
});

export const env = schema.parse(process.env);

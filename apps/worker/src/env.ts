import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().positive(),
  RESEND_API_KEY: z.preprocess((v) => v || undefined, z.string().startsWith("re_").optional()),
  // Resend's shared sender works without a verified domain, but only delivers to your own Resend account email.
  EMAIL_FROM: z.preprocess((v) => v || undefined, z.string().min(3).default("Kept <onboarding@resend.dev>")),
  // Links in reminder and alert emails point here.
  WEB_ORIGIN: z.string().url(),
  // Without it, extraction and agent runs wait instead of failing.
  OPENAI_API_KEY: z.preprocess((v) => v || undefined, z.string().optional()),
});

export const env = schema.parse(process.env);

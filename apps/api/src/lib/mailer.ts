import type { EmailJobData } from "@kept/shared";
import { env } from "../env.js";
import { emailQueue } from "./queues.js";

/**
 * Hands a rendered email to the worker, which sends it with retries. Never throws.
 * Returns false when email isn't configured (local dev without RESEND_API_KEY: the email is
 * logged instead) or the queue is unreachable, so callers can fall back to sharing a link.
 */
export async function queueEmail(email: EmailJobData): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail] RESEND_API_KEY not set; not sending "${email.subject}" to ${email.to}\n${email.text}`);
    return false;
  }
  try {
    await emailQueue.add("send", email);
    return true;
  } catch (err) {
    console.error(`[mail] could not queue "${email.subject}" to ${email.to}:`, err);
    return false;
  }
}

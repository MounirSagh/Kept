import { UnrecoverableError, type Job } from "bullmq";
import type { EmailJobData } from "@kept/shared";

interface MailConfig {
  apiKey: string | undefined;
  from: string;
}

/**
 * Delivers a rendered email through Resend. Network errors, rate limits and 5xx responses
 * throw so BullMQ retries with backoff; other 4xx responses (bad sender, unverified domain)
 * can't succeed on retry and fail the job immediately.
 */
export function createEmailProcessor(config: MailConfig) {
  return async (job: Job<EmailJobData>) => {
    const { to, subject, html, text } = job.data;
    if (!config.apiKey) {
      // The API only queues when it has a key, so this is a worker configuration problem.
      throw new Error("RESEND_API_KEY is not set on the worker");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [to], subject, html, text }),
    });
    if (res.ok) return;
    const detail = `${res.status} ${await res.text()}`;
    if (res.status === 429 || res.status >= 500) throw new Error(`Resend temporarily failed: ${detail}`);
    throw new UnrecoverableError(`Resend rejected the email: ${detail}`);
  };
}

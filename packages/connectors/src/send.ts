// Sending email from a person's own mailbox, for actions they approved in Kept.

import type { ApiClient } from "./http.js";
import type { ProviderId } from "./types.js";

/** The scope each mailbox provider needs to send. Connections made before it was added lack it. */
export const SEND_SCOPES: Partial<Record<ProviderId, string>> = {
  google: "https://www.googleapis.com/auth/gmail.send",
  microsoft: "Mail.Send",
};

export function canSendMail(provider: string, scopes: string[]): boolean {
  const needed = SEND_SCOPES[provider as ProviderId];
  // Microsoft may report scopes with the Graph resource prefix.
  return !!needed && scopes.some((s) => s === needed || s.endsWith(`/${needed}`));
}

export interface OutgoingMail {
  to: string[];
  subject: string;
  /** Plain text. */
  body: string;
}

/** RFC 2047 encoded-word, so subjects outside ASCII survive. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** A plain-text RFC 5322 message; Gmail fills in From with the authenticated account. */
export function rfc822(mail: OutgoingMail): string {
  const lines = [
    `To: ${mail.to.join(", ")}`,
    `Subject: ${encodeHeader(mail.subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ];
  return lines.join("\r\n");
}

/**
 * Sends through the provider's API and returns its message id when it gives one.
 * The client must not retry (see connectionClient's maxRetries): a retried send can deliver twice.
 */
export async function sendMail(provider: string, client: ApiClient, mail: OutgoingMail): Promise<{ messageId: string | null }> {
  if (provider === "google") {
    const raw = Buffer.from(rfc822(mail), "utf8").toString("base64url");
    const res = await client.json<{ id?: string }>("/gmail/v1/users/me/messages/send", { method: "POST", body: { raw } });
    return { messageId: res.id ?? null };
  }
  if (provider === "microsoft") {
    // sendMail answers 202 with no body.
    await client.raw("/me/sendMail", {
      method: "POST",
      body: {
        message: {
          subject: mail.subject,
          body: { contentType: "Text", content: mail.body },
          toRecipients: mail.to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      },
    });
    return { messageId: null };
  }
  throw new Error(`${provider} can't send email`);
}

import { z } from "zod";
import type { ChatModel, Usage } from "./model.js";
import { cleanExcerpt, containsExcerpt, isoDate } from "./text.js";

/** Contracts carry their terms at the start (term, fees) and the end (signature, renewal clauses). */
const HEAD_CHARS = 20_000;
const TAIL_CHARS = 6_000;

const CONTRACT_WORDS = /\b(agreement|contract|order form|statement of work|SOW|MSA|renewal|subscription|terms of service|amendment|addendum)\b/i;

/** Whether a document is worth reading for contract terms: its name or opening says contract. */
export function looksLikeContract(title: string | null | undefined, content: string): boolean {
  return CONTRACT_WORDS.test(title ?? "") || CONTRACT_WORDS.test(content.slice(0, 3_000));
}

export interface ContractTerms {
  kind: string;
  /** YYYY-MM-DD: the next renewal, or the end of the current term. */
  renewalDate: string | null;
  noticeDays: number | null;
  /** Yearly fee, in currency units. */
  annualValue: number | null;
  /** ISO 4217. */
  currency: string | null;
  /** The exact words the terms come from. */
  excerpt: string;
}

const schema = z.object({
  isContract: z.boolean().describe("True only for an agreement between the company and this customer (MSA, order form, SOW, renewal, amendment)."),
  kind: z.enum(["msa", "order_form", "sow", "renewal", "amendment", "other_contract", "not_a_contract"]),
  renewalDate: z.string().nullable().describe("YYYY-MM-DD: when the current term ends or renews next, computed from the start date and term if needed. Null if not stated."),
  noticeDays: z.number().nullable().describe("Days of notice required to cancel or not renew. Null if not stated."),
  annualValue: z.number().nullable().describe("What the customer pays per year, in currency units (convert monthly fees to yearly). Null if not stated."),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. USD."),
  excerpt: z.string().describe("The exact words stating the term or renewal, or the fee, copied verbatim."),
});

const SYSTEM = `You read a customer contract for the account team: when it renews, the notice needed to cancel, and what the customer pays per year.
Only report what the document states. Compute the renewal date from a start date and term length when both are given. If the document isn't an agreement with the customer, say so.
The excerpt must be copied character for character from the document: it is checked.`;

/**
 * The renewal date, notice period and yearly value a contract states, for suggesting onto the
 * account (a person approves them). Null when it isn't a contract or states none of them.
 */
export async function readContractTerms(
  model: ChatModel,
  doc: { title: string | null; content: string; accountName: string; today: string },
): Promise<{ terms: ContractTerms | null; usage: Usage }> {
  const content =
    doc.content.length <= HEAD_CHARS + TAIL_CHARS
      ? doc.content
      : `${doc.content.slice(0, HEAD_CHARS)}\n\n[... middle of the document omitted ...]\n\n${doc.content.slice(-TAIL_CHARS)}`;
  const { data, usage } = await model.structured({
    name: "contract_terms",
    tier: "fast",
    schema,
    system: SYSTEM,
    user: `Today: ${doc.today}\nCustomer: ${doc.accountName}\nDocument: ${doc.title ?? "(untitled)"}\n\n${content}`,
  });
  if (!data.isContract || data.kind === "not_a_contract" || !containsExcerpt(doc.content, data.excerpt)) return { terms: null, usage };

  const renewalDate = isoDate(data.renewalDate);
  const annualValue = data.annualValue !== null && Number.isFinite(data.annualValue) && data.annualValue > 0 ? Math.round(data.annualValue * 100) / 100 : null;
  const currency = data.currency && /^[A-Z]{3}$/.test(data.currency.trim().toUpperCase()) ? data.currency.trim().toUpperCase() : null;
  const noticeDays = data.noticeDays !== null && data.noticeDays > 0 && data.noticeDays < 400 ? Math.round(data.noticeDays) : null;
  if (!renewalDate && annualValue === null) return { terms: null, usage };
  return { terms: { kind: data.kind, renewalDate, noticeDays, annualValue, currency, excerpt: cleanExcerpt(data.excerpt) }, usage };
}

import { z } from "zod";
import type { ChatModel, Usage } from "./model.js";
import { clampConfidence, cleanExcerpt, containsExcerpt, isoDate, truncate } from "./text.js";

/** Longer content is cut; the start of a thread or document carries most commitments. */
const MAX_CONTENT_CHARS = 12_000;
/** Below this, items are left out: the model is unsure enough that a person would be misled. */
const MIN_CONFIDENCE = 0.5;

export const ITEM_TYPES = ["commitment", "obligation", "decision", "deadline", "preference", "risk"] as const;
export type ExtractedType = (typeof ITEM_TYPES)[number];

export interface ExtractionInput {
  org: { name: string; internalDomains: string[] };
  account: { name: string; domain: string | null };
  item: {
    kind: string;
    provider: string;
    title: string | null;
    author: string | null;
    occurredAt: Date;
    container: string | null;
    content: string;
  };
  /** Open items already tracked for the account, so the model reports changes instead of duplicates. */
  known: { ref: string; type: string; summary: string; dueDate: string | null; madeBy: string | null }[];
}

export interface ExtractedFinding {
  type: ExtractedType;
  summary: string;
  madeBy: string | null;
  ownerEmail: string | null;
  dueDate: string | null;
  confidence: number;
  excerpt: string;
}

export interface StatusUpdate {
  ref: string;
  status: "fulfilled" | "broken" | "superseded";
  excerpt: string;
}

export interface ExtractionResult {
  items: ExtractedFinding[];
  updates: StatusUpdate[];
  /** Results dropped because their excerpt wasn't in the source, or confidence was too low. */
  dropped: number;
  usage: Usage;
}

const schema = z.object({
  items: z.array(
    z.object({
      type: z.enum(ITEM_TYPES),
      summary: z.string().describe("One short sentence naming what is owed, e.g. \"Send Lina the updated security questionnaire\". No date: it goes in dueDate."),
      madeBy: z.string().nullable().describe("Name or email of the person who made it."),
      ownerEmail: z.string().nullable().describe("Email of the person responsible for delivering it, if known."),
      dueDate: z.string().nullable().describe("YYYY-MM-DD, resolved against the item's date. Null if none."),
      confidence: z.number().describe("0 to 1."),
      excerpt: z.string().describe("The exact words from the content it comes from, copied verbatim."),
    }),
  ),
  updates: z.array(
    z.object({
      ref: z.string().describe("The ref of a known item, e.g. K3."),
      status: z.enum(["fulfilled", "broken", "superseded"]),
      excerpt: z.string().describe("The exact words from the content showing the change, copied verbatim."),
    }),
  ),
});

const SYSTEM = `You read one message, ticket, note or document from a company's tools and pull out what the company and its customer owe each other.

Types:
- commitment: something someone at the company promised the customer ("we'll ship the fix by the 14th").
- obligation: something the customer promised the company ("we'll send the signed order form Monday").
- deadline: a date that matters to the relationship (renewal, go-live, contract end) without a specific promise.
- decision: something agreed that changes the plan ("we agreed to extend the pilot two weeks").
- preference: how the customer wants to be treated ("only email Lina about billing").
- risk: frustration, a competitor mentioned, a threat to leave, a blocker.

Rules:
- Only what the content states. Never infer promises that aren't there. Pleasantries ("let's catch up") are not commitments.
- excerpt must be copied character for character from the content: it is checked, and anything not found is discarded.
- Resolve relative dates ("Friday", "next week", "end of month") against the item's date. Use null when there is no date.
- People whose email domain is one of the company's domains work at the company; everyone else is the customer or a third party.
- Known items are already tracked. Don't repeat them. Report a change to one in updates, with its ref:
  - fulfilled: the content shows it was delivered.
  - broken: the content says it was missed or won't be delivered as promised. A due date having passed, or the promise being repeated, is not evidence either way: report nothing.
  - superseded: it was explicitly withdrawn, cancelled or replaced by a different promise.
- A delay or blocker announced before the due date does not break a promise: leave it open, and report the slip as a new risk item.
- Return empty arrays when there is nothing.`;

function render(input: ExtractionInput): string {
  const { item } = input;
  const when = item.occurredAt;
  const known = input.known.length
    ? input.known.map((k) => `${k.ref} [${k.type}] ${k.summary}${k.dueDate ? ` (due ${k.dueDate})` : ""}${k.madeBy ? ` by ${k.madeBy}` : ""}`).join("\n")
    : "(none)";
  return [
    `Company: ${input.org.name} (domains: ${input.org.internalDomains.join(", ") || "unknown"})`,
    `Customer account: ${input.account.name}${input.account.domain ? ` (${input.account.domain})` : ""}`,
    "",
    `Known items for this account:\n${known}`,
    "",
    `Item: ${item.kind} from ${item.provider}${item.container ? ` in ${item.container}` : ""}`,
    `Date: ${when.toISOString().slice(0, 10)} (${when.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })})`,
    item.title ? `Title: ${item.title}` : null,
    item.author ? `Author: ${item.author}` : null,
    "",
    "Content:",
    truncate(item.content, MAX_CONTENT_CHARS),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Reads one item. Results are checked against the content before they're returned. */
export async function extractFromItem(model: ChatModel, input: ExtractionInput): Promise<ExtractionResult> {
  const content = truncate(input.item.content, MAX_CONTENT_CHARS);
  const { data, usage } = await model.structured({ name: "extract", tier: "fast", system: SYSTEM, user: render(input), schema });

  const known = new Set(input.known.map((k) => k.ref));
  const seen = new Set<string>();
  const items: ExtractedFinding[] = [];
  let dropped = 0;

  for (const raw of data.items) {
    const confidence = clampConfidence(raw.confidence);
    const summary = raw.summary.trim();
    const key = `${raw.type}|${summary.toLowerCase()}`;
    if (!summary || confidence < MIN_CONFIDENCE || !containsExcerpt(content, raw.excerpt) || seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    items.push({
      type: raw.type,
      summary,
      madeBy: raw.madeBy?.trim() || null,
      ownerEmail: raw.ownerEmail?.trim().toLowerCase() || null,
      dueDate: isoDate(raw.dueDate),
      confidence,
      excerpt: cleanExcerpt(raw.excerpt),
    });
  }

  const dueByRef = new Map(input.known.map((k) => [k.ref, k.dueDate]));
  const itemDay = input.item.occurredAt.toISOString().slice(0, 10);
  const updates: StatusUpdate[] = [];
  for (const u of data.updates) {
    // Nothing is broken before it's due: an early slip is a risk, reported as its own item.
    const due = dueByRef.get(u.ref);
    const notYetDue = u.status === "broken" && !!due && due >= itemDay;
    if (!known.has(u.ref) || !containsExcerpt(content, u.excerpt) || notYetDue) {
      dropped++;
      continue;
    }
    updates.push({ ref: u.ref, status: u.status, excerpt: cleanExcerpt(u.excerpt) });
  }

  return { items, updates, dropped, usage };
}

import { z } from "zod";
import type { ChatModel, Usage } from "./model.js";
import { clampConfidence, cleanExcerpt, containsExcerpt, isoDate, truncate } from "./text.js";

/** Longer messages are cut; the start of a thread carries most commitments. */
const MAX_CONTENT_CHARS = 12_000;
/**
 * Documents (contracts, SOWs, plans) are read whole, in sections of about this size, overlapping
 * so a sentence cut at a boundary is still read in one piece. Capped, so one huge file can't
 * drain the budget: past the cap, the rest of the document isn't read.
 */
const DOC_SECTION_CHARS = 12_000;
const DOC_SECTION_OVERLAP = 800;
const MAX_DOC_SECTIONS = 15;
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

/** Added for documents: contracts, order forms, SOWs, plans and decks phrase promises differently. */
const DOCUMENT_RULES = `
This is a document (contract, order form, statement of work, plan, deck or spreadsheet), possibly one section of it.
- What the company commits to (SLAs, uptime, support hours, deliverables with dates, onboarding steps) are commitments.
- What the customer commits to (payments, approvals, providing data or access by a date) are obligations.
- Dates that matter even without a promise are deadlines: renewal or end of term, the last day to give notice of non-renewal (renewal date minus the notice period), go-live dates.
- Boilerplate (definitions, governing law, liability caps, confidentiality) is not a commitment.`;

/** Splits a long document at paragraph or page boundaries near the section size. */
export function documentSections(text: string): string[] {
  const sections: string[] = [];
  let start = 0;
  while (start < text.length && sections.length < MAX_DOC_SECTIONS) {
    let end = Math.min(text.length, start + DOC_SECTION_CHARS);
    if (end < text.length) {
      // Prefer ending at a page marker or blank line in the last part of the section.
      const window = text.slice(start + DOC_SECTION_CHARS - 2_000, end);
      const page = window.lastIndexOf("\n[Page ");
      const para = window.lastIndexOf("\n\n");
      const cut = page > 0 ? page : para;
      if (cut > 0) end = start + DOC_SECTION_CHARS - 2_000 + cut;
    }
    sections.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(end - DOC_SECTION_OVERLAP, start + 1);
  }
  return sections;
}

function render(input: ExtractionInput, section?: { index: number; count: number }): string {
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
    `Item: ${item.kind} from ${item.provider}${item.container ? ` in ${item.container}` : ""}${section && section.count > 1 ? ` (section ${section.index + 1} of ${section.count})` : ""}`,
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

/** Reads one item (a document section by section). Results are checked against the content before they're returned. */
export async function extractFromItem(model: ChatModel, input: ExtractionInput): Promise<ExtractionResult> {
  const isDocument = input.item.kind === "document";
  const parts = isDocument ? documentSections(input.item.content) : [truncate(input.item.content, MAX_CONTENT_CHARS)];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const raw: { items: z.infer<typeof schema>["items"]; updates: z.infer<typeof schema>["updates"]; content: string }[] = [];
  for (const [index, part] of parts.entries()) {
    const res = await model.structured({
      name: "extract",
      tier: "fast",
      system: isDocument ? SYSTEM + DOCUMENT_RULES : SYSTEM,
      user: render({ ...input, item: { ...input.item, content: part } }, { index, count: parts.length }),
      schema,
    });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    usage.costUsd += res.usage.costUsd;
    raw.push({ ...res.data, content: part });
  }

  const known = new Set(input.known.map((k) => k.ref));
  const seen = new Set<string>();
  const items: ExtractedFinding[] = [];
  let dropped = 0;

  // Sections overlap, so the same finding can come back twice: the first one counts.
  for (const { items: found, content } of raw) for (const r of found) {
    const confidence = clampConfidence(r.confidence);
    const summary = r.summary.trim();
    const key = `${r.type}|${summary.toLowerCase()}`;
    if (!summary || confidence < MIN_CONFIDENCE || !containsExcerpt(content, r.excerpt) || seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    items.push({
      type: r.type,
      summary,
      madeBy: r.madeBy?.trim() || null,
      ownerEmail: r.ownerEmail?.trim().toLowerCase() || null,
      dueDate: isoDate(r.dueDate),
      confidence,
      excerpt: cleanExcerpt(r.excerpt),
    });
  }

  const dueByRef = new Map(input.known.map((k) => [k.ref, k.dueDate]));
  const itemDay = input.item.occurredAt.toISOString().slice(0, 10);
  const updates: StatusUpdate[] = [];
  const updated = new Set<string>();
  for (const { updates: proposed, content } of raw) for (const u of proposed) {
    // Nothing is broken before it's due: an early slip is a risk, reported as its own item.
    const due = dueByRef.get(u.ref);
    const notYetDue = u.status === "broken" && !!due && due >= itemDay;
    if (!known.has(u.ref) || !containsExcerpt(content, u.excerpt) || notYetDue || updated.has(u.ref)) {
      dropped++;
      continue;
    }
    updated.add(u.ref);
    updates.push({ ref: u.ref, status: u.status, excerpt: cleanExcerpt(u.excerpt) });
  }

  return { items, updates, dropped, usage };
}

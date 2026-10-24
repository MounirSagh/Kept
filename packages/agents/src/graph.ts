import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { ChatModel, Usage } from "./model.js";
import { clampConfidence, cleanExcerpt, containsExcerpt, isoDate, normalizeForMatch, truncate } from "./text.js";

/* Inputs ------------------------------------------------------------------------------------- */

/** Everything the agents may know about one account. Built by the caller within the run's visibility. */
export interface AccountContext {
  /** YYYY-MM-DD */
  today: string;
  org: { name: string; emailSignature: string | null };
  account: {
    name: string;
    domain: string | null;
    ownerName: string | null;
    renewalDate: string | null;
    annualValue: string | null;
    healthScore: number | null;
    /** One line on who the client is: industry, size, location, what they do. */
    about: string | null;
  };
  contacts: { name: string | null; email: string | null; title: string | null }[];
  commitments: {
    id: string;
    type: string;
    summary: string;
    dueDate: string | null;
    status: string;
    madeBy: string | null;
    owner: string | null;
    sourceItemId: string | null;
    excerpt: string | null;
  }[];
  /** The newest items for the account; the ones that triggered the run come first. */
  recent: SourceDoc[];
  openFlags: { kind: string; title: string }[];
  /** Actions already proposed and waiting for a person, described in a line each. */
  pendingActions: string[];
  /** What Kept has learned from past decisions (H-MEM). */
  memories: string[];
}

export interface SourceDoc {
  id: string;
  provider: string;
  title: string | null;
  author: string | null;
  occurredAt: Date;
  content: string;
}

/** Read access to the account's synced items, already limited to what the run may see. */
export interface InvestigationTools {
  search(query: string, limit: number): Promise<SourceDoc[]>;
  read(ids: string[]): Promise<SourceDoc[]>;
}

export type AgentStepName = "planner" | "investigator" | "critic" | "advisor";

export interface StepRecord {
  agent: AgentStepName;
  action: string;
  inputSummary: string;
  output: unknown;
  verdict?: "approved" | "needs_evidence" | "rejected";
  usage: Usage;
  durationMs: number;
}

export interface AgentDeps {
  model: ChatModel;
  tools: InvestigationTools;
  onStep(step: StepRecord): Promise<void> | void;
  /** Times the critic may send questions back for more evidence (default 1). */
  maxCriticRounds?: number;
}

/* Outputs ------------------------------------------------------------------------------------ */

export const FLAG_KINDS = ["unkept_promise", "mismatch", "deadline_risk", "churn_signal"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const STANCES = ["supports", "contradicts", "context"] as const;

export interface FlagProposal {
  kind: (typeof FLAG_KINDS)[number];
  title: string;
  explanation: string;
  severity: (typeof SEVERITIES)[number];
  confidence: number;
  commitmentId: string | null;
  /** A few words naming the issue; with the kind and commitment, it identifies the flag across runs. */
  topic: string;
  evidence: { sourceItemId: string | null; commitmentId: string | null; stance: (typeof STANCES)[number]; excerpt: string }[];
}

export type ActionProposal =
  | { type: "send_email"; flag: number | null; rationale: string; to: string[]; subject: string; body: string }
  | { type: "schedule_reminder"; flag: number | null; rationale: string; title: string; remindOn: string }
  | { type: "internal_alert"; flag: number | null; rationale: string; message: string };

export interface Finding {
  questionId: string;
  question: string;
  answer: string;
  status: "supported" | "contradicted" | "unclear";
  citations: { ref: string; stance: (typeof STANCES)[number]; excerpt: string }[];
}

export interface AgentResult {
  plan: { summary: string; questions: Question[] };
  findings: Finding[];
  flags: FlagProposal[];
  actions: ActionProposal[];
  criticRounds: number;
}

interface Question {
  id: string;
  question: string;
  why: string;
  commitments: string[];
  searches: string[];
}

/* References --------------------------------------------------------------------------------- */

/**
 * The model never sees database ids: commitments are C1, C2..., source items S1, S2...
 * Whatever it cites is mapped back here, so an invented id can't reach the database.
 */
class Refs {
  private bySource = new Map<string, string>();
  readonly sources = new Map<string, SourceDoc>();
  readonly commitments = new Map<string, AccountContext["commitments"][number]>();

  constructor(commitments: AccountContext["commitments"]) {
    commitments.forEach((c, i) => this.commitments.set(`C${i + 1}`, c));
  }

  source(doc: SourceDoc): string {
    let ref = this.bySource.get(doc.id);
    if (!ref) {
      ref = `S${this.bySource.size + 1}`;
      this.bySource.set(doc.id, ref);
    }
    // Keep the fullest copy seen (search results may be shorter than a full read).
    const prev = this.sources.get(ref);
    if (!prev || prev.content.length < doc.content.length) this.sources.set(ref, doc);
    return ref;
  }

  commitmentRef(id: string | null): string | null {
    if (!id) return null;
    for (const [ref, c] of this.commitments) if (c.id === id) return ref;
    return null;
  }
}

/* Prompts ------------------------------------------------------------------------------------ */

const ROLE = `You are part of Kept, which watches what a company promised its customers and warns before a promise is broken.`;

function describeContext(ctx: AccountContext, refs: Refs, opts: { full: boolean }): string {
  const a = ctx.account;
  const commitments = [...refs.commitments]
    .map(([ref, c]) => `${ref} [${c.type}, ${c.status}] ${c.summary}${c.dueDate ? ` (due ${c.dueDate})` : ""}${c.owner ? `, owner ${c.owner}` : ""}${c.madeBy ? `, made by ${c.madeBy}` : ""}`)
    .join("\n");
  const recent = ctx.recent
    .map((d) => `${refs.source(d)} ${d.occurredAt.toISOString().slice(0, 10)} ${d.provider}${d.author ? ` from ${d.author}` : ""}: ${d.title ?? ""}\n   ${truncate(d.content.replace(/\s+/g, " "), opts.full ? 600 : 240)}`)
    .join("\n");
  return [
    `Today: ${ctx.today}`,
    `Company: ${ctx.org.name}`,
    `Account: ${a.name}${a.domain ? ` (${a.domain})` : ""}${a.ownerName ? `, account owner ${a.ownerName}` : ""}${a.renewalDate ? `, renews ${a.renewalDate}` : ""}${a.annualValue ? `, worth ${a.annualValue} a year` : ""}${a.healthScore != null ? `, health ${a.healthScore}/100` : ""}`,
    a.about ? `About the client: ${a.about}` : null,
    "",
    `Tracked items:\n${commitments || "(none)"}`,
    "",
    `Recent activity (newest first):\n${recent || "(none)"}`,
    "",
    `Already flagged and open:\n${ctx.openFlags.map((f) => `- [${f.kind}] ${f.title}`).join("\n") || "(none)"}`,
    "",
    `Actions waiting for a person to decide:\n${ctx.pendingActions.map((a) => `- ${a}`).join("\n") || "(none)"}`,
    "",
    `Learned from past decisions:\n${ctx.memories.map((m) => `- ${m}`).join("\n") || "(none)"}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/* Schemas ------------------------------------------------------------------------------------ */

const plannerSchema = z.object({
  summary: z.string().describe("Two sentences on where the account stands."),
  questions: z.array(
    z.object({
      question: z.string().describe("One concrete, checkable question."),
      why: z.string(),
      commitments: z.array(z.string()).describe("Refs of tracked items it concerns, e.g. C2."),
      searches: z.array(z.string()).describe("2 to 4 short keyword searches over the account's messages and documents."),
    }),
  ),
});

const investigatorSchema = z.object({
  answer: z.string().describe("What the evidence shows, in two or three sentences."),
  status: z.enum(["supported", "contradicted", "unclear"]).describe(
    "supported: the evidence answers the question. contradicted: it shows the opposite of what was promised. unclear: not enough evidence.",
  ),
  citations: z.array(
    z.object({
      ref: z.string().describe("An S ref from the evidence."),
      stance: z.enum(STANCES),
      excerpt: z.string().describe("Exact words from that item, copied verbatim."),
    }),
  ),
});

const criticSchema = z.object({
  reviews: z.array(
    z.object({
      questionId: z.string(),
      verdict: z.enum(["approved", "needs_evidence", "rejected"]),
      reason: z.string(),
      searches: z.array(z.string()).describe("Only for needs_evidence: searches that would settle it."),
    }),
  ),
});

const advisorSchema = z.object({
  flags: z.array(
    z.object({
      kind: z.enum(FLAG_KINDS),
      title: z.string().describe("Under 80 characters, specific: what is at risk, for whom."),
      explanation: z.string().describe("Two to four sentences a busy account manager can act on."),
      severity: z.enum(SEVERITIES),
      confidence: z.number().describe("0 to 1."),
      commitment: z.string().nullable().describe("The C ref the flag is about, if any."),
      topic: z.string().describe("Three to six words naming the issue."),
      evidence: z.array(z.object({ ref: z.string(), stance: z.enum(STANCES), excerpt: z.string() })),
    }),
  ),
  actions: z.array(
    z.object({
      type: z.enum(["send_email", "schedule_reminder", "internal_alert"]),
      flag: z.number().nullable().describe("Index of the flag in your flags list this action addresses."),
      rationale: z.string(),
      emailTo: z.array(z.string()).describe("send_email only: recipients, from the account's contacts."),
      emailSubject: z.string().nullable(),
      emailBody: z.string().nullable().describe("send_email only: plain text, ready to send, signed off."),
      remindOn: z.string().nullable().describe("schedule_reminder only: YYYY-MM-DD."),
      message: z.string().nullable().describe("schedule_reminder title or internal_alert message."),
    }),
  ),
});

/* Graph -------------------------------------------------------------------------------------- */

const State = Annotation.Root({
  summary: Annotation<string>(),
  questions: Annotation<Question[]>(),
  findings: Annotation<Record<string, Finding>>(),
  /** Questions the critic sent back, with the searches it asked for. */
  pending: Annotation<{ id: string; searches: string[] }[]>(),
  /** Questions investigated since the critic last looked: the only ones it reviews next. */
  toReview: Annotation<string[]>(),
  /** Source items each question's investigation has already read. */
  seen: Annotation<Record<string, string[]>>(),
  approved: Annotation<string[]>(),
  rounds: Annotation<number>(),
  flags: Annotation<FlagProposal[]>(),
  actions: Annotation<ActionProposal[]>(),
});

const MAX_QUESTIONS = 5;
const SEARCH_LIMIT = 4;
const DOCS_PER_QUESTION = 6;

/**
 * Planner → Investigator → Critic (→ back to Investigator while evidence is missing) → Advisor,
 * for one account. Returns proposals; the caller decides what to store.
 */
export async function runAccountAgents(
  ctx: AccountContext,
  deps: AgentDeps,
  config: { runId?: string; runName?: string; tags?: string[]; metadata?: Record<string, unknown> } = {},
): Promise<AgentResult> {
  const refs = new Refs(ctx.commitments);
  const maxRounds = deps.maxCriticRounds ?? 1;
  // Register recent items first so they get the low refs the planner sees.
  for (const d of ctx.recent) refs.source(d);

  async function step<T>(
    agent: AgentStepName,
    action: string,
    inputSummary: string,
    fn: () => Promise<{ output: T; usage: Usage; verdict?: StepRecord["verdict"] }>,
  ): Promise<T> {
    const started = Date.now();
    const { output, usage, verdict } = await fn();
    await deps.onStep({ agent, action, inputSummary, output, usage, verdict, durationMs: Date.now() - started });
    return output;
  }

  const planner = async () => {
    const plan = await step("planner", "plan", `${ctx.commitments.length} tracked items, ${ctx.recent.length} recent`, async () => {
      const { data, usage } = await deps.model.structured({
        name: "planner",
        tier: "smart",
        schema: plannerSchema,
        system: `${ROLE}
You are the planner. Decide what is worth checking for this account right now: promises coming due with no sign of delivery, promises that recent messages contradict, customer frustration, renewals at risk.
Ask at most ${MAX_QUESTIONS} questions, most important first. Ask nothing about what is already flagged or clearly fine. An empty list is a good answer when nothing needs attention.`,
        user: describeContext(ctx, refs, { full: true }),
      });
      return { output: data, usage };
    });
    const questions = plan.questions.slice(0, MAX_QUESTIONS).map((q, i) => ({ ...q, id: `Q${i + 1}` }));
    return { summary: plan.summary, questions, findings: {}, pending: [], toReview: [], seen: {}, approved: [], rounds: 0, flags: [], actions: [] };
  };

  /**
   * Answers one question from the account's items. On a second look (`seen` holds what the first
   * one read), returns null when the critic's searches turned up nothing new: the answer can't change.
   */
  const investigate = async (
    q: Question,
    extraSearches: string[],
    seen: string[] | undefined,
  ): Promise<{ finding: Finding; usage: Usage; read: string[] } | null> => {
    // Gather: the items behind the commitments in question, then search hits (the critic's first, on a second look).
    const docs = new Map<string, SourceDoc>();
    const linked = q.commitments.map((r) => refs.commitments.get(r)?.sourceItemId).filter((id): id is string => !!id);
    for (const d of await deps.tools.read(linked)) docs.set(d.id, d);
    for (const s of [...extraSearches, ...q.searches]) {
      for (const d of await deps.tools.search(s, SEARCH_LIMIT)) if (!docs.has(d.id)) docs.set(d.id, d);
    }
    if (seen && [...docs.keys()].every((id) => seen.includes(id))) return null;
    const evidence = [...docs.values()].slice(0, DOCS_PER_QUESTION);
    const full = await deps.tools.read(evidence.map((d) => d.id));
    const rendered = full
      .map((d) => `${refs.source(d)} ${d.occurredAt.toISOString().slice(0, 10)} ${d.provider}${d.author ? ` from ${d.author}` : ""}: ${d.title ?? ""}\n${truncate(d.content, 3000)}`)
      .join("\n\n---\n\n");
    const concerns = q.commitments
      .map((r) => refs.commitments.get(r))
      .filter((c) => !!c)
      .map((c) => `- ${c.summary}${c.dueDate ? ` (due ${c.dueDate})` : ""}${c.excerpt ? `. Originally: "${c.excerpt}"` : ""}`)
      .join("\n");

    const { data, usage } = await deps.model.structured({
      name: "investigator",
      tier: "fast",
      schema: investigatorSchema,
      system: `${ROLE}
You are the investigator. Answer the question using only the evidence given. Cite the items you rely on, with exact excerpts copied from them; excerpts are checked and anything not found is discarded. Say unclear when the evidence doesn't settle it.`,
      user: [`Today: ${ctx.today}`, `Account: ${ctx.account.name}`, `Question: ${q.question}`, concerns && `Concerning:\n${concerns}`, "", `Evidence:\n${rendered || "(nothing found)"}`]
        .filter(Boolean)
        .join("\n"),
    });
    const citations = data.citations
      .filter((c) => {
        const doc = refs.sources.get(c.ref);
        return !!doc && containsExcerpt(doc.content, c.excerpt);
      })
      .map((c) => ({ ...c, excerpt: cleanExcerpt(c.excerpt) }));
    return {
      finding: { questionId: q.id, question: q.question, answer: data.answer, status: data.status, citations },
      usage,
      read: [...new Set([...(seen ?? []), ...evidence.map((d) => d.id)])],
    };
  };

  const investigator = async (state: typeof State.State) => {
    const secondLook = state.pending.length > 0;
    const todo = secondLook
      ? state.pending.map((p) => ({ q: state.questions.find((q) => q.id === p.id)!, extra: p.searches })).filter((t) => t.q)
      : state.questions.map((q) => ({ q, extra: [] as string[] }));
    const findings = { ...state.findings };
    const seen = { ...state.seen };
    const toReview: string[] = [];
    for (const { q, extra } of todo) {
      const started = Date.now();
      const result = await investigate(q, extra, secondLook ? (seen[q.id] ?? []) : undefined);
      // Nothing new to read: the question stays undecided and is dropped rather than re-reviewed.
      if (!result) continue;
      await deps.onStep({
        agent: "investigator",
        action: `investigate ${q.id}${secondLook ? " again" : ""}`,
        inputSummary: q.question,
        output: result.finding,
        usage: result.usage,
        durationMs: Date.now() - started,
      });
      findings[q.id] = result.finding;
      seen[q.id] = result.read;
      toReview.push(q.id);
    }
    return { findings, seen, toReview, pending: [] };
  };

  /** A citation with the date and source of the item it quotes, so dates like "Friday" can be checked. */
  const renderCitation = (c: Finding["citations"][number]) => {
    const doc = refs.sources.get(c.ref);
    const where = doc ? `, ${doc.occurredAt.toISOString().slice(0, 10)} ${doc.provider}` : "";
    return `   ${c.ref} (${c.stance}${where}): "${c.excerpt}"`;
  };

  const critic = async (state: typeof State.State) => {
    // Only what changed since the last review: approved findings aren't re-judged.
    const reviewable = state.toReview.map((id) => state.findings[id]).filter((f): f is Finding => !!f);
    const rendered = reviewable
      .map((f) => `${f.questionId}: ${f.question}\n Answer (${f.status}): ${f.answer}\n Citations:\n${f.citations.map(renderCitation).join("\n") || "   (none)"}`)
      .join("\n\n");
    const round = state.rounds + 1;
    const reviews = await step("critic", `review round ${round}`, `${reviewable.length} findings`, async () => {
      const { data, usage } = await deps.model.structured({
        name: "critic",
        tier: "smart",
        schema: criticSchema,
        system: `${ROLE}
You are the critic. For each finding, check that the answer's claims are backed by its citations, and that the citations say what the answer claims.
approved: backed, worth acting on. needs_evidence: plausible, and a specific search could find something that changes the conclusion; give those searches. rejected: unsupported, misread, or not worth anyone's time.
Judge what matters, not wording:
- Resolving a relative date ("Friday", "next week") against the cited item's date is a fair reading, not a gap.
- Don't ask to prove a negative. If the evidence shows no sign of delivery, an owner or an update, that absence is the finding.
- Minor imprecision that doesn't change what the account team should do is fine: approve.
Be strict about invented facts: a wrong warning costs the account manager's trust.`,
        user: `Today: ${ctx.today}\nAccount: ${ctx.account.name}\n\n${rendered}`,
      });
      const anyMissing = data.reviews.some((r) => r.verdict === "needs_evidence");
      const overall = anyMissing ? "needs_evidence" : data.reviews.some((r) => r.verdict === "approved") ? "approved" : "rejected";
      return { output: data.reviews, usage, verdict: overall };
    });

    const known = new Set(reviewable.map((f) => f.questionId));
    const valid = reviews.filter((r) => known.has(r.questionId));
    const approved = valid.filter((r) => r.verdict === "approved").map((r) => r.questionId);
    // Each question gets at most maxRounds second looks; after that, undecided ones are dropped.
    const pending = round <= maxRounds
      ? valid.filter((r) => r.verdict === "needs_evidence").map((r) => ({ id: r.questionId, searches: r.searches.slice(0, 4) }))
      : [];
    // Questions the critic stopped looking at stay approved across rounds.
    return { approved: [...new Set([...state.approved, ...approved])], pending, rounds: round };
  };

  const advisor = async (state: typeof State.State) => {
    const approved = state.approved.map((id) => state.findings[id]).filter((f): f is Finding => !!f);
    const rendered = approved
      .map((f) => `${f.questionId}: ${f.question}\n Finding (${f.status}): ${f.answer}\n${f.citations.map(renderCitation).join("\n")}`)
      .join("\n\n");
    const contacts = ctx.contacts.filter((c) => c.email).map((c) => `- ${c.name ?? c.email} <${c.email}>${c.title ? `, ${c.title}` : ""}`).join("\n");

    const advice = await step("advisor", "advise", `${approved.length} approved findings`, async () => {
      const { data, usage } = await deps.model.structured({
        name: "advisor",
        tier: "smart",
        schema: advisorSchema,
        system: `${ROLE}
You are the advisor. Turn the approved findings into flags for the account team and proposed actions. A person approves every action before it happens.
Flag kinds: unkept_promise (a promise was missed, and it matters), mismatch (what was promised and what happened or was said later disagree), deadline_risk (something shows a promise will slip), churn_signal (the customer may leave or is unhappy).
Flags are for what the commitments list can't show by itself. That list already shows every promise with its due date, amber when due soon and red when overdue. So:
- Don't flag a promise only because it's due soon, overdue, or has no update yet.
- Flag it when there's evidence: something said or done since that contradicts it, a blocker, a slip, a customer reaction.
- Exception, high stakes and quiet: a promise due within 7 days (or already overdue) with the account's renewal within 30 days may be flagged as deadline_risk even without new evidence.
- Customer signals (a competitor, frustration, a threat to leave) are flags on their own.
Only flag what the findings show. Don't repeat what is already flagged. Evidence excerpts must be copied from the citations.
Raise one flag per underlying issue. A promise that is late, contradicted by an update and blocked is one flag: pick the kind that fits best and cover the rest in the explanation.
Actions: send_email drafts a message to the customer from the account owner (only to the contacts listed; plain text, warm, specific, no promises the team hasn't made; never mention internal notes, systems, tools, Slack or tickets, or that records disagree: write only what the account owner would say to the customer${ctx.org.emailSignature ? "; end with the signature given" : ""}). schedule_reminder sets a reminder for the account owner on a date. internal_alert tells the account team something now. Propose few actions, only useful ones, and none that repeats an action already waiting for a decision.`,
        user: [
          describeContext(ctx, refs, { full: false }),
          "",
          `Customer contacts:\n${contacts || "(none known: don't draft emails)"}`,
          ctx.org.emailSignature ? `\nEmail signature:\n${ctx.org.emailSignature}` : "",
          "",
          `Approved findings:\n${rendered}`,
        ].join("\n"),
      });
      return { output: data, usage };
    });

    return toProposals(advice, refs, ctx);
  };

  const graph = new StateGraph(State)
    .addNode("planner", planner)
    .addNode("investigator", investigator)
    .addNode("critic", critic)
    .addNode("advisor", advisor)
    .addEdge(START, "planner")
    .addConditionalEdges("planner", (s) => (s.questions.length > 0 ? "investigator" : END), ["investigator", END])
    // A second look that found nothing new skips the critic.
    .addConditionalEdges("investigator", (s) => (s.toReview.length > 0 ? "critic" : s.approved.length > 0 ? "advisor" : END), [
      "critic",
      "advisor",
      END,
    ])
    .addConditionalEdges("critic", (s) => (s.pending.length > 0 ? "investigator" : s.approved.length > 0 ? "advisor" : END), [
      "investigator",
      "advisor",
      END,
    ])
    .addEdge("advisor", END)
    .compile();

  const final = await graph.invoke(
    { summary: "", questions: [], findings: {}, pending: [], toReview: [], seen: {}, approved: [], rounds: 0, flags: [], actions: [] },
    { runId: config.runId, runName: config.runName ?? "kept-account-run", tags: config.tags, metadata: config.metadata, recursionLimit: 30 },
  );

  return {
    plan: { summary: final.summary, questions: final.questions },
    findings: Object.values(final.findings),
    flags: final.flags,
    actions: final.actions,
    criticRounds: final.rounds,
  };
}

/** Checks the advisor's output against what the run actually saw, and maps refs back to ids. */
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFrom = (today: string, date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

/**
 * Whether a flag about a promise says more than the commitments list already does. Its evidence must
 * include something besides the promise being restated (a blocker, an update, a reaction), unless
 * the stakes are high: due within a week or overdue, with the renewal within 30 days.
 */
function addsToTheList(flag: FlagProposal, refs: Refs, ctx: AccountContext): boolean {
  if (flag.kind !== "deadline_risk" && flag.kind !== "unkept_promise") return true;
  const promise = [...refs.commitments.values()].find((c) => c.id === flag.commitmentId);
  if (!promise) return true;
  const restatesAPromise = (excerpt: string) =>
    [...refs.commitments.values()].some((c) => c.excerpt && (containsExcerpt(c.excerpt, excerpt) || containsExcerpt(excerpt, c.excerpt)));
  if (flag.evidence.some((e) => e.sourceItemId && !e.commitmentId && !restatesAPromise(e.excerpt))) return true;

  const dueSoon = promise.dueDate !== null && daysFrom(ctx.today, promise.dueDate) <= 7;
  const renewalSoon = ctx.account.renewalDate !== null && Math.abs(daysFrom(ctx.today, ctx.account.renewalDate)) <= 30;
  return dueSoon && renewalSoon;
}

function toProposals(advice: z.infer<typeof advisorSchema>, refs: Refs, ctx: AccountContext) {
  const flags: FlagProposal[] = [];
  const flagIndex = new Map<number, number>();

  advice.flags.forEach((f, i) => {
    const evidence: FlagProposal["evidence"] = [];
    // The same words quoted twice (or from a message posted twice) are shown once.
    const quoted = new Set<string>();
    const add = (e: FlagProposal["evidence"][number]) => {
      const key = normalizeForMatch(e.excerpt);
      if (quoted.has(key)) return;
      quoted.add(key);
      evidence.push(e);
    };
    for (const e of f.evidence) {
      const doc = refs.sources.get(e.ref);
      const commitment = refs.commitments.get(e.ref);
      if (doc && containsExcerpt(doc.content, e.excerpt)) {
        add({ sourceItemId: doc.id, commitmentId: null, stance: e.stance, excerpt: cleanExcerpt(e.excerpt) });
      } else if (commitment) {
        add({ sourceItemId: commitment.sourceItemId, commitmentId: commitment.id, stance: e.stance, excerpt: cleanExcerpt(commitment.excerpt ?? commitment.summary) });
      }
    }
    // A flag nobody can check isn't raised.
    if (evidence.length === 0 || !f.title.trim()) return;
    const proposal: FlagProposal = {
      kind: f.kind,
      title: f.title.trim().slice(0, 200),
      explanation: f.explanation.trim(),
      severity: f.severity,
      confidence: clampConfidence(f.confidence),
      commitmentId: f.commitment ? (refs.commitments.get(f.commitment)?.id ?? null) : null,
      topic: f.topic.trim(),
      evidence,
    };

    // "Due soon, no update" is already on the commitments list; a flag must add to it.
    if (!addsToTheList(proposal, refs, ctx)) return;

    // One flag per commitment: a second flag about the same promise merges into the first,
    // which takes the higher severity and both sets of evidence.
    const same = proposal.commitmentId ? flags.findIndex((g) => g.commitmentId === proposal.commitmentId) : -1;
    if (same >= 0) {
      const kept = flags[same]!;
      const winner = SEVERITIES.indexOf(proposal.severity) > SEVERITIES.indexOf(kept.severity) ? proposal : kept;
      const seen = new Set(kept.evidence.map((e) => normalizeForMatch(e.excerpt)));
      flags[same] = {
        ...winner,
        evidence: [...kept.evidence, ...proposal.evidence.filter((e) => !seen.has(normalizeForMatch(e.excerpt)))],
        confidence: Math.max(kept.confidence, proposal.confidence),
      };
      flagIndex.set(i, same);
      return;
    }
    flagIndex.set(i, flags.length);
    flags.push(proposal);
  });

  const contactEmails = new Set(ctx.contacts.map((c) => c.email?.toLowerCase()).filter((e): e is string => !!e));
  const domain = ctx.account.domain?.toLowerCase() ?? null;
  const allowedRecipient = (email: string) => contactEmails.has(email) || (!!domain && email.endsWith(`@${domain}`));

  const actions: ActionProposal[] = [];
  for (const a of advice.actions) {
    const flag = a.flag != null && flagIndex.has(a.flag) ? flagIndex.get(a.flag)! : null;
    const rationale = a.rationale.trim();
    if (a.type === "send_email") {
      // Kept only drafts to the customer's own people; anything else is dropped.
      const to = [...new Set(a.emailTo.map((e) => e.trim().toLowerCase()))].filter((e) => /^[^@\s]+@[^@\s]+$/.test(e) && allowedRecipient(e));
      if (to.length === 0 || !a.emailSubject?.trim() || !a.emailBody?.trim()) continue;
      actions.push({ type: "send_email", flag, rationale, to, subject: a.emailSubject.trim(), body: a.emailBody.trim() });
    } else if (a.type === "schedule_reminder") {
      const remindOn = isoDate(a.remindOn);
      if (!remindOn || remindOn < ctx.today || !a.message?.trim()) continue;
      actions.push({ type: "schedule_reminder", flag, rationale, title: a.message.trim(), remindOn });
    } else {
      if (!a.message?.trim()) continue;
      actions.push({ type: "internal_alert", flag, rationale, message: a.message.trim() });
    }
  }
  return { flags, actions };
}

/** Identifies a flag across runs: same account, kind and commitment (or topic) is the same issue. */
export function flagDedupeKey(accountId: string, flag: Pick<FlagProposal, "kind" | "commitmentId" | "topic">): string {
  const subject = flag.commitmentId ?? `topic:${flag.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;
  return `${accountId}:${flag.kind}:${subject}`;
}

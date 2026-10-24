import { describe, expect, it } from "vitest";
import { extractFromItem, flagDedupeKey, runAccountAgents, scriptedChatModel, type AccountContext, type SourceDoc, type StepRecord } from "./index.js";
import { cleanExcerpt, containsExcerpt, isoDate } from "./text.js";

const EMAIL = `Hi Lina,

Totally understood. We’ll have the SSO fix live before your renewal on the 14th.

Best,
Priya`;

describe("text checks", () => {
  it("matches excerpts regardless of quotes, case and spacing", () => {
    expect(containsExcerpt(EMAIL, "we'll have the SSO fix   live before your renewal")).toBe(true);
    expect(containsExcerpt(EMAIL, "We'll have the SSO fix live next week")).toBe(false);
    expect(containsExcerpt(EMAIL, "Hi")).toBe(false); // too short to mean anything
  });

  it("strips quote marks models wrap excerpts in", () => {
    expect(cleanExcerpt(' ""No ETA yet."" ')).toBe("No ETA yet.");
    expect(cleanExcerpt("\u201CWe'll ship it\u201D")).toBe("We'll ship it");
    expect(cleanExcerpt("We'll ship it")).toBe("We'll ship it");
  });

  it("accepts only real dates", () => {
    expect(isoDate("2026-10-14")).toBe("2026-10-14");
    expect(isoDate("2026-02-30")).toBeNull();
    expect(isoDate("next friday")).toBeNull();
  });
});

describe("extractFromItem", () => {
  const input = {
    org: { name: "Acme", internalDomains: ["acme.com"] },
    account: { name: "Halcyon Freight", domain: "halcyon.com" },
    item: { kind: "email", provider: "google", title: "Re: Renewal", author: "priya@acme.com", occurredAt: new Date("2026-10-01T10:00:00Z"), container: null, content: EMAIL },
    known: [
      { ref: "K1", type: "commitment", summary: "Send usage export", dueDate: null, madeBy: null },
      { ref: "K2", type: "commitment", summary: "Ship SSO", dueDate: "2026-10-20", madeBy: null },
    ],
  };

  it("keeps findings quoted from the content and drops the rest", async () => {
    const { model } = scriptedChatModel({
      extract: {
        items: [
          { type: "commitment", summary: "SSO fix live before renewal", madeBy: "Priya", ownerEmail: "PRIYA@acme.com", dueDate: "2026-10-14", confidence: 0.9, excerpt: "We'll have the SSO fix live before your renewal on the 14th." },
          { type: "commitment", summary: "Invented promise", madeBy: null, ownerEmail: null, dueDate: null, confidence: 0.95, excerpt: "We will refund the whole year" },
          { type: "risk", summary: "Low confidence", madeBy: null, ownerEmail: null, dueDate: null, confidence: 0.2, excerpt: "Totally understood." },
        ],
        updates: [
          { ref: "K1", status: "fulfilled", excerpt: "Totally understood." },
          { ref: "K9", status: "broken", excerpt: "Totally understood." },
          // Due after the email was written: a slip, not a broken promise.
          { ref: "K2", status: "broken", excerpt: "Totally understood." },
        ],
      },
    });
    const result = await extractFromItem(model, input);
    expect(result.items).toEqual([
      expect.objectContaining({ summary: "SSO fix live before renewal", ownerEmail: "priya@acme.com", dueDate: "2026-10-14", confidence: 0.9 }),
    ]);
    expect(result.updates).toEqual([{ ref: "K1", status: "fulfilled", excerpt: "Totally understood." }]);
    expect(result.dropped).toBe(4);
  });
});

describe("runAccountAgents", () => {
  const promise: SourceDoc = { id: "src-1", provider: "google", title: "Re: Renewal", author: "priya@acme.com", occurredAt: new Date("2026-10-01"), content: EMAIL };
  const silence: SourceDoc = {
    id: "src-2",
    provider: "linear",
    title: "KEP-12 SSO fix",
    author: "sofia@acme.com",
    occurredAt: new Date("2026-10-02"),
    content: "Blocked on the identity provider upgrade. No ETA yet, moving to next sprint.",
  };
  const ctx: AccountContext = {
    today: "2026-10-11",
    org: { name: "Acme", emailSignature: "Priya, Acme" },
    account: { name: "Halcyon Freight", domain: "halcyon.com", ownerName: "Priya", renewalDate: "2026-10-14", annualValue: "$48,000", healthScore: 70, about: "Freight forwarder, 359 employees, Montreal" },
    contacts: [{ name: "Lina", email: "lina@halcyon.com", title: "IT lead" }],
    commitments: [
      { id: "item-1", type: "commitment", summary: "SSO fix live before renewal", dueDate: "2026-10-14", status: "open", madeBy: "Priya", owner: "Priya", sourceItemId: "src-1", excerpt: "We'll have the SSO fix live before your renewal on the 14th." },
    ],
    recent: [promise],
    openFlags: [],
    pendingActions: [],
    memories: ["Halcyon prefers email over calls."],
  };
  // The ticket only turns up for the critic's follow-up search, not the planner's first one.
  const tools = {
    async search(query: string) {
      return query.toLowerCase().includes("ticket") ? [silence] : [];
    },
    async read(ids: string[]) {
      return [promise, silence].filter((d) => ids.includes(d.id));
    },
  };

  it("loops back for evidence, then turns approved findings into checked proposals", async () => {
    const { model, calls } = scriptedChatModel({
      planner: { summary: "Renewal in 3 days with an SSO promise open.", questions: [{ question: "Will the SSO fix ship before the 14th?", why: "Renewal depends on it", commitments: ["C1"], searches: ["SSO fix"] }] },
      investigator: (_user: string, n: number) =>
        n === 0
          ? { answer: "No evidence yet.", status: "unclear", citations: [] }
          : { answer: "Engineering moved the fix to next sprint.", status: "contradicted", citations: [{ ref: "S2", stance: "contradicts", excerpt: "No ETA yet, moving to next sprint." }] },
      critic: (_user: string, n: number) =>
        n === 0
          ? { reviews: [{ questionId: "Q1", verdict: "needs_evidence", reason: "Check the ticket", searches: ["SSO ticket"] }] }
          : { reviews: [{ questionId: "Q1", verdict: "approved", reason: "Backed by the ticket", searches: [] }] },
      advisor: {
        flags: [
          { kind: "deadline_risk", title: "SSO fix will miss Halcyon's renewal", explanation: "Promised for the 14th; the ticket moved to next sprint.", severity: "high", confidence: 0.85, commitment: "C1", topic: "SSO fix", evidence: [{ ref: "S2", stance: "contradicts", excerpt: "moving to next sprint" }, { ref: "S2", stance: "supports", excerpt: "made up words" }] },
          { kind: "churn_signal", title: "No evidence at all", explanation: "x", severity: "low", confidence: 0.5, commitment: null, topic: "nothing", evidence: [{ ref: "S7", stance: "supports", excerpt: "whatever" }] },
        ],
        actions: [
          { type: "send_email", flag: 0, rationale: "Set expectations", emailTo: ["lina@halcyon.com", "stranger@gmail.com"], emailSubject: "SSO fix timing", emailBody: "Hi Lina, ...", remindOn: null, message: null },
          { type: "send_email", flag: 0, rationale: "Nobody valid", emailTo: ["stranger@gmail.com"], emailSubject: "x", emailBody: "y", remindOn: null, message: null },
          { type: "schedule_reminder", flag: 0, rationale: "Check in", emailTo: [], emailSubject: null, emailBody: null, remindOn: "2026-10-13", message: "Check SSO status" },
          { type: "schedule_reminder", flag: null, rationale: "In the past", emailTo: [], emailSubject: null, emailBody: null, remindOn: "2026-01-01", message: "Too late" },
        ],
      },
    });
    const steps: StepRecord[] = [];
    const result = await runAccountAgents(ctx, { model, tools, onStep: (s) => void steps.push(s) });

    expect(steps.map((s) => s.agent)).toEqual(["planner", "investigator", "critic", "investigator", "critic", "advisor"]);
    expect(steps.find((s) => s.agent === "critic")?.verdict).toBe("needs_evidence");
    expect(result.criticRounds).toBe(2);
    // The second investigation got the critic's searches.
    expect(calls.filter((c) => c.name === "investigator")[1]?.user).toContain("No ETA yet");

    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({ kind: "deadline_risk", commitmentId: "item-1", evidence: [{ sourceItemId: "src-2", stance: "contradicts" }] });
    expect(result.actions).toEqual([
      expect.objectContaining({ type: "send_email", flag: 0, to: ["lina@halcyon.com"] }),
      expect.objectContaining({ type: "schedule_reminder", flag: 0, remindOn: "2026-10-13" }),
    ]);
    expect(flagDedupeKey("acc-1", result.flags[0]!)).toBe("acc-1:deadline_risk:item-1");
  });

  it("merges flags about the same promise and shows each quote once", async () => {
    const finding = { answer: "Moved to next sprint.", status: "contradicted", citations: [{ ref: "S2", stance: "contradicts", excerpt: "No ETA yet, moving to next sprint." }] };
    const ev = (excerpt: string) => ({ ref: "S2", stance: "contradicts", excerpt });
    const { model } = scriptedChatModel({
      planner: { summary: "x", questions: [{ question: "Will SSO ship?", why: "Renewal", commitments: ["C1"], searches: ["SSO ticket"] }] },
      investigator: finding,
      critic: { reviews: [{ questionId: "Q1", verdict: "approved", reason: "Backed", searches: [] }] },
      advisor: {
        flags: [
          { kind: "unkept_promise", title: "SSO missed", explanation: "a", severity: "high", confidence: 0.7, commitment: "C1", topic: "SSO", evidence: [ev('"No ETA yet, moving to next sprint."'), ev("No ETA yet, moving to next sprint.")] },
          { kind: "mismatch", title: "SSO promise vs status", explanation: "b", severity: "critical", confidence: 0.9, commitment: "C1", topic: "SSO status", evidence: [ev("moving to next sprint")] },
        ],
        actions: [{ type: "internal_alert", flag: 1, rationale: "r", emailTo: [], emailSubject: null, emailBody: null, remindOn: null, message: "Tell the team" }],
      },
    });
    const result = await runAccountAgents(ctx, { model, tools, onStep: () => undefined });
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({ kind: "mismatch", severity: "critical", confidence: 0.9 });
    expect(result.flags[0]!.evidence.map((e) => e.excerpt)).toEqual(["No ETA yet, moving to next sprint.", "moving to next sprint"]);
    // The action that pointed at the merged flag now points at the kept one.
    expect(result.actions[0]).toMatchObject({ type: "internal_alert", flag: 0 });
  });

  it("raises a flag about a promise only when it adds to the commitments list", async () => {
    const approve = { reviews: [{ questionId: "Q1", verdict: "approved", reason: "ok", searches: [] }] };
    const planner = { summary: "x", questions: [{ question: "SSO?", why: "y", commitments: ["C1"], searches: ["SSO ticket"] }] };
    const investigator = { answer: "a", status: "unclear", citations: [] };
    const flag = (evidence: { ref: string; stance: string; excerpt: string }[]) => ({
      flags: [{ kind: "deadline_risk", title: "SSO due soon", explanation: "e", severity: "medium", confidence: 0.6, commitment: "C1", topic: "SSO", evidence }],
      actions: [],
    });
    const restated = [{ ref: "S1", stance: "supports", excerpt: "We'll have the SSO fix live before your renewal on the 14th." }];
    const blocker = [...restated, { ref: "S2", stance: "contradicts", excerpt: "No ETA yet, moving to next sprint." }];
    const run = async (evidence: typeof restated, account = ctx.account) => {
      const { model } = scriptedChatModel({ planner, investigator, critic: approve, advisor: flag(evidence) });
      return (await runAccountAgents({ ...ctx, account, today: "2026-10-01" }, { model, tools, onStep: () => undefined })).flags;
    };
    const quiet = { ...ctx.account, renewalDate: "2027-03-01" };
    // Only the promise restated, renewal far away: the list already says this.
    expect(await run(restated, quiet)).toEqual([]);
    // A blocker is new evidence.
    expect(await run(blocker, quiet)).toHaveLength(1);
    // Due within a week with the renewal close: high stakes, flagged even when quiet.
    const due = { ...ctx, commitments: [{ ...ctx.commitments[0]!, dueDate: "2026-10-06" }] };
    const { model } = scriptedChatModel({ planner, investigator, critic: approve, advisor: flag(restated) });
    const flags = (await runAccountAgents({ ...due, today: "2026-10-01" }, { model, tools, onStep: () => undefined })).flags;
    expect(flags).toHaveLength(1);
  });

  it("drops a question instead of re-reviewing it when a second look finds nothing new", async () => {
    const { model, calls } = scriptedChatModel({
      planner: { summary: "x", questions: [{ question: "Will SSO ship?", why: "Renewal", commitments: ["C1"], searches: ["SSO fix"] }] },
      investigator: { answer: "Only the promise itself.", status: "unclear", citations: [] },
      // Asks for a search that finds nothing beyond what was already read.
      critic: { reviews: [{ questionId: "Q1", verdict: "needs_evidence", reason: "Find an update", searches: ["SSO status update"] }] },
    });
    const steps: StepRecord[] = [];
    const result = await runAccountAgents(ctx, { model, tools, onStep: (s) => void steps.push(s) });
    expect(steps.map((s) => s.agent)).toEqual(["planner", "investigator", "critic"]);
    expect(calls.filter((c) => c.name === "critic")).toHaveLength(1);
    expect(result.flags).toEqual([]);
  });

  it("only re-reviews findings that changed", async () => {
    const { model, calls } = scriptedChatModel({
      planner: {
        summary: "x",
        questions: [
          { question: "Will SSO ship?", why: "Renewal", commitments: ["C1"], searches: ["SSO fix"] },
          { question: "Is Lina unhappy?", why: "Churn", commitments: [], searches: ["Lina"] },
        ],
      },
      investigator: (user: string) =>
        user.includes("No ETA yet")
          ? { answer: "Moved to next sprint.", status: "contradicted", citations: [{ ref: "S2", stance: "contradicts", excerpt: "No ETA yet, moving to next sprint." }] }
          : { answer: "Not enough.", status: "unclear", citations: [] },
      critic: (_user: string, n: number) =>
        n === 0
          ? { reviews: [{ questionId: "Q1", verdict: "needs_evidence", reason: "Check the ticket", searches: ["SSO ticket"] }, { questionId: "Q2", verdict: "approved", reason: "Fine", searches: [] }] }
          : { reviews: [{ questionId: "Q1", verdict: "approved", reason: "Backed", searches: [] }] },
      advisor: { flags: [], actions: [] },
    });
    await runAccountAgents(ctx, { model, tools, onStep: () => undefined });
    const second = calls.filter((c) => c.name === "critic")[1]!.user;
    expect(second).toContain("Q1:");
    expect(second).not.toContain("Q2:");
    // Citations carry their item's date and source.
    expect(second).toContain("contradicts, 2026-10-02 linear");
  });

  it("stops after planning when nothing needs attention", async () => {
    const { model, calls } = scriptedChatModel({ planner: { summary: "All quiet.", questions: [] } });
    const steps: StepRecord[] = [];
    const result = await runAccountAgents(ctx, { model, tools, onStep: (s) => void steps.push(s) });
    expect(calls.map((c) => c.name)).toEqual(["planner"]);
    expect(result.flags).toEqual([]);
    expect(steps).toHaveLength(1);
  });
});

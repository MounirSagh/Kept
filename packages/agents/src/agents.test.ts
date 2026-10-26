import { describe, expect, it } from "vitest";
import { documentSections, extractFromItem, flagDedupeKey, looksLikeContract, readContractTerms, runAccountAgents, scriptedChatModel, type AccountContext, type SourceDoc, type StepRecord } from "./index.js";
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
    datasets: [],
    history: ["Renewal date moved from 2026-12-01 to 2026-10-14 on 2026-09-02 (Halcyon order form.pdf, approved by Priya)."],
    tools: { linearTeams: [{ key: "ENG", name: "Engineering" }], crmTasks: true },
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
      planner: { summary: "Renewal in 3 days with an SSO promise open.", questions: [{ question: "Will the SSO fix ship before the 14th?", why: "Renewal depends on it", commitments: ["C1"], searches: ["SSO fix"], datasets: [] }] },
      investigator: (_user: string, n: number) =>
        n === 0
          ? { answer: "No evidence yet.", status: "unclear", citations: [] }
          : { answer: "Engineering moved the fix to next sprint.", status: "contradicted", citations: [{ ref: "S2", stance: "contradicts", excerpt: "No ETA yet, moving to next sprint." }] },
      critic: (_user: string, n: number) =>
        n === 0
          ? { reviews: [{ questionId: "Q1", verdict: "needs_evidence", reason: "Check the ticket", searches: ["SSO ticket"], datasets: [] }] }
          : { reviews: [{ questionId: "Q1", verdict: "approved", reason: "Backed by the ticket", searches: [], datasets: [] }] },
      advisor: {
        flags: [
          { kind: "deadline_risk", title: "SSO fix will miss Halcyon's renewal", explanation: "Promised for the 14th; the ticket moved to next sprint.", severity: "high", confidence: 0.85, commitment: "C1", topic: "SSO fix", evidence: [{ ref: "S2", stance: "contradicts", excerpt: "moving to next sprint" }, { ref: "S2", stance: "supports", excerpt: "made up words" }] },
          { kind: "churn_signal", title: "No evidence at all", explanation: "x", severity: "low", confidence: 0.5, commitment: null, topic: "nothing", evidence: [{ ref: "S7", stance: "supports", excerpt: "whatever" }] },
        ],
        actions: [
          { type: "send_email", flag: 0, rationale: "Set expectations", emailTo: ["lina@halcyon.com", "stranger@gmail.com"], emailSubject: "SSO fix timing", emailBody: "Hi Lina, ...", remindOn: null, message: null, teamKey: null, taskTitle: null, taskBody: null, dueDate: null },
          { type: "send_email", flag: 0, rationale: "Nobody valid", emailTo: ["stranger@gmail.com"], emailSubject: "x", emailBody: "y", remindOn: null, message: null, teamKey: null, taskTitle: null, taskBody: null, dueDate: null },
          { type: "schedule_reminder", flag: 0, rationale: "Check in", emailTo: [], emailSubject: null, emailBody: null, remindOn: "2026-10-13", message: "Check SSO status", teamKey: null, taskTitle: null, taskBody: null, dueDate: null },
          { type: "schedule_reminder", flag: null, rationale: "In the past", emailTo: [], emailSubject: null, emailBody: null, remindOn: "2026-01-01", message: "Too late", teamKey: null, taskTitle: null, taskBody: null, dueDate: null },
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
      planner: { summary: "x", questions: [{ question: "Will SSO ship?", why: "Renewal", commitments: ["C1"], searches: ["SSO ticket"], datasets: [] }] },
      investigator: finding,
      critic: { reviews: [{ questionId: "Q1", verdict: "approved", reason: "Backed", searches: [], datasets: [] }] },
      advisor: {
        flags: [
          { kind: "unkept_promise", title: "SSO missed", explanation: "a", severity: "high", confidence: 0.7, commitment: "C1", topic: "SSO", evidence: [ev('"No ETA yet, moving to next sprint."'), ev("No ETA yet, moving to next sprint.")] },
          { kind: "mismatch", title: "SSO promise vs status", explanation: "b", severity: "critical", confidence: 0.9, commitment: "C1", topic: "SSO status", evidence: [ev("moving to next sprint")] },
        ],
        actions: [{ type: "internal_alert", flag: 1, rationale: "r", emailTo: [], emailSubject: null, emailBody: null, remindOn: null, message: "Tell the team", teamKey: null, taskTitle: null, taskBody: null, dueDate: null }],
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
    const approve = { reviews: [{ questionId: "Q1", verdict: "approved", reason: "ok", searches: [], datasets: [] }] };
    const planner = { summary: "x", questions: [{ question: "SSO?", why: "y", commitments: ["C1"], searches: ["SSO ticket"], datasets: [] }] };
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
      planner: { summary: "x", questions: [{ question: "Will SSO ship?", why: "Renewal", commitments: ["C1"], searches: ["SSO fix"], datasets: [] }] },
      investigator: { answer: "Only the promise itself.", status: "unclear", citations: [] },
      // Asks for a search that finds nothing beyond what was already read.
      critic: { reviews: [{ questionId: "Q1", verdict: "needs_evidence", reason: "Find an update", searches: ["SSO status update"], datasets: [] }] },
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
          { question: "Will SSO ship?", why: "Renewal", commitments: ["C1"], searches: ["SSO fix"], datasets: [] },
          { question: "Is Lina unhappy?", why: "Churn", commitments: [], searches: ["Lina"], datasets: [] },
        ],
      },
      investigator: (user: string) =>
        user.includes("No ETA yet")
          ? { answer: "Moved to next sprint.", status: "contradicted", citations: [{ ref: "S2", stance: "contradicts", excerpt: "No ETA yet, moving to next sprint." }] }
          : { answer: "Not enough.", status: "unclear", citations: [] },
      critic: (_user: string, n: number) =>
        n === 0
          ? { reviews: [{ questionId: "Q1", verdict: "needs_evidence", reason: "Check the ticket", searches: ["SSO ticket"], datasets: [] }, { questionId: "Q2", verdict: "approved", reason: "Fine", searches: [], datasets: [] }] }
          : { reviews: [{ questionId: "Q1", verdict: "approved", reason: "Backed", searches: [], datasets: [] }] },
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

describe("documents", () => {
  const page = (n: number, body: string) => `[Page ${n}]\n${body}`;
  const long = Array.from({ length: 6 }, (_, i) => page(i + 1, `Clause ${i + 1}. ${"Lorem ipsum dolor sit amet. ".repeat(180)}`)).join("\n\n");

  it("splits long documents into overlapping sections at page breaks", () => {
    const sections = documentSections(long);
    expect(sections.length).toBeGreaterThan(1);
    for (const s of sections) expect(s.length).toBeLessThanOrEqual(12_000);
    // Every section after the first starts near a page marker and overlaps the previous one.
    expect(sections[1]).toContain("[Page ");
    expect(sections.join("").length).toBeGreaterThan(long.length);
    expect(documentSections("short text")).toEqual(["short text"]);
  });

  it("reads each section and keeps one copy of findings repeated in the overlap", async () => {
    const promise = "Vendor will provide 99.9% monthly uptime.";
    const doc = `${long}\n\n${page(7, promise)}`;
    const { model, calls } = scriptedChatModel({
      extract: (user: string) => ({
        items: user.includes(promise)
          ? [{ type: "commitment", summary: "99.9% uptime", madeBy: null, ownerEmail: null, dueDate: null, confidence: 0.9, excerpt: promise }]
          : [],
        updates: [],
      }),
    });
    const result = await extractFromItem(model, {
      org: { name: "Acme", internalDomains: ["acme.com"] },
      account: { name: "Halcyon", domain: null },
      item: { kind: "document", provider: "google", title: "MSA.pdf", author: null, occurredAt: new Date("2026-10-01T00:00:00Z"), container: null, content: doc },
      known: [],
    });
    expect(calls.length).toBe(documentSections(doc).length);
    expect(calls[0]!.system).toContain("This is a document");
    expect(result.items.map((i) => i.summary)).toEqual(["99.9% uptime"]);
  });
});

describe("readContractTerms", () => {
  const CONTRACT = `Order Form\nCustomer: Halcyon Freight\nSubscription term: 12 months starting 2026-01-15, renewing automatically unless either party gives 60 days notice.\nFees: $48,000 per year.`;
  const input = { title: "Halcyon order form.pdf", content: CONTRACT, accountName: "Halcyon Freight", today: "2026-10-25" };
  const answer = { isContract: true, kind: "order_form", renewalDate: "2027-01-15", noticeDays: 60, annualValue: 48000, currency: "usd", excerpt: "Subscription term: 12 months starting 2026-01-15" };

  it("returns checked terms from a contract", async () => {
    expect(looksLikeContract(input.title, CONTRACT)).toBe(true);
    const { model } = scriptedChatModel({ contract_terms: answer });
    const { terms } = await readContractTerms(model, input);
    expect(terms).toEqual({ kind: "order_form", renewalDate: "2027-01-15", noticeDays: 60, annualValue: 48000, currency: "USD", excerpt: answer.excerpt });
  });

  it("drops terms whose quote isn't in the document, and non-contracts", async () => {
    const invented = scriptedChatModel({ contract_terms: { ...answer, excerpt: "Renews on 2027-01-15 for $48,000" } });
    expect((await readContractTerms(invented.model, input)).terms).toBeNull();
    const notOne = scriptedChatModel({ contract_terms: { ...answer, isContract: false, kind: "not_a_contract" } });
    expect((await readContractTerms(notOne.model, input)).terms).toBeNull();
    expect(looksLikeContract("Q3 roadmap.pptx", "Roadmap themes for the quarter")).toBe(false);
  });
});

describe("tool actions", () => {
  const base = {
    today: "2026-10-11",
    org: { name: "Acme", emailSignature: null },
    account: { name: "Halcyon Freight", domain: "halcyon.com", ownerName: "Priya", renewalDate: null, annualValue: null, healthScore: null, about: null },
    contacts: [],
    commitments: [],
    recent: [{ id: "src-1", provider: "slack", title: "#halcyon", author: "Lina", occurredAt: new Date("2026-10-10"), content: "Any news on the CSV export you promised? Our finance team is waiting." }],
    openFlags: [],
    pendingActions: [],
    memories: [],
    datasets: [],
    history: ["Lina Park (lina@halcyon.com) was a contact at Northwind until 2026-08-01."],
  } satisfies Omit<AccountContext, "tools">;
  const tools = { search: async () => [], read: async () => [base.recent[0]!] };
  const none = { emailTo: [], emailSubject: null, emailBody: null, remindOn: null, message: null };
  const script = {
    planner: { summary: "s", questions: [{ question: "Is the export tracked?", why: "w", commitments: [], searches: ["export"], datasets: [] }] },
    investigator: { answer: "Customer is waiting.", status: "supported", citations: [{ ref: "S1", stance: "supports", excerpt: "Any news on the CSV export you promised?" }] },
    critic: { reviews: [{ questionId: "Q1", verdict: "approved", reason: "ok", searches: [], datasets: [] }] },
    advisor: {
      flags: [],
      actions: [
        { type: "create_ticket", flag: null, rationale: "Untracked", ...none, teamKey: "eng", taskTitle: "CSV export for Halcyon", taskBody: "Promised to Lina.", dueDate: null },
        { type: "create_ticket", flag: null, rationale: "Unknown team", ...none, teamKey: "OPS", taskTitle: "x", taskBody: "y", dueDate: null },
        { type: "update_crm", flag: null, rationale: "Follow up", ...none, teamKey: null, taskTitle: "Call Lina about the export", taskBody: "Finance waiting", dueDate: "2026-10-15" },
        { type: "update_crm", flag: null, rationale: "Past", ...none, teamKey: null, taskTitle: "Too late", taskBody: null, dueDate: "2026-10-01" },
      ],
    },
  };

  it("keeps tool actions only for teams and tools the account has", async () => {
    const { model, calls } = scriptedChatModel(script);
    const result = await runAccountAgents({ ...base, tools: { linearTeams: [{ key: "ENG", name: "Engineering" }], crmTasks: true } }, { model, tools, onStep: () => {} });
    expect(result.actions).toEqual([
      { type: "create_ticket", flag: null, rationale: "Untracked", teamKey: "ENG", title: "CSV export for Halcyon", description: "Promised to Lina." },
      { type: "update_crm", flag: null, rationale: "Follow up", subject: "Call Lina about the export", body: "Finance waiting", dueDate: "2026-10-15" },
    ]);
    // The World Model's history reaches the planner and the advisor; the advisor is told which tools exist.
    expect(calls.find((c) => c.name === "planner")!.user).toContain("was a contact at Northwind");
    const advisor = calls.find((c) => c.name === "advisor")!;
    expect(advisor.user).toContain("was a contact at Northwind");
    expect(advisor.system).toContain("ENG = Engineering");
  });

  it("drops tool actions when the tools aren't connected", async () => {
    const { model, calls } = scriptedChatModel(script);
    const result = await runAccountAgents({ ...base, tools: { linearTeams: [], crmTasks: false } }, { model, tools, onStep: () => {} });
    expect(result.actions).toEqual([]);
    expect(calls.find((c) => c.name === "advisor")!.system).not.toContain("create_ticket files");
  });
});

describe("live data through Zetaris", () => {
  const usage: SourceDoc = {
    id: "zetaris-usage", provider: "zetaris", title: "Zetaris · Product usage by month", author: null, occurredAt: new Date("2026-10-26"),
    content: "month | active_vehicles | sso_logins\n2026-10 | 74 | 0\n2026-09 | 118 | 0",
  };
  const ctx: AccountContext = {
    today: "2026-10-26",
    org: { name: "Orbit Fleet", emailSignature: null },
    account: { name: "Halcyon Freight", domain: "halcyonfreight.com", ownerName: "Mounir", renewalDate: "2026-11-20", annualValue: "$64,800", healthScore: null, about: null },
    contacts: [],
    commitments: [],
    recent: [],
    openFlags: [],
    pendingActions: [],
    memories: [],
    history: [],
    datasets: [{ name: "Product usage by month", description: "Active vehicles and logins per month" }],
    tools: { linearTeams: [], crmTasks: false },
  };

  it("queries the datasets the planner picks and lets the findings cite their rows", async () => {
    const queried: string[] = [];
    const tools = {
      search: async () => [],
      read: async () => [],
      queryData: async (name: string) => (queried.push(name), name === "Product usage by month" ? usage : null),
    };
    const { model, calls } = scriptedChatModel({
      planner: { summary: "s", questions: [{ question: "Is usage dropping before the renewal?", why: "w", commitments: [], searches: ["usage"], datasets: ["Product usage by month", "Made-up dataset"] }] },
      investigator: { answer: "Active vehicles fell from 118 to 74.", status: "supported", citations: [{ ref: "S1", stance: "supports", excerpt: "2026-10 | 74 | 0" }, { ref: "S1", stance: "supports", excerpt: "2026-10 | 99 | 0" }] },
      critic: { reviews: [{ questionId: "Q1", verdict: "approved", reason: "ok", searches: [] }] },
      advisor: {
        flags: [{ kind: "churn_signal", title: "Halcyon usage down 37% before renewal", explanation: "e", severity: "high", confidence: 0.8, commitment: null, topic: "usage drop", evidence: [{ ref: "S1", stance: "supports", excerpt: "2026-10 | 74 | 0" }] }],
        actions: [],
      },
    });
    const result = await runAccountAgents(ctx, { model, tools, onStep: () => {} });
    // Only datasets that exist are queried.
    expect(queried).toEqual(["Product usage by month"]);
    expect(calls.find((c) => c.name === "planner")!.user).toContain("- Product usage by month: Active vehicles and logins per month");
    expect(calls.find((c) => c.name === "investigator")!.user).toContain("2026-10 | 74 | 0");
    // An invented row is dropped; the real one becomes the flag's evidence, tied to the saved table.
    expect(result.findings[0]!.citations.map((c) => c.excerpt)).toEqual(["2026-10 | 74 | 0"]);
    expect(result.flags[0]!.evidence).toEqual([{ sourceItemId: "zetaris-usage", commitmentId: null, stance: "supports", excerpt: "2026-10 | 74 | 0" }]);
  });
});

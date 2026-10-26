import { describe, expect, it } from "vitest";
import { matchItem, participantEmails, type MatchContext, type MatchInput } from "../src/matching/match.js";

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  internalDomains: new Set(["acme.com"]),
  accountsByDomain: new Map([["northwind.com", ["acc-nw"]], ["initech.io", ["acc-in"]], ["shared.com", ["acc-a", "acc-b"]]]),
  contactAccounts: new Map([["lina@gmail.com", "acc-in"]]),
  accountsByCrmId: new Map([["hubspot:42", "acc-nw"]]),
  mappings: new Map(),
  ...over,
});
const email = (metadata: Record<string, unknown>, author: string | null = null): MatchInput => ({
  connectionId: "c1", provider: "microsoft", containerId: null, containerLabel: null, author, metadata,
});

describe("matchItem", () => {
  it("matches an email by the client's domain, ignoring our own and free-mail domains", () => {
    const r = matchItem(email({ from: "sara@acme.com", to: ["ops@northwind.com", "x@gmail.com"] }), ctx());
    expect(r).toEqual({ status: "matched", accountId: "acc-nw", reason: "email domain northwind.com" });
  });

  it("routes a file by the people and domains it's shared with", () => {
    const file = (metadata: Record<string, unknown>): MatchInput => ({ ...email(metadata), provider: "google" });
    expect(matchItem(file({ modifiedBy: "sara@acme.com", sharedWith: ["lina@northwind.com"] }), ctx())).toMatchObject({ status: "matched", accountId: "acc-nw" });
    expect(matchItem(file({ sharedWith: [], sharedWithDomains: ["initech.io"] }), ctx())).toEqual({ status: "matched", accountId: "acc-in", reason: "shared with initech.io" });
    // Shared only inside the company: not a client's file.
    expect(matchItem(file({ sharedWith: ["ops@acme.com"], sharedWithDomains: ["acme.com"] }), ctx()).status).toBe("unmatched");
  });

    it("matches subdomains to the parent domain", () => {
    expect(matchItem(email({ from: "bot@mail.northwind.com" }), ctx()).accountId).toBe("acc-nw");
  });

  it("prefers a known contact over domains (even on free mail)", () => {
    const r = matchItem(email({ from: "Lina <lina@gmail.com>", to: ["ops@northwind.com"] }), ctx());
    expect(r).toMatchObject({ status: "matched", accountId: "acc-in", reason: "contact lina@gmail.com" });
  });

  it("parses Google-style From headers from the author field", () => {
    expect(participantEmails({ author: "Sara Benali <sara@northwind.com>", metadata: {} })).toEqual(["sara@northwind.com"]);
  });

  it("flags emails that touch two clients as ambiguous instead of guessing", () => {
    const r = matchItem(email({ to: ["a@northwind.com", "b@initech.io"] }), ctx());
    expect(r.status).toBe("ambiguous");
    expect(r.accountId).toBeNull();
  });

  it("treats a domain shared by two accounts as ambiguous", () => {
    expect(matchItem(email({ to: ["x@shared.com"] }), ctx()).status).toBe("ambiguous");
  });

  it("leaves internal-only mail unmatched", () => {
    expect(matchItem(email({ from: "a@acme.com", to: ["b@acme.com"] }), ctx())).toMatchObject({ status: "unmatched", accountId: null });
  });

  it("routes Slack messages only through an owner's channel mapping", () => {
    const slack: MatchInput = { connectionId: "c2", provider: "slack", containerId: "C1", containerLabel: "#northwind", author: "U1", metadata: { text: "ops@initech.io" } };
    expect(matchItem(slack, ctx())).toMatchObject({ status: "unmatched", reason: "#northwind isn't mapped to an account" });
    const mapped = ctx({ mappings: new Map([["c2:C1", { accountId: "acc-nw", ignored: false, label: "#northwind" }]]) });
    expect(matchItem(slack, mapped)).toEqual({ status: "matched", accountId: "acc-nw", reason: "#northwind is mapped to this account" });
    const ignored = ctx({ mappings: new Map([["c2:C1", { accountId: null, ignored: true, label: "#random" }]]) });
    expect(matchItem(slack, ignored).status).toBe("ignored");
  });

  it("links HubSpot companies and their contacts to the imported account", () => {
    const company: MatchInput = { connectionId: "c3", provider: "hubspot", containerId: null, containerLabel: null, author: null, metadata: { object: "companies", id: "42" } };
    expect(matchItem(company, ctx()).accountId).toBe("acc-nw");
    const contact = { ...company, metadata: { object: "contacts", id: "7", associatedcompanyid: "42", email: "z@other.com" } };
    expect(matchItem(contact, ctx()).accountId).toBe("acc-nw");
  });
});

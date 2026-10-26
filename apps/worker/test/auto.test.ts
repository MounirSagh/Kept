import { describe, expect, it } from "vitest";
import { accountKeys, accountNamedBy, decideContainer } from "../src/matching/auto.js";

const accounts = [
  { id: "halcyon", name: "Halcyon Freight Inc.", domain: "halcyonfreight.com" },
  { id: "halcyon-labs", name: "Halcyon", domain: "halcyon.io" },
  { id: "northwind", name: "Northwind", domain: "northwind.com" },
  { id: "acme-support", name: "Support", domain: null },
  { id: "ibm", name: "IBM", domain: "ibm.com" },
];

describe("names that name a client", () => {
  it("builds keys from the name, run-together words and the domain", () => {
    expect(accountKeys(accounts[0]!)).toEqual([["halcyon", "freight"], ["halcyonfreight"]]);
    expect(accountKeys(accounts[2]!)).toEqual([["northwind"]]);
    // Too short or too generic to trust on its own.
    expect(accountKeys(accounts[3]!)).toEqual([]);
    expect(accountKeys(accounts[4]!)).toEqual([]);
  });

  it("finds the one client a container is named after", () => {
    expect(accountNamedBy("#ext-northwind", accounts)).toEqual({ accountId: "northwind", key: "northwind" });
    expect(accountNamedBy("Drive › Clients › Northwind", accounts)?.accountId).toBe("northwind");
    // Longest name wins over a shorter one it contains.
    expect(accountNamedBy("#halcyon-freight-onboarding", accounts)?.accountId).toBe("halcyon");
    expect(accountNamedBy("#halcyonfreight", accounts)?.accountId).toBe("halcyon");
    expect(decideContainer({ label: "#halcyonfreight", people: new Map() }, accounts)?.reason).toBe('Its name matches Halcyon Freight Inc. ("halcyonfreight")');
    expect(decideContainer({ label: "#halcyon-freight", people: new Map() }, accounts)?.reason).toBe("Its name matches Halcyon Freight Inc.");
    expect(accountNamedBy("#halcyon", accounts)?.accountId).toBe("halcyon-labs");
    // Whole words only, and generic names never count.
    expect(accountNamedBy("#northwinds-fans", accounts)).toBeNull();
    expect(accountNamedBy("#support", accounts)).toBeNull();
    expect(accountNamedBy("#general", accounts)).toBeNull();
  });
});

describe("deciding a container", () => {
  const people = (entries: [string, number][]) => new Map(entries);

  it("routes by name, saying so", () => {
    expect(decideContainer({ label: "#ext-northwind", people: people([]) }, accounts)).toEqual({
      accountId: "northwind",
      reason: "Its name matches Northwind",
    });
    expect(decideContainer({ label: "#ext-northwind", people: people([["northwind", 4]]) }, accounts)?.reason).toBe(
      'Its name matches Northwind, and 4 of its 4 messages with clients are from their people',
    );
  });

  it("routes by people when nearly all point to one client", () => {
    expect(decideContainer({ label: "#shared-ops", people: people([["northwind", 9], ["halcyon", 1]]) }, accounts)).toEqual({
      accountId: "northwind",
      reason: "9 of its 10 messages with clients are from Northwind's people",
    });
  });

  it("leaves it to an owner when evidence is thin, split, or contradicts the name", () => {
    expect(decideContainer({ label: "#deals", people: people([["northwind", 2]]) }, accounts)).toBeNull();
    expect(decideContainer({ label: "#deals", people: people([["northwind", 6], ["halcyon", 4]]) }, accounts)).toBeNull();
    expect(decideContainer({ label: "#ext-northwind", people: people([["halcyon", 5]]) }, accounts)).toBeNull();
  });
});

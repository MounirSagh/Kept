import { describe, expect, it } from "vitest";
import { parseCsv, toAccountRows, toCommitmentRows } from "../src/csv.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines, CRLF and BOM", () => {
    const t = parseCsv('﻿Name,Notes\r\n"Northwind, Inc.","Said ""Friday""\nfor sure"\r\nInitech,plain\r\n\r\n');
    expect(t.headers).toEqual(["Name", "Notes"]);
    expect(t.rows).toEqual([["Northwind, Inc.", 'Said "Friday"\nfor sure'], ["Initech", "plain"]]);
  });

  it("detects semicolon-separated files", () => {
    expect(parseCsv("Name;Domain\nNorthwind;northwind.com").rows).toEqual([["Northwind", "northwind.com"]]);
  });
});

describe("toAccountRows", () => {
  it("maps flexible headers and reports bad rows with spreadsheet row numbers", () => {
    const t = parseCsv("Company,Website,CSM Email,Renewal Date,ARR,Currency\nNorthwind,www.northwind.com,Sara@Acme.com,2026-12-01,\"$48,000\",usd\n,x.com,,,,\nInitech,,,someday,,\nGlobex,,,,12k?,\n");
    const { rows, errors } = toAccountRows(t);
    expect(rows).toEqual([{ row: 2, name: "Northwind", domain: "www.northwind.com", ownerEmail: "sara@acme.com", renewalDate: "2026-12-01", annualValue: 48000, currency: "USD" }]);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5]);
  });

  it("reads money in common shapes and rejects the rest", async () => {
    const { parseMoneyCell } = await import("../src/csv.js");
    expect(["$48,000", "48000.5", "48k", "USD 1.2m", "€ 12"].map(parseMoneyCell)).toEqual([48000, 48000.5, 48000, 1200000, 12]);
    expect(["12k?", "about 5", "1-2"].map(parseMoneyCell)).toEqual([null, null, null]);
  });

  it("requires a name column", () => {
    expect(toAccountRows(parseCsv("Domain\nx.com")).errors[0]?.message).toMatch(/name column/);
  });
});

describe("toCommitmentRows", () => {
  it("reads commitments with status words and dates", () => {
    const t = parseCsv("Client,Promise,Deadline,Owner,Promised by,Status\nNorthwind,SSO by Nov 1,2026-11-01,sara@acme.com,Sara,In progress\nnorthwind.com,QBR deck,,,,Done\nInitech,Fix export,,,,whenever\n");
    const { rows, errors } = toCommitmentRows(t);
    expect(rows.map((r) => [r.account, r.summary, r.dueDate, r.status])).toEqual([
      ["Northwind", "SSO by Nov 1", "2026-11-01", "open"],
      ["northwind.com", "QBR deck", null, "fulfilled"],
    ]);
    expect(errors).toEqual([{ row: 4, message: 'Unknown status "whenever" (use open, fulfilled or broken)' }]);
  });
});

describe("team and invitation rows", async () => {
  const { toTeamRows, toInvitationRows } = await import("../src/csv.js");
  it("reads teams and rejects duplicates", () => {
    const { rows, errors } = toTeamRows(parseCsv("Team\nEnterprise\nMid-market\nenterprise\n\n"));
    expect(rows.map((r) => r.name)).toEqual(["Enterprise", "Mid-market"]);
    expect(errors).toEqual([{ row: 4, message: '"enterprise" appears twice in the file' }]);
  });
  it("reads invitations with default role and validates emails and roles", () => {
    const { rows, errors } = toInvitationRows(parseCsv("Email,Role,Team\nLina@Acme.com,,Enterprise\nomar@acme.com,Manager,\nnot-an-email,member,\nx@acme.com,admin,\n"));
    expect(rows).toEqual([
      { row: 2, email: "lina@acme.com", role: "member", team: "Enterprise" },
      { row: 3, email: "omar@acme.com", role: "manager", team: null },
    ]);
    expect(errors.map((e) => e.row)).toEqual([4, 5]);
  });
});

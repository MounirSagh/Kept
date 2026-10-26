import { describe, expect, it } from "vitest";
import { localClock, renderDigest, type DigestData } from "../src/agents/daily.js";

describe("localClock", () => {
  it("reads the date and hour in the org's time zone", () => {
    const now = new Date("2026-10-25T05:30:00Z");
    expect(localClock("UTC", now)).toEqual({ day: "2026-10-25", hour: 5 });
    expect(localClock("America/Toronto", now)).toEqual({ day: "2026-10-25", hour: 1 });
    expect(localClock("Asia/Tokyo", now)).toEqual({ day: "2026-10-25", hour: 14 });
    // Still the previous day in Los Angeles.
    expect(localClock("America/Los_Angeles", now).day).toBe("2026-10-24");
  });

  it("treats a missing or unknown zone as UTC", () => {
    const now = new Date("2026-10-25T09:00:00Z");
    expect(localClock(undefined, now)).toEqual({ day: "2026-10-25", hour: 9 });
    expect(localClock("Mars/Olympus", now)).toEqual({ day: "2026-10-25", hour: 9 });
  });
});

describe("renderDigest", () => {
  const base: DigestData = {
    name: "Mounir",
    orgName: "Acme",
    day: "2026-10-25",
    links: { flags: "https://kept.app/o/acme/flags", approvals: "https://kept.app/o/acme/approvals", commitments: "https://kept.app/o/acme/commitments", theirs: "https://kept.app/o/acme/commitments?side=theirs" },
    flags: [],
    approvals: 0,
    dueMine: [],
    theirsOverdue: [],
  };

  it("says what's inside in the subject and links each section", () => {
    const d = renderDigest({
      ...base,
      flags: [{ title: "SSO will miss <the> renewal", severity: "critical", account: "Northwind", isNew: true }],
      approvals: 3,
      dueMine: [{ summary: "Send the questionnaire", account: "Northwind", dueDate: "2026-10-24", overdue: true }],
      theirsOverdue: [{ summary: "Okta metadata", account: "Northwind", dueDate: "2026-10-23" }],
    });
    expect(d.subject).toBe("Kept: 1 promise at risk, 3 suggestions to review, 1 of yours due");
    expect(d.text).toContain("At risk (1 new)");
    expect(d.text).toContain("Overdue since Oct 24: Send the questionnaire (Northwind)");
    expect(d.text).toContain("Northwind: Okta metadata (was due Oct 23)");
    expect(d.text).toContain("Open approvals: https://kept.app/o/acme/approvals");
    // Model-written titles are escaped in the HTML.
    expect(d.html).toContain("SSO will miss &lt;the&gt; renewal");
    expect(d.html).not.toContain("<the>");
  });

  it("caps the list of flags", () => {
    const flags = Array.from({ length: 8 }, (_, i) => ({ title: `Flag ${i}`, severity: "medium" as const, account: "A", isNew: false }));
    const d = renderDigest({ ...base, flags });
    expect(d.text).toContain("Flag 4");
    expect(d.text).not.toContain("Flag 5");
    expect(d.text).toContain("and 3 more");
  });
});

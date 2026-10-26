import { describe, expect, it } from "vitest";
import { WorldModel } from "@kept/world-model";
import { accountEntityId, accountHistory } from "../src/agents/world.js";

const src = (at: string, by = "account-sync") => ({ kind: "pipeline", by, at });

async function world() {
  const wm = new WorldModel({ namespace: "test" });
  const account = (id: string, name: string, attrs: Record<string, unknown>, at: string, by?: string) =>
    wm.upsertEntity({ type: "account", externalKey: { system: "kept", id }, name, attrs, source: src(at, by) });
  await account("halcyon", "Halcyon Freight", { renewalDate: "2026-12-01", annualValue: "40,000 USD", ownerUserId: "priya" }, "2026-06-01T00:00:00Z");
  await account("northwind", "Northwind", { ownerUserId: "priya" }, "2026-06-01T00:00:00Z");
  await account("globex", "Globex", { ownerUserId: "sam" }, "2026-06-01T00:00:00Z");
  await account("halcyon", "Halcyon Freight", { renewalDate: "2027-01-15", annualValue: "48,000 USD" }, "2026-10-25T00:00:00Z", 'from "Order form.pdf", approved by Priya');

  const person = async (email: string, name: string) =>
    (await wm.upsertEntity({ type: "person", externalKey: { system: "email", id: email }, name, attrs: { email }, source: src("2026-06-01T00:00:00Z") })).id;
  const lina = await person("lina@x.com", "Lina Park");
  const marc = await person("marc@x.com", "Marc Roy");
  const relate = (from: string, to: string, at: string) => wm.relate({ from, type: "works_at", to: accountEntityId(to), source: src(at) });
  await relate(lina, "northwind", "2026-06-01T00:00:00Z");
  await relate(lina, "halcyon", "2026-09-01T00:00:00Z");
  await relate(marc, "halcyon", "2026-06-01T00:00:00Z");
  await relate(marc, "globex", "2026-10-01T00:00:00Z");

  const promise = async (id: string, type: string, name: string, status: string, dueDate: string | null) => {
    const e = await wm.upsertEntity({ type, externalKey: { system: "kept", id }, name, attrs: { status, dueDate }, source: src("2026-07-01T00:00:00Z") });
    await wm.relate({ from: e.id, type: "concerns", to: accountEntityId("halcyon"), source: src("2026-07-01T00:00:00Z") });
  };
  await promise("c1", "commitment", "SSO live", "broken", "2026-08-01");
  await promise("c2", "commitment", "CSV export", "fulfilled", null);
  await promise("c3", "commitment", "Weekly report", "open", null);
  await promise("o1", "obligation", "Send Okta metadata", "open", null);
  return wm;
}

describe("account history from the World Model", () => {
  it("tells term changes, track record and people who moved", async () => {
    const lines = accountHistory(await world(), "halcyon");
    expect(lines).toEqual([
      'Renewal date changed from 2026-12-01 to 2027-01-15 on 2026-10-25 (from "Order form.pdf", approved by Priya).',
      'Yearly value changed from 40,000 USD to 48,000 USD on 2026-10-25 (from "Order form.pdf", approved by Priya).',
      "Track record, promises the company made to this client: 3 so far, 1 kept, 1 broken, 0 replaced, 1 open.",
      'Broken: "SSO live" (was due 2026-08-01), recorded 2026-07-01.',
      // Same owner: named. Different owner: not, since the flag's readers may not see that client.
      "Lina Park (lina@x.com) joined this client from Northwind on 2026-09-01.",
      "Marc Roy (marc@x.com) left this client for another client on 2026-10-01: no longer a contact here.",
    ]);
  });

  it("knows nothing about an account it has never seen", async () => {
    expect(accountHistory(await world(), "unknown")).toEqual([]);
  });
});

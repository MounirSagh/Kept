import { describe, expect, it } from "vitest";
import { WorldModel, type AuditEntry, type SideState, type WorldEvent, type WorldStorage, type WorldWrite } from "../src/index.js";

/** Durable storage in memory: a shared log with a lock, like Postgres but without the database. */
function fakeStorage(opts: { failWrites?: () => boolean } = {}) {
  const log = { events: [] as WorldEvent[], audit: [] as AuditEntry[], side: null as SideState | null };
  let lock = Promise.resolve();
  const storage: WorldStorage = {
    transaction(_ns, fn) {
      const run = lock.then(async () => {
        const staged: WorldWrite[] = [];
        const result = await fn({
          async readSince(eventSeq, auditSeq) {
            return {
              events: structuredClone(log.events.filter((e) => e.seq > eventSeq)),
              audit: structuredClone(log.audit.filter((a) => a.seq > auditSeq)),
              side: structuredClone(log.side),
            };
          },
          async write(changes) {
            if (opts.failWrites?.()) throw new Error("simulated write failure");
            staged.push(structuredClone(changes));
          },
        });
        for (const w of staged) {
          for (const e of w.events) {
            if (log.events.some((x) => x.seq === e.seq)) throw new Error(`duplicate seq ${e.seq}`);
            log.events.push(e);
          }
          log.audit.push(...w.audit);
          log.side = w.side;
        }
        return result;
      });
      lock = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { storage, log };
}

const at = (iso: string) => ({ kind: "manual", at: iso });
const OBS = [
  { externalId: "m1", title: "Renewal call", at: "2026-10-01T10:00:00.000Z", source: { kind: "email", at: "2026-10-01T10:00:00.000Z" }, entities: [{ type: "account", name: "Northwind" }] },
  { externalId: "m2", title: "SSO follow-up", at: "2026-10-02T09:00:00.000Z", source: { kind: "email", at: "2026-10-02T09:00:00.000Z" }, entities: [{ type: "account", name: "Northwind" }] },
];

describe("durable worlds", () => {
  it("a reloaded world equals the world that was written, including fact winners and aggregates", async () => {
    const { storage } = fakeStorage();
    const a = await WorldModel.open({ storage, namespace: "org", conflictPolicy: "highest-confidence-wins" });
    await a.ingest(OBS);
    await a.assertFact({ about: "account:crm:1", predicate: "tier", value: "gold", confidence: 0.9, source: at("2026-10-01T00:00:00.000Z") });
    await a.assertFact({ about: "account:crm:1", predicate: "tier", value: "silver", confidence: 0.4, source: at("2026-10-05T00:00:00.000Z") });

    const b = await WorldModel.open({ storage, namespace: "org", conflictPolicy: "highest-confidence-wins" });
    expect(b.stateShapeCanonical()).toBe(a.stateShapeCanonical());
    expect(b.view("graph").entity("account:crm:1")?.attrs.tier).toBe("gold");
    const northwind = b.view("graph").query({ type: "account", where: (e) => e.name === "Northwind" })[0];
    expect(northwind?.aggregates?.mentionCount).toBe(2);
  });

  it("re-ingesting after a reload is still a no-op", async () => {
    const { storage } = fakeStorage();
    const a = await WorldModel.open({ storage, namespace: "org" });
    await a.ingest(OBS);
    const b = await WorldModel.open({ storage, namespace: "org" });
    const report = await b.ingest(OBS);
    expect(report.changed).toBe(false);
  });

  it("two writers on one namespace extend a single gap-free log and converge", async () => {
    const { storage, log } = fakeStorage();
    const a = await WorldModel.open({ storage, namespace: "org" });
    const b = await WorldModel.open({ storage, namespace: "org" });
    await Promise.all([
      a.upsertEntity({ type: "person", name: "Sara Benali", source: at("2026-10-01T00:00:00.000Z") }),
      b.upsertEntity({ type: "person", name: "Omar Idrissi", source: at("2026-10-01T00:00:00.000Z") }),
      a.relate({ from: "person:crm:sara", type: "owns", to: "account:crm:1", source: at("2026-10-01T00:00:00.000Z") }),
      b.upsertEntity({ type: "account", externalKey: { system: "crm", id: "1" }, source: at("2026-10-01T00:00:00.000Z") }),
    ]);
    expect(log.events.map((e) => e.seq)).toEqual(log.events.map((_, i) => i + 1));
    await a.refresh();
    await b.refresh();
    expect(a.stateShapeCanonical()).toBe(b.stateShapeCanonical());
    const audit = a.audit().map((e) => e.seq);
    expect(audit).toEqual([...audit].sort((x, y) => x - y));
    expect(new Set(audit).size).toBe(audit.length);
  });

  it("a failed write leaves memory consistent with storage", async () => {
    let fail = false;
    const { storage } = fakeStorage({ failWrites: () => fail });
    const world = await WorldModel.open({ storage, namespace: "org" });
    await world.upsertEntity({ type: "person", name: "Kept", source: at("2026-10-01T00:00:00.000Z") });
    const before = world.stateShapeCanonical();

    fail = true;
    await expect(world.upsertEntity({ type: "person", name: "Lost", source: at("2026-10-02T00:00:00.000Z") })).rejects.toThrow();
    fail = false;
    await world.refresh();
    expect(world.stateShapeCanonical()).toBe(before);
    expect(world.view("graph").query({ type: "person" }).map((e) => e.name)).toEqual(["Kept"]);
  });
});

import { describe, expect, it } from "vitest";
import { hashEmbed, type Embedder } from "@kept/llm";
import { DurableHMEM, type MemoryBackup, type MemorySide, type MemoryStorage, type MemoryWrite } from "../src/durable.js";
import type { LedgerEntry, MemoryRecord } from "../src/types.js";

/** Durable storage in memory, with the same contract as Postgres. */
function fakeStorage(opts: { failWrites?: () => boolean } = {}) {
  const db = {
    version: 0,
    records: new Map<string, MemoryRecord>(),
    side: null as MemorySide | null,
    ledger: [] as LedgerEntry[],
    backups: [] as MemoryBackup[],
    writes: 0,
  };
  let lock = Promise.resolve();
  const storage: MemoryStorage = {
    transaction(_ns, fn) {
      const run = lock.then(async () => {
        let staged: MemoryWrite | null = null;
        const result = await fn({
          async version() {
            return db.version;
          },
          async load() {
            return {
              version: db.version,
              records: structuredClone([...db.records.values()]),
              side: structuredClone(
                db.side ?? { recordSeq: 0, ledgerSeq: 0, conflicts: [], conflictSeq: 0, proposals: [], dreamSeq: 0, backupSeq: 0 },
              ),
              backups: structuredClone(db.backups),
            };
          },
          async write(changes) {
            if (opts.failWrites?.()) throw new Error("simulated write failure");
            staged = structuredClone(changes);
          },
        });
        if (staged) {
          const w = staged as MemoryWrite;
          for (const { record, withEmbedding } of w.upsert) {
            const prev = db.records.get(record.id);
            db.records.set(record.id, withEmbedding || !prev ? record : { ...record, embedding: prev.embedding });
          }
          for (const id of w.remove) db.records.delete(id);
          db.ledger.push(...w.ledger);
          db.backups.push(...w.backups);
          db.side = w.side;
          db.version = w.version;
          db.writes++;
        }
        return result;
      });
      lock = run.then(() => undefined, () => undefined);
      return run;
    },
    async history(_ns, memoryId) {
      return db.ledger.filter((e) => e.memoryId === memoryId);
    },
  };
  return { storage, db };
}

/** Hash vectors under a different model name, standing in for OpenAI. */
const fakeModel: Embedder = { model: "fake-model", embed: async (texts) => texts.map(hashEmbed) };

const T0 = 1_760_000_000_000;
const open = (storage: MemoryStorage, embedder: Embedder = fakeModel) =>
  DurableHMEM.open({ storage, namespace: "org", embedder, clock: () => T0 });

describe("DurableHMEM", () => {
  it("remembers, recalls, and reloads to the same records", async () => {
    const { storage } = fakeStorage();
    const a = await open(storage);
    await a.remember({ content: "Northwind always wants renewal quotes in EUR", source: "flag:resolution", type: "preference" });
    await a.remember({ content: "Initech escalates through the CEO when deadlines slip", source: "flag:resolution" });

    const result = await a.recall("renewal quote currency for Northwind", { threshold: 0 });
    expect(result.memories[0]?.memory.content).toContain("EUR");

    const b = await open(storage);
    const strip = (rs: MemoryRecord[]) => rs.map(({ embedding: _e, ...r }) => r).sort((x, y) => x.id.localeCompare(y.id));
    expect(strip(b.current.store.all())).toEqual(strip(a.current.store.all()));
  });

  it("a second process sees the first one's writes and continues the ledger", async () => {
    const { storage, db } = fakeStorage();
    const a = await open(storage);
    const b = await open(storage);
    const m = await a.remember({ content: "Globex prefers async updates over calls", source: "test" });
    await b.feedback(m.id, "helpful");
    expect(b.current.store.get(m.id)?.confidence).toBeCloseTo(0.75);
    const actions = (await a.history(m.id)).map((e) => e.action);
    expect(actions).toEqual(["create", "feedback"]);
    expect(db.ledger.map((e) => e.seq)).toEqual(db.ledger.map((_, i) => i + 1));
  });

  it("re-embeds records the engine creates, so recall can compare them", async () => {
    const { storage } = fakeStorage();
    const memory = await open(storage);
    await memory.remember({ content: "Northwind prefers email over phone calls", source: "test", type: "preference" });
    await memory.remember({ content: "Northwind prefers written summaries after meetings", source: "test", type: "preference" });
    const [proposal] = await memory.dream();
    expect(proposal).toBeDefined();
    const created = await memory.approveDream(proposal!.id);
    expect(created).toBeDefined();
    expect(memory.current.store.get(created!.id)?.embeddingModel).toBe("fake-model");
  });

  it("never compares records embedded with another model", async () => {
    const { storage } = fakeStorage();
    const old = await open(storage, { model: "old-model", embed: async (t) => t.map(hashEmbed) });
    await old.remember({ content: "Northwind wants EUR quotes", source: "test" });
    const current = await open(storage);
    const result = await current.recall("Northwind EUR quotes", { threshold: 0 });
    expect(result.memories).toHaveLength(0);
    expect(await current.reembedPending()).toBe(1);
    expect((await current.recall("Northwind EUR quotes", { threshold: 0 })).memories).toHaveLength(1);
  });

  it("writes nothing when nothing changed", async () => {
    const { storage, db } = fakeStorage();
    const memory = await open(storage);
    await memory.remember({ content: "something worth keeping", source: "test" });
    const writes = db.writes;
    await memory.run(() => undefined);
    await memory.run((h) => h.store.all().length);
    expect(db.writes).toBe(writes);
  });

  it("a failed write leaves memory consistent with storage", async () => {
    let fail = false;
    const { storage } = fakeStorage({ failWrites: () => fail });
    const memory = await open(storage);
    await memory.remember({ content: "kept memory", source: "test" });
    fail = true;
    await expect(memory.remember({ content: "lost memory", source: "test" })).rejects.toThrow();
    fail = false;
    await memory.run(() => undefined);
    expect(memory.current.store.all().map((m) => m.content)).toEqual(["kept memory"]);
  });
});

// Durable H-MEM: the synchronous engine plus persistence and real embeddings.
//
// - Every operation runs in a storage transaction holding the namespace lock. If
//   another process wrote since we last looked (version changed), the engine is
//   reloaded first. Afterwards only changed records, new ledger entries and new
//   backups are written.
// - Real embeddings (OpenAI) are async, so they are computed before the lock is
//   taken and passed in. Records the engine creates itself (sleep syntheses,
//   approved dreams) get the engine's hash embedding and are re-embedded right
//   after, so every record ends up with the namespace's real model.
// - The trust ledger is append-only and grows with every read, so it is not
//   loaded into memory; `history()` reads it from storage.

import type { Embedder } from "@kept/llm";
import { canonicalJson } from "./canonical-json.js";
import { HMEM } from "./index.js";
import type { AddInput } from "./memory-store.js";
import { minedInteractionInput, parseStrictJsonArray } from "./memory-mining.js";
import type {
  ConflictRecord, DreamProposal, FeedbackKind, LedgerEntry, MemoryLayer, MemoryRecord, MiningEventType,
  QueryResult, SleepReport,
} from "./types.js";

export type MemoryBackup = { id: string; records: MemoryRecord[]; seq: number };

/** Small bookkeeping persisted next to the records. */
export interface MemorySide {
  recordSeq: number;
  ledgerSeq: number;
  conflicts: ConflictRecord[];
  conflictSeq: number;
  proposals: DreamProposal[];
  dreamSeq: number;
  backupSeq: number;
}

export interface MemorySnapshot {
  version: number;
  records: MemoryRecord[];
  side: MemorySide;
  backups: MemoryBackup[];
}

export interface MemoryWrite {
  version: number;
  upsert: { record: MemoryRecord; withEmbedding: boolean }[];
  remove: string[];
  ledger: LedgerEntry[];
  side: MemorySide;
  backups: MemoryBackup[];
}

export interface MemoryTransaction {
  /** Stored version, or 0 when the namespace has never been written. */
  version(): Promise<number>;
  load(): Promise<MemorySnapshot>;
  write(changes: MemoryWrite): Promise<void>;
}

export interface MemoryStorage {
  transaction<T>(namespace: string, fn: (tx: MemoryTransaction) => Promise<T>): Promise<T>;
  history(namespace: string, memoryId: string): Promise<LedgerEntry[]>;
}

export interface DurableHMEMOptions {
  storage: MemoryStorage;
  namespace: string;
  embedder: Embedder;
  clock?: () => number;
  actor?: string;
  /** Model hook for mining: takes an extraction prompt, returns a JSON array of memory strings. */
  minerFn?: (prompt: string) => Promise<string>;
}

type RecallOptions = { topN?: number; threshold?: number; chatId?: string; filter?: (m: MemoryRecord) => boolean };

export class DurableHMEM {
  private engine: HMEM;
  private version = -1;
  /** canonical JSON (minus embedding) of each record as last persisted */
  private persisted = new Map<string, string>();
  private persistedBackups = new Set<string>();
  private persistedSide = "";
  private reembedded = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly opts: DurableHMEMOptions) {
    this.engine = this.freshEngine();
  }

  static async open(opts: DurableHMEMOptions): Promise<DurableHMEM> {
    const memory = new DurableHMEM(opts);
    await memory.run(() => undefined);
    return memory;
  }

  get embeddingModel(): string {
    return this.opts.embedder.model;
  }

  /** Read-only access for inspection. Mutations must go through `run` so they are persisted. */
  get current(): HMEM {
    return this.engine;
  }

  /** Runs `fn` against an up-to-date engine and persists what it changed. */
  run<T>(fn: (hmem: HMEM) => T): Promise<T> {
    const next = this.queue.then(() =>
      this.opts.storage.transaction(this.opts.namespace, async (tx) => {
        const stored = await tx.version();
        if (stored !== this.version) this.load(await tx.load());
        const ledgerBefore = this.engine.ledger.lastSeq;
        try {
          const result = fn(this.engine);
          const changes = this.collectChanges(ledgerBefore);
          if (changes) await tx.write(changes);
          return result;
        } catch (err) {
          // Memory may hold changes the rolled-back transaction never stored.
          this.version = -1;
          throw err;
        }
      }),
    );
    this.queue = next.catch(() => undefined);
    return next;
  }

  async remember(input: Omit<AddInput, "embedding" | "embeddingModel">): Promise<MemoryRecord> {
    const [embedding] = await this.opts.embedder.embed([input.content]);
    return this.run((h) => h.add({ ...input, embedding, embeddingModel: this.embeddingModel }));
  }

  /** Hybrid retrieval. Only records embedded with the current model are compared to the query. */
  async recall(query: string, opts: RecallOptions = {}): Promise<QueryResult> {
    const [queryEmbedding] = await this.opts.embedder.embed([query]);
    const model = this.embeddingModel;
    return this.run((h) =>
      h.query(query, {
        ...opts,
        queryEmbedding,
        filter: (m) => m.embeddingModel === model && (!opts.filter || opts.filter(m)),
      }),
    );
  }

  feedback(memoryId: string, kind: FeedbackKind): Promise<void> {
    return this.run((h) => h.feedback(memoryId, kind));
  }

  /** Mines memories from an interaction. The model call happens before the store is locked. */
  async mine(event: MiningEventType, text: string, opts: { chatId?: string; layer?: MemoryLayer } = {}): Promise<MemoryRecord[]> {
    const miner = this.opts.minerFn;
    const candidates = miner
      ? parseStrictJsonArray(await miner(`Extract durable memories from this ${event} as a strict JSON array of strings:\n\n${text}`))
      : this.engine.mining.mineModelFree(text);
    if (candidates.length === 0) return [];
    const embeddings = await this.opts.embedder.embed(candidates);
    const layer = opts.layer ?? (miner ? "working" : "short_term");
    return this.run((h) =>
      candidates.map((content, i) =>
        h.add({
          ...minedInteractionInput(event, content, h.clock(), { chatId: opts.chatId, layer }),
          embedding: embeddings[i],
          embeddingModel: this.embeddingModel,
        }),
      ),
    );
  }

  /** Nightly consolidation: preview-first, backed up, then executed. */
  async sleep(): Promise<SleepReport> {
    const report = await this.run((h) => h.sleep.execute(h.sleep.preview()));
    await this.reembedPending();
    return report;
  }

  dream(): Promise<DreamProposal[]> {
    return this.run((h) => h.dreaming.dream());
  }

  async approveDream(proposalId: string): Promise<MemoryRecord | undefined> {
    const created = await this.run((h) => h.dreaming.approve(proposalId));
    await this.reembedPending();
    return created;
  }

  rejectDream(proposalId: string): Promise<void> {
    return this.run((h) => h.dreaming.reject(proposalId));
  }

  /** Re-embeds records whose vectors came from another model (engine-created records, or a model switch). */
  async reembedPending(): Promise<number> {
    const model = this.embeddingModel;
    const pending = this.engine.store.all().filter((m) => m.embeddingModel !== model);
    if (pending.length === 0) return 0;
    const vectors = await this.opts.embedder.embed(pending.map((m) => m.content));
    const byId = new Map(pending.map((m, i) => [m.id, { content: m.content, vector: vectors[i]! }]));
    return this.run((h) => {
      let updated = 0;
      for (const [id, { content, vector }] of byId) {
        const rec = h.store.get(id);
        // Skip records that changed or vanished while we were embedding.
        if (!rec || rec.content !== content || rec.embeddingModel === model) continue;
        h.store.setEmbedding(id, vector, model);
        this.reembedded.add(id);
        updated++;
      }
      return updated;
    });
  }

  history(memoryId: string): Promise<LedgerEntry[]> {
    return this.opts.storage.history(this.opts.namespace, memoryId);
  }

  // ------------------------------------------------------------ internals

  private freshEngine(): HMEM {
    return new HMEM({ clock: this.opts.clock, actor: this.opts.actor, minerFn: this.opts.minerFn });
  }

  private load(snapshot: MemorySnapshot): void {
    const { side } = snapshot;
    this.engine = this.freshEngine();
    this.engine.importState({
      records: snapshot.records,
      recordSeq: side.recordSeq,
      ledger: [],
      ledgerSeq: side.ledgerSeq,
      conflicts: side.conflicts,
      conflictSeq: side.conflictSeq,
      proposals: side.proposals,
      dreamSeq: side.dreamSeq,
      backups: snapshot.backups,
      backupSeq: side.backupSeq,
    });
    this.version = snapshot.version;
    this.persisted = new Map(snapshot.records.map((r) => [r.id, fingerprint(r)]));
    this.persistedBackups = new Set(snapshot.backups.map((b) => b.id));
    this.persistedSide = canonicalJson(side);
    this.reembedded.clear();
  }

  /** What `fn` changed, or null when nothing did (no write, no version bump). */
  private collectChanges(ledgerBefore: number): MemoryWrite | null {
    const state = this.engine.exportState();
    const upsert: MemoryWrite["upsert"] = [];
    const seen = new Set<string>();
    for (const record of state.records) {
      seen.add(record.id);
      const isNew = !this.persisted.has(record.id);
      const print = fingerprint(record);
      if (isNew || print !== this.persisted.get(record.id) || this.reembedded.has(record.id)) {
        upsert.push({ record, withEmbedding: isNew || this.reembedded.has(record.id) });
        this.persisted.set(record.id, print);
      }
    }
    const remove = [...this.persisted.keys()].filter((id) => !seen.has(id));
    for (const id of remove) this.persisted.delete(id);
    this.reembedded.clear();

    const backups = state.backups.filter((b) => !this.persistedBackups.has(b.id));
    for (const b of backups) this.persistedBackups.add(b.id);

    // Ledger entries are written, then dropped from memory (see the header).
    const ledger = this.engine.ledger.since(ledgerBefore);
    const ledgerSeq = this.engine.ledger.lastSeq;
    this.engine.ledger.load([], ledgerSeq);

    const side: MemorySide = {
      recordSeq: state.recordSeq,
      ledgerSeq,
      conflicts: state.conflicts,
      conflictSeq: state.conflictSeq,
      proposals: state.proposals,
      dreamSeq: state.dreamSeq,
      backupSeq: state.backupSeq,
    };
    const sidePrint = canonicalJson(side);
    const nothingChanged =
      upsert.length === 0 && remove.length === 0 && ledger.length === 0 && backups.length === 0 && sidePrint === this.persistedSide;
    if (nothingChanged && this.version > 0) return null;
    this.persistedSide = sidePrint;
    this.version += 1;
    return { version: this.version, upsert, remove, ledger, backups, side };
  }
}

/** Change detection without hashing large embedding vectors; embedding changes are tracked explicitly. */
function fingerprint(record: MemoryRecord): string {
  const { embedding: _embedding, ...rest } = record;
  return canonicalJson(rest);
}

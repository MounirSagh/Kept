// Kept's implementation of the Meterless H-MEM spec. See NOTICE.md.
// The conformance suite (conformance/runner.ts) loads this module directly.

import type { FeedbackKind, HMEMOptions, HMEMState, MemoryRecord, MiningEventType, QueryResult } from "./types.js";
import type { AddInput } from "./memory-store.js";
import { MemoryStoreService } from "./memory-store.js";
import { TrustLedgerService } from "./trust-ledger.js";
import { MemoryMiningService } from "./memory-mining.js";
import { MemoryRetrievalService } from "./memory-retrieval.js";
import { ConflictDetectionService } from "./conflict-detection.js";
import { SleepCycleService } from "./sleep-cycle.js";
import { DreamingService } from "./dreaming.js";
import { hashSyncEmbedder } from "./embeddings.js";

export * from "./types.js";
export type { AddInput } from "./memory-store.js";
export { MemoryStoreService, snapshot } from "./memory-store.js";
export { TrustLedgerService } from "./trust-ledger.js";
export { MemoryMiningService, parseStrictJsonArray, minedInteractionInput } from "./memory-mining.js";
export { MemoryRetrievalService } from "./memory-retrieval.js";
export { ConflictDetectionService } from "./conflict-detection.js";
export { SleepCycleService } from "./sleep-cycle.js";
export { DreamingService } from "./dreaming.js";
export { embed, cosine, tokenize, jaccard, hashSyncEmbedder } from "./embeddings.js";

export class HMEM {
  readonly ledger: TrustLedgerService;
  readonly store: MemoryStoreService;
  readonly mining: MemoryMiningService;
  readonly retrieval: MemoryRetrievalService;
  readonly conflicts: ConflictDetectionService;
  readonly sleep: SleepCycleService;
  readonly dreaming: DreamingService;
  readonly clock: () => number;

  constructor(opts: HMEMOptions = {}) {
    this.clock = opts.clock ?? Date.now;
    const actor = opts.actor ?? "system";
    this.ledger = new TrustLedgerService(this.clock);
    this.store = new MemoryStoreService(this.clock, this.ledger, actor, opts.embedder ?? hashSyncEmbedder);
    this.mining = new MemoryMiningService(this.store, this.clock, opts.minerFn);
    this.retrieval = new MemoryRetrievalService(this.store, this.ledger, this.clock, actor);
    this.conflicts = new ConflictDetectionService(this.store, this.ledger, this.clock, actor);
    this.sleep = new SleepCycleService(this.store, this.ledger, this.clock, actor);
    this.dreaming = new DreamingService(this.store, this.ledger, this.clock, actor);
  }

  // Convenience surface mirroring HOW_TO_USE_H-MEM.md.
  add(input: AddInput): MemoryRecord {
    return this.store.add(input);
  }
  mine(event: MiningEventType, text: string, opts?: { chatId?: string }): Promise<MemoryRecord[]> {
    return this.mining.mineInteraction(event, text, opts);
  }
  query(query: string, opts?: Parameters<MemoryRetrievalService["query"]>[1]): QueryResult {
    return this.retrieval.query(query, opts);
  }
  feedback(memoryId: string, kind: FeedbackKind): void {
    this.retrieval.feedback(memoryId, kind);
  }

  // ------------------------------------------------------------ persistence

  exportState(): HMEMState {
    const { records, seq } = this.store.snapshotAll();
    const conflicts = this.conflicts.exportState();
    const dreams = this.dreaming.exportState();
    const sleep = this.sleep.exportState();
    return {
      records,
      recordSeq: seq,
      ledger: [...this.ledger.all()],
      conflicts: conflicts.conflicts,
      conflictSeq: conflicts.seq,
      proposals: dreams.proposals,
      dreamSeq: dreams.seq,
      backups: sleep.backups,
      backupSeq: sleep.seq,
    };
  }

  /** Replaces all in-memory state. Used when loading from storage; writes nothing to the ledger. */
  importState(state: HMEMState & { ledgerSeq?: number }): void {
    this.store.load(state.records, state.recordSeq);
    this.ledger.load(state.ledger, state.ledgerSeq);
    this.conflicts.importState({ conflicts: state.conflicts, seq: state.conflictSeq });
    this.dreaming.importState({ proposals: state.proposals, seq: state.dreamSeq });
    this.sleep.importState({ backups: state.backups, seq: state.backupSeq });
  }
}

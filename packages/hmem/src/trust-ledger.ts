// Append-only trust ledger (AGENTS.md section 9.1). Entries are never
// mutated or deleted. history() reconstructs a memory's full change record
// from the previousState/newState snapshots carried on each entry.

import type { LedgerAction, LedgerEntry, MemoryRecord } from "./types.js";

export class TrustLedgerService {
  private entries: LedgerEntry[] = [];
  private seq = 0;

  constructor(private clock: () => number) {}

  /** `lastSeq` lets a durable store load no history while still continuing the sequence. */
  load(entries: LedgerEntry[], lastSeq?: number): void {
    this.entries = entries;
    this.seq = lastSeq ?? entries.reduce((max, e) => Math.max(max, e.seq), 0);
  }

  get lastSeq(): number {
    return this.seq;
  }

  since(seq: number): LedgerEntry[] {
    return this.entries.filter((e) => e.seq > seq);
  }

  log(
    memoryId: string,
    action: LedgerAction,
    actor: string,
    extra?: { previousState?: Partial<MemoryRecord>; newState?: Partial<MemoryRecord>; details?: Record<string, unknown> }
  ): LedgerEntry {
    const entry: LedgerEntry = { seq: ++this.seq, memoryId, action, actor, timestamp: this.clock(), ...extra };
    this.entries.push(entry);
    return entry;
  }

  history(memoryId: string): LedgerEntry[] {
    return this.entries.filter((e) => e.memoryId === memoryId);
  }

  all(): readonly LedgerEntry[] {
    return this.entries;
  }

  stats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries) out[e.action] = (out[e.action] ?? 0) + 1;
    return out;
  }
}

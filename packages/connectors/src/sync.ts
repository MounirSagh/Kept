// Runs a provider's streams a page at a time. After every page the caller persists the
// items and the new state, so a sync can be interrupted (deploy, crash, time budget)
// and resume exactly where it stopped.

import type { ApiClient } from "./http.js";
import type { ProviderDefinition, SourceItemInput, SyncContext } from "./types.js";

/** Per-stream cursors, stored as connections.sync_state. */
export type SyncState = Record<string, { cursor: unknown }>;

export interface SyncRunOptions {
  /** Upper bound on pages per run, so one huge backfill can't monopolize a worker. */
  maxSteps?: number;
  onPage(page: { stream: string; items: SourceItemInput[]; state: SyncState }): Promise<void>;
}

export interface SyncRunResult {
  state: SyncState;
  /** False when the step budget ran out before every stream caught up; schedule another run. */
  complete: boolean;
  items: number;
}

export async function runSync(
  def: ProviderDefinition,
  client: ApiClient,
  initial: SyncState,
  ctx: SyncContext,
  opts: SyncRunOptions,
): Promise<SyncRunResult> {
  let state: SyncState = { ...initial };
  let steps = 0;
  let items = 0;
  const maxSteps = opts.maxSteps ?? 200;

  for (const stream of def.streams) {
    let more = true;
    while (more) {
      if (steps >= maxSteps) return { state, complete: false, items };
      const step = await stream.step(client, state[stream.name]?.cursor, ctx);
      steps++;
      items += step.items.length;
      state = { ...state, [stream.name]: { cursor: step.cursor } };
      await opts.onPage({ stream: stream.name, items: step.items, state });
      more = step.more;
    }
  }
  return { state, complete: true, items };
}

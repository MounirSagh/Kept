// The canonical 10-step ingest pipeline (Meterless World Model spec, section 4.1).
// Idempotency contract: re-running the same batch produces the same world state
// and an empty diff. Every derived timestamp comes from the OBSERVATION, never
// the wall clock.

import { jaccard } from "./resolve.js";
import { canonicalJson, sha256Hex } from "./stable-ids.js";
import type { EventStore } from "./store.js";
import type { IngestObservation, IngestReport, ObservationRecord, ScoreSnapshot, StoryAggregate } from "./types.js";

const CLUSTER_JACCARD = 0.5;
const HOUR_MS = 60 * 60 * 1000;
const STALE_AFTER_DAYS = 30;

export function runIngestPipeline(
  store: EventStore,
  observations: IngestObservation[],
  upsert: (obs: IngestObservation) => { entityId: string; entityIds: string[] },
  timer: () => number,
): IngestReport {
  const runId = `run_${sha256Hex(canonicalJson(observations.map((o) => o.externalId))).slice(0, 12)}`;
  const timings: IngestReport["stepTimingsMs"] = [];
  const before = canonicalJson(worldStateShape(store));
  const eventsBefore = store.events.length;

  const time = <T>(step: number, name: string, fn: () => T): T => {
    const t0 = timer();
    const out = fn();
    timings.push({ step, name, ms: timer() - t0 });
    return out;
  };

  // 1. Reconcile: recompute staleness from observation times.
  time(1, "reconcile-stale", () => {
    const latest = observations.reduce((max, o) => (o.at > max ? o.at : max), "");
    for (const rec of store.observations.values()) {
      rec.stale = latest !== "" && rec.at < isoDaysBefore(latest, STALE_AFTER_DAYS);
    }
  });

  // 2. Classify: unchanged observations (same checksum) are skipped.
  const fresh: { obs: IngestObservation; checksum: string }[] = [];
  const skipped: IngestObservation[] = [];
  time(2, "cluster-classify", () => {
    for (const obs of observations) {
      const checksum = sha256Hex(canonicalJson({ externalId: obs.externalId, title: obs.title, text: obs.text ?? "", at: obs.at }));
      const existing = store.observations.get(obs.externalId);
      if (existing && existing.checksum === checksum) skipped.push(obs);
      else fresh.push({ obs, checksum });
    }
  });

  // 3. Persist primary aggregates: observation entities plus the entities they mention.
  time(3, "persist-aggregates", () => {
    for (const { obs, checksum } of fresh) {
      const { entityId, entityIds } = upsert(obs);
      store.observations.set(obs.externalId, {
        id: `obs_${sha256Hex(obs.externalId).slice(0, 12)}`,
        externalId: obs.externalId,
        entityId,
        checksum,
        at: obs.at,
        entityIds,
        stale: false,
      });
    }
  });

  // Group all observations into stories by entity overlap.
  const clusters: ObservationRecord[][] = [];
  time(2, "story-grouping", () => {
    const all = [...store.observations.values()].sort((a, b) => a.externalId.localeCompare(b.externalId));
    const used = new Set<string>();
    for (const seed of all) {
      if (used.has(seed.externalId)) continue;
      const group = [seed];
      used.add(seed.externalId);
      for (const other of all) {
        if (used.has(other.externalId)) continue;
        if (jaccard(seed.entityIds ?? [], other.entityIds ?? []) >= CLUSTER_JACCARD) {
          group.push(other);
          used.add(other.externalId);
        }
      }
      clusters.push(group);
    }
  });

  // 4. Score: velocity = mentions per hour over bucketed windows.
  // 5. Infer milestones. 6. Edges are written by the upsert callback.
  // 7. Views project the fold on read. 8. Patch source items with their story.
  time(4, "score-measure", () => {
    for (const group of clusters) {
      const memberIds = group.map((g) => g.externalId).sort();
      const storyId = `story_${sha256Hex(canonicalJson(memberIds)).slice(0, 12)}`;
      const times = group.map((g) => Date.parse(g.at)).sort((a, b) => a - b);
      const firstAt = times[0]!;
      const lastAt = times[times.length - 1]!;
      const velocity = (windowMs: number) => times.filter((t) => t > lastAt - windowMs).length / (windowMs / HOUR_MS);
      const prevHour = times.filter((t) => t > lastAt - 2 * HOUR_MS && t <= lastAt - HOUR_MS).length;
      const currHour = times.filter((t) => t > lastAt - HOUR_MS).length;
      const score: ScoreSnapshot = {
        storyId,
        at: new Date(lastAt).toISOString(),
        velocity1h: velocity(HOUR_MS),
        velocity24h: velocity(24 * HOUR_MS),
        velocity7d: velocity(7 * 24 * HOUR_MS),
        trendDirection: Math.sign(currHour - prevHour) as -1 | 0 | 1,
      };
      store.scores = store.scores.filter((s) => s.storyId !== storyId);
      store.scores.push(score);

      const entityIds = [...new Set(group.flatMap((g) => g.entityIds ?? []))].sort();
      const story: StoryAggregate = {
        id: storyId,
        title: group[0]!.externalId,
        memberIds,
        entityNames: entityIds,
        entityIds,
        sources: [],
        firstAt: new Date(firstAt).toISOString(),
        lastAt: new Date(lastAt).toISOString(),
        milestones: times.length >= 2 ? [{ kind: "multi-source", at: new Date(times[1]!).toISOString() }] : [],
      };
      store.stories.set(storyId, story);
      for (const rec of group) rec.storyId = storyId;
    }
  });

  // 9. Rebuild aggregates.
  time(9, "rebuild-aggregates", () => store.rebuildAggregates());

  const after = canonicalJson(worldStateShape(store));
  const report: IngestReport = {
    runId,
    processed: fresh.length,
    skippedUnchanged: skipped.length,
    clusters: clusters.length,
    eventsAppended: store.events.length - eventsBefore,
    changed: before !== after,
    stepTimingsMs: timings,
  };
  store.logAudit("ingest", "pipeline", `run ${runId}: ${fresh.length} processed, ${skipped.length} skipped`, undefined, runId, observations[0]?.at);
  return report;
}

/** The idempotency diff surface: everything derived from observations, in canonical order. */
export function worldStateShape(store: EventStore): unknown {
  const byId = <T extends { id: string }>(m: Map<string, T>) => [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    entities: byId(store.state.entities),
    contexts: byId(store.state.contexts),
    relationships: byId(store.state.relationships),
    facts: byId(store.state.facts),
    observations: [...store.observations.values()].sort((a, b) => a.externalId.localeCompare(b.externalId)),
    stories: byId(store.stories),
  };
}

function isoDaysBefore(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * 24 * 60 * 60 * 1000).toISOString();
}

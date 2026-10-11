// Event-sourced canonical store. State is a fold over an append-only event log;
// views are projections of the fold. Every mutation writes an audit entry.
//
// Unlike the Meterless reference, everything in the canonical state is derivable
// from the log plus the side stores: fact conflicts are resolved inside the fold
// and entity aggregates are rebuilt after any replay. That is what lets a world
// be reloaded from Postgres (or caught up with another process's writes) and
// come out identical to the world that was written.

import type {
  AuditEntry, ConflictPolicy, Context, Entity, EventKind, Fact, MergeProposal, ObservationRecord,
  Relationship, ScoreSnapshot, SideState, StoryAggregate, WorldEvent, WorldWrite,
} from "./types.js";

export interface FoldedState {
  entities: Map<string, Entity>;
  contexts: Map<string, Context>;
  relationships: Map<string, Relationship>;
  facts: Map<string, Fact>;
  /** aliasId -> primaryId */
  aliases: Map<string, string>;
}

export interface FoldOptions {
  conflictPolicy: ConflictPolicy;
  sourcePriority?: string[];
}

function emptyState(): FoldedState {
  return { entities: new Map(), contexts: new Map(), relationships: new Map(), facts: new Map(), aliases: new Map() };
}

export class EventStore {
  events: WorldEvent[] = [];
  audit: AuditEntry[] = [];
  observations = new Map<string, ObservationRecord>();
  stories = new Map<string, StoryAggregate>();
  scores: ScoreSnapshot[] = [];
  mergeQueue: MergeProposal[] = [];
  state: FoldedState = emptyState();

  private eventSeq = 0;
  private auditSeq = 0;
  private pendingEvents: WorldEvent[] = [];
  private pendingAudit: AuditEntry[] = [];
  private subscribers = new Set<(e: WorldEvent) => void>();

  constructor(private readonly foldOptions: FoldOptions) {}

  get lastEventSeq() {
    return this.eventSeq;
  }

  get lastAuditSeq() {
    return this.auditSeq;
  }

  append(kind: EventKind, payload: WorldEvent["payload"], at: string): WorldEvent {
    const seq = this.eventSeq + 1;
    const event: WorldEvent = { id: `evt_${seq}`, seq, kind, payload, schemaVersion: 1, at };
    this.apply(event);
    this.pendingEvents.push(event);
    for (const fn of this.subscribers) fn(event);
    return event;
  }

  logAudit(kind: string, actor: string, summary: string, eventId?: string, runId?: string, at?: string): void {
    const entry: AuditEntry = {
      seq: ++this.auditSeq,
      at: at ?? new Date(0).toISOString(),
      kind,
      actor,
      summary,
      eventId,
      runId,
    };
    this.audit.push(entry);
    this.pendingAudit.push(entry);
  }

  /** Applies events and audit entries written elsewhere (another process, or a reload). */
  applyRemote(events: WorldEvent[], audit: AuditEntry[]): void {
    for (const event of events) this.apply(event);
    for (const entry of audit) {
      this.audit.push(entry);
      this.auditSeq = Math.max(this.auditSeq, entry.seq);
    }
  }

  /** Changes made since the last call, ready to persist. */
  takePending(): WorldWrite {
    const write = { events: this.pendingEvents, audit: this.pendingAudit, side: this.sideSnapshot() };
    this.pendingEvents = [];
    this.pendingAudit = [];
    return write;
  }

  sideSnapshot(): SideState {
    return {
      observations: [...this.observations.entries()],
      stories: [...this.stories.entries()],
      scores: this.scores,
      mergeQueue: this.mergeQueue,
    };
  }

  loadSide(side: SideState): void {
    this.observations = new Map(side.observations);
    this.stories = new Map(side.stories);
    this.scores = side.scores;
    this.mergeQueue = side.mergeQueue;
  }

  reset(): void {
    this.events = [];
    this.audit = [];
    this.observations = new Map();
    this.stories = new Map();
    this.scores = [];
    this.mergeQueue = [];
    this.state = emptyState();
    this.eventSeq = 0;
    this.auditSeq = 0;
    this.pendingEvents = [];
    this.pendingAudit = [];
  }

  /** Pipeline step 9: entity rollups derived from observations. Recomputed, never incremented. */
  rebuildAggregates(): void {
    const mentionsByEntity = new Map<string, ObservationRecord[]>();
    for (const obs of this.observations.values()) {
      for (const id of obs.entityIds ?? []) {
        const list = mentionsByEntity.get(id) ?? [];
        list.push(obs);
        mentionsByEntity.set(id, list);
      }
    }
    for (const entity of this.state.entities.values()) {
      const mentions = mentionsByEntity.get(entity.id);
      if (!mentions) continue;
      const times = mentions.map((m) => m.at).sort();
      entity.aggregates = {
        mentionCount: mentions.length,
        firstSeenAt: times[0],
        lastSeenAt: times[times.length - 1],
        linkedStoryIds: [...new Set(mentions.map((m) => m.storyId).filter((s): s is string => !!s))].sort(),
      };
    }
  }

  /** Replays the log up to and including `at`: the point-in-time view. */
  foldUntil(at: string): FoldedState {
    const scratch = new EventStore(this.foldOptions);
    for (const e of this.events) if (e.at <= at) scratch.fold(e);
    return scratch.state;
  }

  resolveAlias(id: string): string {
    return resolveIn(this.state.aliases, id);
  }

  subscribe(fn: (e: WorldEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private apply(event: WorldEvent): void {
    this.eventSeq = Math.max(this.eventSeq, event.seq);
    this.events.push(event);
    this.fold(event);
  }

  private fold(event: WorldEvent): void {
    switch (event.kind) {
      case "upsertEntity": {
        const e = event.payload as Entity;
        const existing = this.state.entities.get(e.id);
        if (existing) {
          existing.attrs = { ...existing.attrs, ...e.attrs };
          existing.updatedAt = e.updatedAt;
          existing.source = e.source;
          if (e.name && !existing.aliases.includes(e.name)) existing.aliases.push(e.name);
          if (e.name) existing.name = e.name;
        } else {
          this.state.entities.set(e.id, structuredClone(e));
        }
        break;
      }
      case "upsertContext": {
        const c = event.payload as Context;
        const existing = this.state.contexts.get(c.id);
        if (existing) {
          existing.attrs = { ...existing.attrs, ...c.attrs };
          existing.updatedAt = c.updatedAt;
        } else {
          this.state.contexts.set(c.id, structuredClone(c));
        }
        break;
      }
      case "relate": {
        const r = event.payload as Relationship;
        // A new open edge with the same (from, type, context) and a different target
        // CLOSES the previous open edge. Nothing is deleted.
        for (const other of this.state.relationships.values()) {
          if (
            other.from === r.from &&
            other.type === r.type &&
            (other.context ?? "") === (r.context ?? "") &&
            other.to !== r.to &&
            !other.validTo &&
            !other.supersededBy
          ) {
            other.validTo = r.validFrom ?? r.createdAt;
            other.supersededBy = r.id;
          }
        }
        if (!this.state.relationships.has(r.id)) this.state.relationships.set(r.id, structuredClone(r));
        break;
      }
      case "assertFact":
        this.foldFact(event.payload as Fact);
        break;
      case "alias": {
        const a = event.payload as { aliasId: string; primaryId: string };
        this.state.aliases.set(a.aliasId, a.primaryId);
        break;
      }
      case "snapshot":
      case "tombstone":
      case "view-rebuild":
        break;
    }
  }

  /** Conflict policy decides which fact's value lands on the entity; losers are marked superseded. */
  private foldFact(incoming: Fact): void {
    if (this.state.facts.has(incoming.id)) return;
    const rivals = [...this.state.facts.values()].filter(
      (f) => f.about === incoming.about && f.predicate === incoming.predicate && !f.supersededBy,
    );
    const fact = structuredClone(incoming);
    this.state.facts.set(fact.id, fact);

    const { conflictPolicy, sourcePriority } = this.foldOptions;
    let winner = fact;
    for (const rival of rivals) {
      const rivalWins =
        conflictPolicy === "highest-confidence-wins"
          ? rival.confidence > winner.confidence
          : conflictPolicy === "source-priority"
            ? priorityOf(rival.source.kind, sourcePriority) < priorityOf(winner.source.kind, sourcePriority)
            : rival.assertedAt > winner.assertedAt; // most-recent-wins
      if (rivalWins) winner = rival;
    }
    for (const f of [fact, ...rivals]) if (f.id !== winner.id) f.supersededBy = winner.id;

    const entity = this.state.entities.get(fact.about);
    if (entity) {
      entity.attrs[fact.predicate] = winner.value;
      entity.updatedAt = fact.assertedAt;
    }
  }
}

export function resolveIn(aliases: Map<string, string>, id: string): string {
  let cur = id;
  const seen = new Set<string>();
  while (aliases.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = aliases.get(cur)!;
  }
  return cur;
}

function priorityOf(kind: string, ranking?: string[]): number {
  const idx = (ranking ?? []).indexOf(kind);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

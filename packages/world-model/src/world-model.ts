// World Model facade. Writes go through a FIFO queue per instance, so concurrent
// writes in one process serialize. With durable storage, each write also runs in a
// transaction holding the namespace lock: it first replays what other processes
// wrote, then appends its own events, so every writer extends the same log.

import { runIngestPipeline, worldStateShape } from "./ingest.js";
import { decide, nameSimilarity } from "./resolve.js";
import {
  canonicalJson, contextIdFromAttrs, entityIdFromName, externalId, factId, relationshipId,
} from "./stable-ids.js";
import { EventStore, resolveIn } from "./store.js";
import type {
  AuditEntry, Context, Entity, Fact, IngestObservation, IngestReport, MergeProposal, Provenance,
  Relationship, StoredProvenance, WorldEvent, WorldModelOptions, WorldStorage,
} from "./types.js";

type ExternalKey = { system: string; id: string };

export interface UpsertEntityInput {
  type: string;
  externalKey?: ExternalKey;
  name?: string;
  attrs?: Record<string, unknown>;
  source: Provenance;
  state?: Entity["state"];
}

export interface UpsertContextInput {
  type: string;
  externalKey?: ExternalKey;
  attrs?: Record<string, unknown>;
  parent?: string;
  source: Provenance;
}

export interface RelateInput {
  from: string;
  type: string;
  to: string;
  context?: string;
  attrs?: Record<string, unknown>;
  validFrom?: string;
  validTo?: string;
  source: Provenance;
}

export interface AssertFactInput {
  about: string;
  predicate: string;
  value: unknown;
  confidence?: number;
  context?: string;
  source: Provenance;
}

interface CustomView<S> {
  events: string[];
  initialState: S;
  reducer: (state: S, event: WorldEvent) => S;
}

export class WorldModel {
  private store: EventStore;
  private storage: WorldStorage | null;
  private clock: () => Date;
  private writeLock: Promise<unknown> = Promise.resolve();
  /** Set when a durable write failed after touching memory; the next operation reloads from storage. */
  private dirty = false;
  private customViews = new Map<string, CustomView<unknown>>();

  /** In-memory worlds can be constructed directly. Durable worlds should use `WorldModel.open`. */
  constructor(private readonly opts: WorldModelOptions) {
    if (!opts.namespace) throw new Error("WorldModel: namespace is required");
    this.clock = opts.clock ?? (() => new Date());
    this.storage = opts.storage && opts.storage !== "memory" ? opts.storage : null;
    this.store = new EventStore({ conflictPolicy: opts.conflictPolicy ?? "most-recent-wins", sourcePriority: opts.sourcePriority });
  }

  /** Opens a world and loads its log from storage. */
  static async open(opts: WorldModelOptions): Promise<WorldModel> {
    const world = new WorldModel(opts);
    await world.refresh();
    return world;
  }

  /** Catches up with writes made by other processes. Reads are served from memory, so call this before reading a long-lived instance. */
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.storage) return;
      await this.storage.transaction(this.opts.namespace, (tx) => this.catchUp(tx));
    });
  }

  // ---------------------------------------------------------------- writes

  private enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn);
    this.writeLock = next.catch(() => undefined);
    return next;
  }

  private async catchUp(tx: Parameters<Parameters<WorldStorage["transaction"]>[1]>[0]): Promise<void> {
    if (this.dirty) {
      this.store.reset();
      this.dirty = false;
    }
    const { events, audit, side } = await tx.readSince(this.store.lastEventSeq, this.store.lastAuditSeq);
    if (events.length === 0 && audit.length === 0 && !side) return;
    this.store.applyRemote(events, audit);
    if (side) this.store.loadSide(side);
    this.store.rebuildAggregates();
  }

  /** Runs a synchronous mutation and persists what it appended. */
  private mutate<T>(fn: () => T): Promise<T> {
    return this.enqueue(async () => {
      if (!this.storage) {
        const result = fn();
        this.store.takePending();
        return result;
      }
      try {
        return await this.storage.transaction(this.opts.namespace, async (tx) => {
          await this.catchUp(tx);
          const result = fn();
          await tx.write(this.store.takePending());
          return result;
        });
      } catch (err) {
        // Memory may hold changes the rolled-back transaction never stored.
        this.dirty = true;
        throw err;
      }
    });
  }

  private normalizeProvenance(source: Provenance | undefined): StoredProvenance {
    if (!source || !source.kind || source.at === undefined) {
      throw new Error("World Model: every write carries provenance (kind + at). No provenance, no write.");
    }
    const at = source.at instanceof Date ? source.at.toISOString() : source.at;
    return { ...source, at };
  }

  upsertEntity(input: UpsertEntityInput): Promise<Entity> {
    return this.mutate(() => {
      const source = this.normalizeProvenance(input.source);
      const name = input.name ?? (input.attrs?.name as string | undefined);
      const id = input.externalKey
        ? externalId(input.type, input.externalKey.system, input.externalKey.id)
        : entityIdFromName(input.type, mustName(name));

      // Name-keyed near-duplicates of the same type either auto-merge (alias) or queue for review.
      if (!input.externalKey && name) {
        const autoMergeAt = this.opts.resolver?.autoMergeAt ?? 0.85;
        const reviewLower = this.opts.resolver?.reviewBand?.[0] ?? 0.82;
        for (const other of this.store.state.entities.values()) {
          if (other.type !== input.type || other.id === id || !other.name) continue;
          const similarity = nameSimilarity(name, other.name);
          const decision = decide(similarity, autoMergeAt, reviewLower);
          if (decision === "auto-merge") {
            this.store.append(
              "alias",
              { aliasId: id, primaryId: other.id, mergedAt: source.at, mergedBy: "resolver", reason: `similarity ${similarity.toFixed(3)}` },
              source.at,
            );
            this.store.logAudit("auto-merge", "resolver", `${name} -> ${other.name} (${similarity.toFixed(3)})`, undefined, undefined, source.at);
            return this.foldEntityUpsert(other.id, input, source, name);
          }
          if (decision === "review") {
            const alreadyQueued = this.store.mergeQueue.some(
              (p) => (p.leftId === id && p.rightId === other.id) || (p.leftId === other.id && p.rightId === id),
            );
            if (!alreadyQueued) {
              const proposal: MergeProposal = {
                id: `merge_${this.store.mergeQueue.length + 1}`,
                leftId: id,
                rightId: other.id,
                leftName: name,
                rightName: other.name,
                similarity,
                reason: `name similarity in review band [${reviewLower}, ${autoMergeAt})`,
                status: "pending",
                proposedAt: source.at,
              };
              this.store.mergeQueue.push(proposal);
              this.store.logAudit("merge-proposed", "resolver", `${name} ~ ${other.name} (${similarity.toFixed(3)}) queued`, undefined, undefined, source.at);
            }
          }
        }
      }
      return this.foldEntityUpsert(id, input, source, name);
    });
  }

  private foldEntityUpsert(id: string, input: UpsertEntityInput, source: StoredProvenance, name?: string): Entity {
    const resolved = this.store.resolveAlias(id);
    const entity: Entity = {
      type: input.type,
      id: resolved,
      attrs: { ...(input.attrs ?? {}) },
      schemaVersion: 1,
      source,
      createdAt: source.at,
      updatedAt: source.at,
      name,
      aliases: name ? [name] : [],
      state: input.state ?? "active",
    };
    const event = this.store.append("upsertEntity", entity, source.at);
    this.store.logAudit("upsertEntity", source.by ?? "system", `${resolved} (${input.type})`, event.id, source.runId, source.at);
    return this.store.state.entities.get(resolved)!;
  }

  upsertContext(input: UpsertContextInput): Promise<Context> {
    return this.mutate(() => {
      const source = this.normalizeProvenance(input.source);
      const id = input.externalKey
        ? externalId(input.type, input.externalKey.system, input.externalKey.id)
        : contextIdFromAttrs(input.type, input.attrs ?? {}, input.parent);
      const context: Context = {
        type: input.type,
        id,
        attrs: { ...(input.attrs ?? {}) },
        parent: input.parent,
        schemaVersion: 1,
        source,
        createdAt: source.at,
        updatedAt: source.at,
      };
      const event = this.store.append("upsertContext", context, source.at);
      this.store.logAudit("upsertContext", source.by ?? "system", `${id} (${input.type})`, event.id, source.runId, source.at);
      return this.store.state.contexts.get(id)!;
    });
  }

  relate(input: RelateInput): Promise<Relationship> {
    return this.mutate(() => {
      const source = this.normalizeProvenance(input.source);
      const from = this.store.resolveAlias(input.from);
      const to = this.store.resolveAlias(input.to);
      const id = relationshipId(from, input.type, to, input.context, input.validFrom);
      const existing = this.store.state.relationships.get(id);
      if (existing) return existing; // content-addressed no-op
      const rel: Relationship = {
        id,
        from,
        type: input.type,
        to,
        context: input.context,
        attrs: input.attrs,
        validFrom: input.validFrom ?? source.at,
        validTo: input.validTo,
        schemaVersion: 1,
        source,
        createdAt: source.at,
      };
      const event = this.store.append("relate", rel, source.at);
      this.store.logAudit("relate", source.by ?? "system", `${from} -[${input.type}]-> ${to}`, event.id, source.runId, source.at);
      return this.store.state.relationships.get(id)!;
    });
  }

  assertFact(input: AssertFactInput): Promise<Fact> {
    return this.mutate(() => {
      const source = this.normalizeProvenance(input.source);
      const about = this.store.resolveAlias(input.about);
      const id = factId(about, input.predicate, input.value, source.at, source.kind, source.url);
      const existing = this.store.state.facts.get(id);
      if (existing) return existing;

      // The subject must exist before the fact folds, so the winning value can land on it.
      if (!this.store.state.entities.has(about)) {
        const inferredType = about.includes(":") ? about.split(":")[0]! : "entity";
        const stub: Entity = {
          type: inferredType, id: about, attrs: {}, schemaVersion: 1, source,
          createdAt: source.at, updatedAt: source.at, aliases: [], state: "emerging",
        };
        this.store.append("upsertEntity", stub, source.at);
      }

      const fact: Fact = {
        id,
        about,
        predicate: input.predicate,
        value: input.value,
        confidence: input.confidence ?? 0.5,
        context: input.context,
        source,
        assertedAt: source.at,
      };
      const event = this.store.append("assertFact", fact, source.at);
      const policy = this.opts.conflictPolicy ?? "most-recent-wins";
      const value = this.store.state.entities.get(about)?.attrs[input.predicate];
      this.store.logAudit("assertFact", source.by ?? "system", `${about}.${input.predicate} = ${JSON.stringify(value)} (${policy})`, event.id, source.runId, source.at);
      return this.store.state.facts.get(id)!;
    });
  }

  // ---------------------------------------------------------------- ingest

  ingest(observations: IngestObservation[]): Promise<IngestReport> {
    return this.mutate(() =>
      runIngestPipeline(
        this.store,
        observations,
        (obs) => {
          const source = this.normalizeProvenance({ ...obs.source, at: obs.at });
          const type = obs.type ?? "item";
          const entity = this.foldEntityUpsert(
            externalId(type, "ingest", obs.externalId),
            { type, externalKey: { system: "ingest", id: obs.externalId }, attrs: { title: obs.title, text: obs.text }, source },
            source,
            obs.title,
          );
          const entityIds: string[] = [];
          for (const mention of obs.entities ?? []) {
            const mid = entityIdFromName(mention.type, mention.name);
            this.foldEntityUpsert(mid, { type: mention.type, name: mention.name, source }, source, mention.name);
            const target = this.store.resolveAlias(mid);
            entityIds.push(target);
            const rid = relationshipId(entity.id, "mentions", target);
            if (!this.store.state.relationships.has(rid)) {
              const rel: Relationship = {
                id: rid, from: entity.id, type: "mentions", to: target,
                validFrom: source.at, schemaVersion: 1, source, createdAt: source.at,
              };
              this.store.append("relate", rel, source.at);
            }
          }
          return { entityId: entity.id, entityIds: entityIds.sort() };
        },
        () => performance.now(),
      ),
    );
  }

  // ---------------------------------------------------------------- reads

  view(name: "graph"): GraphView;
  view(name: "facts"): FactsView;
  view(name: "snapshot"): SnapshotView;
  view(name: "timeline"): TimelineView;
  view(name: string): { get(): unknown };
  view(name: string): unknown {
    if (name === "graph") return new GraphView(this.store);
    if (name === "facts") return new FactsView(this.store);
    if (name === "snapshot") return new SnapshotView(this.store);
    if (name === "timeline") return new TimelineView(this.store);
    const spec = this.customViews.get(name);
    if (!spec) throw new Error(`World Model: unknown view "${name}"`);
    return {
      get: () => {
        let state = structuredClone(spec.initialState);
        for (const e of this.store.events) if (spec.events.includes(e.kind)) state = spec.reducer(state, e);
        return state;
      },
    };
  }

  registerView<S>(name: string, spec: CustomView<S>): void {
    this.customViews.set(name, spec as CustomView<unknown>);
  }

  // ------------------------------------------------------------- operator

  mergeQueue(): readonly MergeProposal[] {
    return this.store.mergeQueue;
  }

  approveMerge(proposalId: string, by: string): Promise<void> {
    return this.mutate(() => {
      const p = this.pendingProposal(proposalId);
      const at = this.clock().toISOString();
      p.status = "approved";
      p.resolvedAt = at;
      p.resolvedBy = by;
      this.store.append("alias", { aliasId: p.leftId, primaryId: p.rightId, mergedAt: at, mergedBy: by, reason: p.reason }, at);
      this.store.logAudit("merge-approved", by, `${p.leftName} -> ${p.rightName}`, undefined, undefined, at);
    });
  }

  rejectMerge(proposalId: string, by: string): Promise<void> {
    return this.mutate(() => {
      const p = this.pendingProposal(proposalId);
      const at = this.clock().toISOString();
      p.status = "rejected";
      p.resolvedAt = at;
      p.resolvedBy = by;
      this.store.logAudit("merge-rejected", by, `${p.leftName} stays separate from ${p.rightName}`, undefined, undefined, at);
    });
  }

  private pendingProposal(proposalId: string): MergeProposal {
    const p = this.store.mergeQueue.find((m) => m.id === proposalId && m.status === "pending");
    if (!p) throw new Error(`World Model: no pending merge proposal ${proposalId}`);
    return p;
  }

  audit(): readonly AuditEntry[] {
    return this.store.audit;
  }

  events(): readonly WorldEvent[] {
    return this.store.events;
  }

  stateShape(): unknown {
    return worldStateShape(this.store);
  }

  stateShapeCanonical(): string {
    return canonicalJson(worldStateShape(this.store));
  }

  subscribeEvents(fn: (e: WorldEvent) => void): () => void {
    return this.store.subscribe(fn);
  }
}

// ------------------------------------------------------------------ views

export class GraphView {
  constructor(private store: EventStore) {}

  entity(id: string): Entity | undefined {
    return this.store.state.entities.get(this.store.resolveAlias(id));
  }

  neighborsOf(id: string, opts?: { via?: string; inContext?: string; at?: string }): Entity[] {
    const rid = this.store.resolveAlias(id);
    const out: Entity[] = [];
    for (const rel of this.store.state.relationships.values()) {
      if (opts?.via && rel.type !== opts.via) continue;
      if (opts?.inContext && rel.context !== opts.inContext) continue;
      if (opts?.at ? !validAt(rel, opts.at) : rel.validTo) continue; // closed edges are excluded from "now"
      const other = rel.from === rid ? rel.to : rel.to === rid ? rel.from : undefined;
      if (!other) continue;
      const entity = this.store.state.entities.get(other);
      if (entity) out.push(entity);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  incoming(id: string, opts?: { via?: string }): Entity[] {
    const rid = this.store.resolveAlias(id);
    const out: Entity[] = [];
    for (const rel of this.store.state.relationships.values()) {
      if (rel.to !== rid || rel.validTo) continue;
      if (opts?.via && rel.type !== opts.via) continue;
      const entity = this.store.state.entities.get(rel.from);
      if (entity) out.push(entity);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  entitiesInContext(contextId: string, opts?: { type?: string }): Entity[] {
    const seen = new Map<string, Entity>();
    for (const rel of this.store.state.relationships.values()) {
      if (rel.context !== contextId) continue;
      for (const id of [rel.from, rel.to]) {
        const entity = this.store.state.entities.get(id);
        if (entity && (!opts?.type || entity.type === opts.type)) seen.set(entity.id, entity);
      }
    }
    return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  traverse(startId: string, opts: { via: string; direction: "ancestors" | "descendants"; maxDepth?: number }): Entity[] {
    const maxDepth = opts.maxDepth ?? 5;
    const out: Entity[] = [];
    const visited = new Set<string>();
    let frontier = [this.store.resolveAlias(startId)];
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const rel of this.store.state.relationships.values()) {
          if (rel.type !== opts.via || rel.validTo) continue;
          const target =
            opts.direction === "ancestors" ? (rel.from === id ? rel.to : undefined) : rel.to === id ? rel.from : undefined;
          if (target && !visited.has(target)) {
            visited.add(target);
            const entity = this.store.state.entities.get(target);
            if (entity) out.push(entity);
            next.push(target);
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  query(opts: { type?: string; where?: (e: Entity) => boolean }): Entity[] {
    return [...this.store.state.entities.values()]
      .filter((e) => (!opts.type || e.type === opts.type) && (!opts.where || opts.where(e)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

export class FactsView {
  constructor(private store: EventStore) {}
  about(id: string): Fact[] {
    const rid = this.store.resolveAlias(id);
    return [...this.store.state.facts.values()]
      .filter((f) => f.about === rid)
      .sort((a, b) => a.assertedAt.localeCompare(b.assertedAt));
  }
}

export class SnapshotView {
  constructor(private store: EventStore) {}
  /** Entity state as of a timestamp: replay events with at <= timestamp. */
  entityAt(id: string, at: string): Entity | undefined {
    const iso = at.length === 10 ? `${at}T23:59:59.999Z` : at;
    const state = this.store.foldUntil(iso);
    return state.entities.get(resolveIn(state.aliases, id));
  }
}

export class TimelineView {
  constructor(private store: EventStore) {}
  subscribe(fn: (e: WorldEvent) => void): () => void {
    return this.store.subscribe(fn);
  }
  get(): WorldEvent[] {
    return [...this.store.events];
  }
}

function validAt(rel: Relationship, at: string): boolean {
  if (rel.validFrom && at < rel.validFrom) return false;
  if (rel.validTo && at >= rel.validTo) return false;
  return true;
}

function mustName(name: string | undefined): string {
  if (!name) throw new Error("World Model: name-keyed entities need a name (or provide an externalKey)");
  return name;
}

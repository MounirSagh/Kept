// Postgres storage for the World Model, one namespace per org (namespace = org id).
// Each transaction takes a per-org advisory lock, so the API and worker processes
// append to a single, gap-free log.

import type { Prisma, PrismaClient } from "@kept/db";
import type { AuditEntry, SideState, WorldEvent, WorldStorage, WorldTransaction } from "./types.js";

const EMPTY_SIDE: SideState = { observations: [], stories: [], scores: [], mergeQueue: [] };

export interface PrismaStorageOptions {
  /** Upper bound for one write (an ingest batch runs inside it). */
  timeoutMs?: number;
}

export function prismaWorldStorage(prisma: PrismaClient, opts: PrismaStorageOptions = {}): WorldStorage {
  return {
    transaction<T>(orgId: string, fn: (tx: WorldTransaction) => Promise<T>): Promise<T> {
      return prisma.$transaction(
        async (db) => {
          // Held until commit or rollback; serializes writers for this org only.
          await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`world:${orgId}`}, 0))`;
          return fn(prismaTransaction(db, orgId));
        },
        { timeout: opts.timeoutMs ?? 60_000, maxWait: 10_000 },
      );
    },
  };
}

function prismaTransaction(db: Prisma.TransactionClient, orgId: string): WorldTransaction {
  return {
    async readSince(eventSeq, auditSeq) {
      const [events, audit, state] = await Promise.all([
        db.worldEvent.findMany({ where: { orgId, seq: { gt: eventSeq } }, orderBy: { seq: "asc" } }),
        db.worldAuditEntry.findMany({ where: { orgId, seq: { gt: auditSeq } }, orderBy: { seq: "asc" } }),
        db.worldState.findUnique({ where: { orgId } }),
      ]);
      return {
        events: events.map(
          (e): WorldEvent => ({
            id: e.eventId,
            seq: e.seq,
            kind: e.kind as WorldEvent["kind"],
            payload: e.payload as unknown as WorldEvent["payload"],
            schemaVersion: e.schemaVersion,
            at: e.at,
          }),
        ),
        audit: audit.map(
          (a): AuditEntry => ({
            seq: a.seq,
            at: a.at,
            kind: a.kind,
            actor: a.actor,
            summary: a.summary,
            eventId: a.eventId ?? undefined,
            runId: a.runId ?? undefined,
          }),
        ),
        side: state ? { ...EMPTY_SIDE, ...(state.side as unknown as Partial<SideState>) } : null,
      };
    },

    async write({ events, audit, side }) {
      if (events.length > 0) {
        await db.worldEvent.createMany({
          data: events.map((e) => ({
            orgId,
            seq: e.seq,
            eventId: e.id,
            kind: e.kind,
            payload: toJson(e.payload),
            schemaVersion: e.schemaVersion,
            at: e.at,
          })),
        });
      }
      if (audit.length > 0) {
        await db.worldAuditEntry.createMany({
          data: audit.map((a) => ({
            orgId,
            seq: a.seq,
            at: a.at,
            kind: a.kind,
            actor: a.actor,
            summary: a.summary,
            eventId: a.eventId ?? null,
            runId: a.runId ?? null,
          })),
        });
      }
      await db.worldState.upsert({
        where: { orgId },
        create: { orgId, side: toJson(side) },
        update: { side: toJson(side) },
      });
    },
  };
}

/** JSON columns drop undefined members, which is also what canonicalJson does. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

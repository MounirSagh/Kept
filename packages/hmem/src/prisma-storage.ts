// Postgres storage for H-MEM, one namespace per org (namespace = org id).
// Records live in hmem_memories with their embedding in a pgvector column; the
// trust ledger is append-only in hmem_ledger. A per-org advisory lock serializes
// writers across processes.

import { Prisma, type PrismaClient } from "@kept/db";
import type { MemoryBackup, MemorySide, MemorySnapshot, MemoryStorage, MemoryTransaction } from "./durable.js";
import type { LedgerEntry, MemoryRecord } from "./types.js";

const EMPTY_SIDE: MemorySide = {
  recordSeq: 0,
  ledgerSeq: 0,
  conflicts: [],
  conflictSeq: 0,
  proposals: [],
  dreamSeq: 0,
  backupSeq: 0,
};

export function prismaMemoryStorage(prisma: PrismaClient, opts: { timeoutMs?: number } = {}): MemoryStorage {
  return {
    transaction(orgId, fn) {
      return prisma.$transaction(
        async (db) => {
          await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hmem:${orgId}`}, 0))`;
          return fn(prismaTransaction(db, orgId));
        },
        { timeout: opts.timeoutMs ?? 60_000, maxWait: 10_000 },
      );
    },

    async history(orgId, memoryId) {
      const rows = await prisma.memoryLedgerEntry.findMany({ where: { orgId, memoryId }, orderBy: { seq: "asc" } });
      return rows.map(
        (r): LedgerEntry => ({
          seq: r.seq,
          memoryId: r.memoryId,
          action: r.action as LedgerEntry["action"],
          actor: r.actor,
          timestamp: Number(r.timestamp),
          previousState: (r.previousState ?? undefined) as LedgerEntry["previousState"],
          newState: (r.newState ?? undefined) as LedgerEntry["newState"],
          details: (r.details ?? undefined) as LedgerEntry["details"],
        }),
      );
    },
  };
}

function prismaTransaction(db: Prisma.TransactionClient, orgId: string): MemoryTransaction {
  return {
    async version() {
      const state = await db.memoryState.findUnique({ where: { orgId }, select: { version: true } });
      return state?.version ?? 0;
    },

    async load(): Promise<MemorySnapshot> {
      const [state, rows, backups] = await Promise.all([
        db.memoryState.findUnique({ where: { orgId } }),
        db.$queryRaw<{ record: MemoryRecord; embedding: string | null; embedding_model: string | null }[]>`
          SELECT record, embedding::text AS embedding, embedding_model
          FROM hmem_memories WHERE org_id = ${orgId}::uuid ORDER BY id`,
        db.memoryBackup.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
      ]);
      return {
        version: state?.version ?? 0,
        side: state ? { ...EMPTY_SIDE, ...(state.side as unknown as Partial<MemorySide>) } : EMPTY_SIDE,
        records: rows.map((r) => ({
          ...r.record,
          // pgvector's text form is a JSON array literal.
          embedding: r.embedding ? (JSON.parse(r.embedding) as number[]) : [],
          embeddingModel: r.embedding_model ?? r.record.embeddingModel,
        })),
        backups: backups.map((b) => ({ id: b.id, ...(b.snapshot as unknown as Omit<MemoryBackup, "id">) })),
      };
    },

    async write({ version, upsert, remove, ledger, side, backups }) {
      for (const { record, withEmbedding } of upsert) {
        const { embedding, ...rest } = record;
        const json = JSON.stringify(rest);
        if (withEmbedding) {
          const vector = embedding.length > 0 ? `[${embedding.join(",")}]` : null;
          await db.$executeRaw`
            INSERT INTO hmem_memories (org_id, id, record, embedding, embedding_model, updated_at)
            VALUES (${orgId}::uuid, ${record.id}, ${json}::jsonb, ${vector}::vector, ${record.embeddingModel}, now())
            ON CONFLICT (org_id, id) DO UPDATE
              SET record = EXCLUDED.record, embedding = EXCLUDED.embedding,
                  embedding_model = EXCLUDED.embedding_model, updated_at = now()`;
        } else {
          await db.$executeRaw`
            UPDATE hmem_memories SET record = ${json}::jsonb, updated_at = now()
            WHERE org_id = ${orgId}::uuid AND id = ${record.id}`;
        }
      }
      if (remove.length > 0) {
        await db.memory.deleteMany({ where: { orgId, id: { in: remove } } });
      }
      if (ledger.length > 0) {
        await db.memoryLedgerEntry.createMany({
          data: ledger.map((e) => ({
            orgId,
            seq: e.seq,
            memoryId: e.memoryId,
            action: e.action,
            actor: e.actor,
            timestamp: BigInt(e.timestamp),
            previousState: toJson(e.previousState),
            newState: toJson(e.newState),
            details: toJson(e.details),
          })),
        });
      }
      for (const { id, ...backup } of backups) {
        await db.memoryBackup.create({ data: { orgId, id, snapshot: toJsonValue(backup) } });
      }
      await db.memoryState.upsert({
        where: { orgId },
        create: { orgId, version, side: toJsonValue(side) },
        update: { version, side: toJsonValue(side) },
      });
    },
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined ? Prisma.DbNull : toJsonValue(value);
}

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@kept/db";
import { hashEmbed, type Embedder } from "@kept/llm";
import { DurableHMEM } from "../src/durable.js";
import { prismaMemoryStorage } from "../src/prisma-storage.js";

const url = process.env.DATABASE_URL;
const prisma = url ? createPrismaClient(url) : null;
const orgId = randomUUID();
const embedder: Embedder = { model: "fake-model", embed: async (texts) => texts.map(hashEmbed) };

describe.skipIf(!prisma)("Postgres storage", () => {
  beforeAll(async () => {
    await prisma!.organization.create({ data: { id: orgId, name: "H-MEM test", slug: `hmem-test-${orgId}` } });
  });
  afterAll(async () => {
    await prisma!.organization.delete({ where: { id: orgId } }); // cascades to hmem_*
    await prisma!.$disconnect();
  });

  it("persists records with pgvector embeddings, the ledger, and sleep backups", async () => {
    const storage = prismaMemoryStorage(prisma!);
    let now = 1_760_000_000_000;
    const a = await DurableHMEM.open({ storage, namespace: orgId, embedder, clock: () => now });

    const m = await a.remember({ content: "Northwind always wants renewal quotes in EUR", source: "flag:resolution", type: "preference" });
    await a.feedback(m.id, "helpful");

    // A second process loads the same memory, embedding included.
    const b = await DurableHMEM.open({ storage, namespace: orgId, embedder, clock: () => now });
    const reloaded = b.current.store.get(m.id);
    expect(reloaded?.confidence).toBeCloseTo(0.75);
    // pgvector stores float4, so compare approximately.
    const original = hashEmbed(m.content);
    expect(reloaded?.embedding).toHaveLength(original.length);
    reloaded!.embedding.forEach((v, i) => expect(v).toBeCloseTo(original[i]!, 5));
    expect((await b.recall("EUR renewal quotes", { threshold: 0 })).memories[0]?.memory.id).toBe(m.id);
    expect((await b.history(m.id)).map((e) => e.action)).toEqual(["create", "feedback", "read"]);

    // 40 days later, sleep archives the rarely used memory and keeps a backup.
    now += 40 * 24 * 60 * 60 * 1000;
    const report = await a.sleep();
    expect(report.archived).toBe(1);
    expect(await prisma!.memoryBackup.count({ where: { orgId } })).toBe(1);
    const c = await DurableHMEM.open({ storage, namespace: orgId, embedder, clock: () => now });
    expect(c.current.store.get(m.id)).toBeUndefined();
    expect(await prisma!.memory.count({ where: { orgId } })).toBe(0);
  });
});

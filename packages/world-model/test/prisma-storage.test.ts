import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@kept/db";
import { WorldModel } from "../src/index.js";
import { prismaWorldStorage } from "../src/prisma-storage.js";

const url = process.env.DATABASE_URL;
const prisma = url ? createPrismaClient(url) : null;
const orgId = randomUUID();
const at = (iso: string) => ({ kind: "manual", at: iso });

describe.skipIf(!prisma)("Postgres storage", () => {
  beforeAll(async () => {
    await prisma!.organization.create({ data: { id: orgId, name: "World model test", slug: `wm-test-${orgId}` } });
  });
  afterAll(async () => {
    // Cascades to wm_events, wm_audit and wm_state.
    await prisma!.organization.delete({ where: { id: orgId } });
    await prisma!.$disconnect();
  });

  it("persists, reloads, and serializes concurrent writers per org", async () => {
    const storage = prismaWorldStorage(prisma!);
    const a = await WorldModel.open({ storage, namespace: orgId });
    const b = await WorldModel.open({ storage, namespace: orgId });

    await a.upsertEntity({ type: "account", externalKey: { system: "crm", id: "1" }, name: "Northwind", source: at("2026-10-01T00:00:00.000Z") });
    // Keyed by email: name-keyed contacts this similar would be auto-merged by the resolver.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? a : b).upsertEntity({
          type: "contact",
          externalKey: { system: "email", id: `contact${i}@northwind.com` },
          name: `Contact ${i}`,
          source: at(`2026-10-02T00:00:0${i}.000Z`),
        }),
      ),
    );
    for (const id of ["sara", "omar"]) {
      await a.upsertEntity({ type: "person", externalKey: { system: "kept", id }, source: at("2026-10-01T00:00:00.000Z") });
    }
    await a.relate({ from: "account:crm:1", type: "owned_by", to: "person:kept:sara", validFrom: "2026-10-01T00:00:00.000Z", source: at("2026-10-01T00:00:00.000Z") });
    await b.relate({ from: "account:crm:1", type: "owned_by", to: "person:kept:omar", validFrom: "2026-10-03T00:00:00.000Z", source: at("2026-10-03T00:00:00.000Z") });

    const seqs = await prisma!.worldEvent.findMany({ where: { orgId }, select: { seq: true }, orderBy: { seq: "asc" } });
    expect(seqs.map((r) => r.seq)).toEqual(seqs.map((_, i) => i + 1));

    // A fresh process reloading the log sees exactly what the writers built, including the closed edge.
    const fresh = await WorldModel.open({ storage, namespace: orgId });
    await a.refresh();
    expect(fresh.stateShapeCanonical()).toBe(a.stateShapeCanonical());

    const owners = (atIso?: string) =>
      fresh.view("graph").neighborsOf("account:crm:1", { via: "owned_by", at: atIso }).map((e) => e.id);
    expect(owners()).toEqual(["person:kept:omar"]);
    expect(owners("2026-10-02T00:00:00.000Z")).toEqual(["person:kept:sara"]);
    expect(fresh.view("graph").query({ type: "contact" })).toHaveLength(10);
  });
});

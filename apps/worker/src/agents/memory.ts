import type { Job } from "bullmq";
import type { PrismaClient } from "@kept/db";
import type { MemoryRecord } from "@kept/hmem";
import { DurableHMEM } from "@kept/hmem/durable";
import { prismaMemoryStorage } from "@kept/hmem/prisma";
import { openAIEmbedder } from "@kept/llm";
import type { LearnJobData } from "@kept/shared";

/** Memories are tagged with their account, or "org" for lessons that apply everywhere. */
export const accountTag = (accountId: string) => `account:${accountId}`;
const ORG_TAG = "org";

export function openMemory(prisma: PrismaClient, orgId: string) {
  return DurableHMEM.open({ storage: prismaMemoryStorage(prisma), namespace: orgId, embedder: openAIEmbedder(), actor: "kept-worker" });
}

/** Lessons relevant to an account, for the planner. Best effort: a run goes ahead without them. */
export async function recallForAccount(prisma: PrismaClient, orgId: string, accountId: string, query: string): Promise<string[]> {
  try {
    const memory = await openMemory(prisma, orgId);
    const tag = accountTag(accountId);
    const result = await memory.recall(query, {
      topN: 8,
      filter: (m: MemoryRecord) => m.tags.includes(tag) || m.tags.includes(ORG_TAG),
    });
    return result.memories.map((m) => m.memory.content);
  } catch (err) {
    console.warn(`memory recall for account ${accountId} failed: ${(err as Error).message}`);
    return [];
  }
}

/** Stores a lesson from a person's decision (a dismissed flag, a rejected or edited action). */
export function createLearnProcessor(prisma: PrismaClient) {
  return async (job: Job<LearnJobData>) => {
    const { orgId, accountId, content, flagId } = job.data;
    const memory = await openMemory(prisma, orgId);
    const record = await memory.remember({
      content,
      type: "factual",
      layer: "long_term",
      tags: [accountId ? accountTag(accountId) : ORG_TAG, "decision"],
      source: "kept",
      provenance: { origin: "user_correction", learnedAt: Date.now(), label: flagId ? `flag ${flagId}` : "decision" },
    });
    if (flagId) await prisma.flag.updateMany({ where: { id: flagId, orgId }, data: { hmemRef: record.id } });
    return { memoryId: record.id };
  };
}

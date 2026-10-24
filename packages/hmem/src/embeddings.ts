// Embedding helpers. The engine's default embedder is the deterministic hash
// embedder from the Meterless reference (via @kept/llm); production vectors come
// from a real model and are passed in precomputed.

import { HASH_EMBEDDING_MODEL, hashEmbed, tokenize } from "@kept/llm";
import type { SyncEmbedder } from "./types.js";

export { tokenize };
export const embed = hashEmbed;

export const hashSyncEmbedder: SyncEmbedder = { model: HASH_EMBEDDING_MODEL, embed: hashEmbed };

/** Cosine of unit vectors. Vectors of different sizes come from different models and score 0. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// Entity resolution bands (Meterless World Model):
//   similarity >= 0.85         -> auto-merge (0.85 exactly merges)
//   0.82 <= similarity < 0.85  -> operator review queue (0.82 exactly queues)
//   similarity < 0.82          -> new entity
// Similarity is 1 - levenshtein / max(len), on NORMALIZED names.

import { normalizeName } from "./stable-ids.js";

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

export function nameSimilarity(rawA: string, rawB: string): number {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export type ResolutionDecision = "auto-merge" | "review" | "new";

export function decide(similarity: number, autoMergeAt = 0.85, reviewLower = 0.82): ResolutionDecision {
  if (similarity >= autoMergeAt) return "auto-merge";
  if (similarity >= reviewLower) return "review";
  return "new";
}

/** Clustering gate for ingest: entity-overlap Jaccard >= 0.5 co-clusters two observations. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Turns text into vectors. Every vector records the model that produced it, since vectors from different models must never be compared. */
export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

const HASH_DIM = 64;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Deterministic bag-of-words embedder (FNV-1a hashed into 64 dims, L2-normalized), as in the
 * Meterless reference. For tests and conformance only: it has no real semantics.
 */
export function hashEmbed(text: string): number[] {
  const vec = new Array<number>(HASH_DIM).fill(0);
  for (const token of tokenize(text)) {
    const h = fnv1a(token);
    const sign = (h >>> 8) % 2 === 0 ? 1 : -1;
    vec[h % HASH_DIM]! += sign * (1 + ((h >>> 16) % 8) / 8);
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}

export const HASH_EMBEDDING_MODEL = "hash-fnv1a-64";

export const hashEmbedder: Embedder = {
  model: HASH_EMBEDDING_MODEL,
  async embed(texts) {
    return texts.map(hashEmbed);
  },
};

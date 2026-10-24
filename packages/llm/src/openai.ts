import OpenAI from "openai";
import type { Embedder } from "./embedder.js";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/** Inputs per request; the API accepts larger batches, this keeps payloads and retries small. */
const BATCH_SIZE = 256;

/**
 * OpenAI embeddings. The client is created on first use, so processes that never embed
 * (and tests) don't need OPENAI_API_KEY.
 */
export function openAIEmbedder(opts: { apiKey?: string; model?: string } = {}): Embedder {
  const model = opts.model || process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  let client: OpenAI | null = null;

  return {
    model,
    async embed(texts) {
      if (texts.length === 0) return [];
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      client ??= new OpenAI({ apiKey });
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const res = await client.embeddings.create({ model, input: texts.slice(i, i + BATCH_SIZE) });
        // The API returns one item per input, tagged with its index.
        for (const item of [...res.data].sort((a, b) => a.index - b.index)) out.push(item.embedding);
      }
      return out;
    },
  };
}

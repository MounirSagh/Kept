import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { wrapOpenAI } from "langsmith/wrappers";
import type { z } from "zod";

/**
 * "fast" is the cheaper model for bulk work (extraction, investigation); "smart" the stronger one
 * for judgment (planning, criticism, advice).
 */
export type ModelTier = "fast" | "smart";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface StructuredRequest<S extends z.ZodType> {
  /** Names the call in traces and selects the scripted answer in tests. */
  name: string;
  tier: ModelTier;
  system: string;
  user: string;
  schema: S;
}

/** Every agent call is one structured request: instructions plus input in, schema-valid JSON out. */
export interface ChatModel {
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<{ data: z.infer<S>; usage: Usage }>;
}

export const DEFAULT_FAST_MODEL = "gpt-5-mini";
export const DEFAULT_SMART_MODEL = "gpt-5";

type ReasoningEffort = "minimal" | "low" | "medium" | "high";
/**
 * Reasoning models think before answering. Their default (medium) made one planner call take 90s;
 * these are structured, well-specified tasks, so low is enough.
 */
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";
const REASONING_EFFORTS = new Set<string>(["minimal", "low", "medium", "high"]);
/** Only reasoning models accept the reasoning parameter. */
const isReasoningModel = (model: string) => /^(gpt-5|o\d)/.test(model);
/** One call may take this long before it's abandoned (and retried by the SDK). */
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

/** USD per million tokens [input, output]. Unknown models count as free rather than guessing. */
const PRICES: Record<string, [number, number]> = {
  "gpt-5": [1.25, 10],
  "gpt-5-mini": [0.25, 2],
  "gpt-5-nano": [0.05, 0.4],
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [inPrice, outPrice] = PRICES[model] ?? [0, 0];
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}

/**
 * OpenAI through the Responses API with strict JSON-schema output. Models come from
 * OPENAI_FAST_MODEL / OPENAI_SMART_MODEL. With LANGSMITH_TRACING=true each call shows up in
 * LangSmith inside the agent run's trace.
 */
export function openAIChatModel(
  opts: { apiKey?: string; fastModel?: string; smartModel?: string; reasoningEffort?: ReasoningEffort } = {},
): ChatModel {
  const models: Record<ModelTier, string> = {
    // || not ??: an unset variable passed through Docker Compose arrives as "".
    fast: opts.fastModel || process.env.OPENAI_FAST_MODEL || DEFAULT_FAST_MODEL,
    smart: opts.smartModel || process.env.OPENAI_SMART_MODEL || DEFAULT_SMART_MODEL,
  };
  const envEffort = process.env.OPENAI_REASONING_EFFORT;
  const effort: ReasoningEffort =
    opts.reasoningEffort ?? (envEffort && REASONING_EFFORTS.has(envEffort) ? (envEffort as ReasoningEffort) : DEFAULT_REASONING_EFFORT);
  let client: OpenAI | null = null;

  return {
    async structured(req) {
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      if (!client) {
        const base = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
        client = process.env.LANGSMITH_TRACING === "true" ? wrapOpenAI(base) : base;
      }

      const model = models[req.tier];
      const res = await client.responses.parse({
        model,
        instructions: req.system,
        input: req.user,
        text: { format: zodTextFormat(req.schema, req.name) },
        ...(isReasoningModel(model) ? { reasoning: { effort } } : {}),
      });
      if (res.output_parsed == null) throw new Error(`${req.name}: the model returned no parseable output`);
      const inputTokens = res.usage?.input_tokens ?? 0;
      const outputTokens = res.usage?.output_tokens ?? 0;
      return {
        data: res.output_parsed as z.infer<typeof req.schema>,
        usage: { inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) },
      };
    },
  };
}

/**
 * A model for tests: answers come from `script`, by request name, and are validated against the
 * request's schema like real output. `calls` records what was asked.
 */
export function scriptedChatModel(script: Record<string, unknown | ((user: string, call: number) => unknown)>) {
  const calls: { name: string; system: string; user: string }[] = [];
  const model: ChatModel = {
    async structured(req) {
      const answer = script[req.name];
      if (answer === undefined) throw new Error(`scriptedChatModel: no answer for "${req.name}"`);
      const n = calls.filter((c) => c.name === req.name).length;
      calls.push({ name: req.name, system: req.system, user: req.user });
      const raw = typeof answer === "function" ? (answer as (user: string, call: number) => unknown)(req.user, n) : answer;
      return { data: req.schema.parse(raw), usage: { inputTokens: 100, outputTokens: 50, costUsd: 0 } };
    },
  };
  return { model, calls };
}

/** Reads the text of a scan or a photo of a document. */
export interface Transcriber {
  transcribe(file: { bytes: Uint8Array; mimeType: string; name: string }): Promise<{ text: string; usage: Usage }>;
}

const TRANSCRIBE_PROMPT = `Transcribe all the text in this document, exactly as written, in reading order.
Keep headings, lists and table rows (cells separated by " | "). For a multi-page document, start each page with "[Page N]".
Don't summarize, translate, correct or add anything. If a part is unreadable, write [unreadable].`;

/**
 * OCR through the fast model: PDFs are sent as files, images as images. Used only for files with
 * no text layer, since it costs far more than reading text.
 */
export function openAITranscriber(opts: { apiKey?: string; model?: string } = {}): Transcriber {
  let client: OpenAI | null = null;
  return {
    async transcribe(file) {
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      client ??= new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
      const model = opts.model || process.env.OPENAI_FAST_MODEL || DEFAULT_FAST_MODEL;
      const data = `data:${file.mimeType};base64,${Buffer.from(file.bytes).toString("base64")}`;
      const part =
        file.mimeType === "application/pdf"
          ? { type: "input_file" as const, filename: file.name, file_data: data }
          : { type: "input_image" as const, image_url: data, detail: "high" as const };
      const res = await client.responses.create({
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: TRANSCRIBE_PROMPT }, part] }],
        ...(isReasoningModel(model) ? { reasoning: { effort: "low" as const } } : {}),
      });
      const inputTokens = res.usage?.input_tokens ?? 0;
      const outputTokens = res.usage?.output_tokens ?? 0;
      return { text: res.output_text ?? "", usage: { inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) } };
    },
  };
}

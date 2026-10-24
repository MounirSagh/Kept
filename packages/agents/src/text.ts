// Small text helpers shared by the agents.

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}

/** Lowercase, straight quotes, single spaces: how excerpts are compared with their source. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `excerpt` appears in `content`, ignoring case, quote style and whitespace.
 * Model output that cites words its source doesn't contain is discarded with this check.
 */
export function containsExcerpt(content: string, excerpt: string): boolean {
  const needle = normalizeForMatch(cleanExcerpt(excerpt));
  return needle.length >= 8 && normalizeForMatch(content).includes(needle);
}

/** An excerpt as stored and shown: trimmed, without the quote marks models like to wrap it in. */
export function cleanExcerpt(text: string): string {
  let out = text.trim();
  for (;;) {
    const m = out.match(/^["'\u201C\u2018](.*)["'\u201D\u2019]$/s);
    if (!m) return out;
    out = m[1]!.trim();
  }
}

/** A real calendar date in YYYY-MM-DD form, or null. */
export function isoDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/** Largest content kept per item; longer documents are clipped (extraction reads the start). */
export const MAX_CONTENT_CHARS = 50_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Good-enough HTML to text for email bodies and chat messages. */
export function htmlToText(html: string): string {
  return clip(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
        if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
        if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
        return ENTITIES[e.toLowerCase()] ?? m;
      })
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

export function clip(text: string, max = MAX_CONTENT_CHARS): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function date(value: unknown, fallback = new Date(0)): Date {
  const d = typeof value === "number" ? new Date(value) : new Date(String(value ?? ""));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

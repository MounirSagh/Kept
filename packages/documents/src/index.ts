// Turns a file into text Kept can read for commitments: PDFs, Word, Excel and CSV, PowerPoint,
// plain text and HTML. Page and slide markers are kept, so quotes can say where they came from.
// Files with no text layer (scans, photos) come back with needsOcr: the caller decides whether
// to send them to a vision model.

import { strFromU8, unzipSync } from "fflate";

export type DocumentFormat = "pdf" | "docx" | "xlsx" | "csv" | "pptx" | "text" | "html" | "image";

export interface ReadResult {
  format: DocumentFormat;
  text: string;
  /** Pages (PDF) or slides (PowerPoint); null where the format has none. */
  pages: number | null;
  /** No usable text layer: a scan or an image. */
  needsOcr: boolean;
  /** True when the text was cut at MAX_TEXT_CHARS. */
  truncated: boolean;
}

/** Text kept per document. A long contract fits; a data dump is cut. */
export const MAX_TEXT_CHARS = 400_000;
/** Rows and columns read per spreadsheet tab. */
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 50;
/** A page with less text than this has no usable text layer (a scanned page, or a blank one). */
const EMPTY_PAGE_CHARS = 10;

const MIME: Record<string, DocumentFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroenabled.12": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/csv": "csv",
  "text/plain": "text",
  "text/markdown": "text",
  "application/json": "text",
  "text/html": "html",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
};

const EXTENSION: Record<string, DocumentFormat> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  pptx: "pptx",
  csv: "csv",
  txt: "text",
  md: "text",
  json: "text",
  html: "html",
  htm: "html",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
};

/** The format Kept can read for a file, from its MIME type or else its extension; null when unsupported. */
export function formatOf(mimeType: string | null | undefined, name: string | null | undefined): DocumentFormat | null {
  const mime = mimeType?.split(";")[0]!.trim().toLowerCase();
  if (mime && MIME[mime]) return MIME[mime];
  const ext = name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? (EXTENSION[ext] ?? null) : null;
}

function cap(text: string): { text: string; truncated: boolean } {
  return text.length <= MAX_TEXT_CHARS ? { text, truncated: false } : { text: text.slice(0, MAX_TEXT_CHARS), truncated: true };
}

const tidy = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export async function readDocument(bytes: Uint8Array, format: DocumentFormat): Promise<ReadResult> {
  const done = (text: string, pages: number | null, needsOcr = false): ReadResult => ({ format, pages, needsOcr, ...cap(tidy(text)) });

  switch (format) {
    case "pdf": {
      const { getDocumentProxy, extractText } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      const pages = text as string[];
      // A scan has no text on most pages; a sparse cover or signature page alone doesn't count.
      const empty = pages.filter((p) => p.trim().length < EMPTY_PAGE_CHARS).length;
      const body = pages.map((p, i) => `[Page ${i + 1}]\n${p.trim()}`).join("\n\n");
      return done(body, totalPages, empty > pages.length / 2);
    }
    case "docx": {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return done(value, null);
    }
    case "xlsx":
      return done(await readWorkbook(bytes), null);
    case "pptx":
      return readSlides(bytes, done);
    case "csv":
    case "text":
      return done(new TextDecoder().decode(bytes), null);
    case "html":
      return done(htmlToText(new TextDecoder().decode(bytes)), null);
    case "image":
      return done("", null, true);
  }
}

/** Every tab, as "## Sheet: name" then one row per line, cells separated by " | ". */
async function readWorkbook(bytes: Uint8Array): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const out: string[] = [];
  for (const sheet of workbook.worksheets) {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (n > MAX_ROWS) return;
      const values = (row.values as unknown[]).slice(1, MAX_COLUMNS + 1).map(cellText);
      while (values.length && !values.at(-1)) values.pop();
      if (values.some(Boolean)) rows.push(values.join(" | "));
    });
    if (rows.length) out.push(`## Sheet: ${sheet.name}\n${rows.join("\n")}${sheet.rowCount > MAX_ROWS ? `\n[${sheet.rowCount - MAX_ROWS} more rows not read]` : ""}`);
  }
  return out.join("\n\n");
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: string; error?: string };
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.result !== undefined) return cellText(v.result);
    if (typeof v.text === "string") return v.text;
    if (v.error) return "";
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/** A .pptx is a zip of slide XML files; their text runs are <a:t> elements. */
function readSlides(bytes: Uint8Array, done: (text: string, pages: number | null) => ReadResult): ReadResult {
  const files = unzipSync(new Uint8Array(bytes), { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
  const slides = Object.keys(files)
    .map((name) => ({ n: Number(name.match(/slide(\d+)\.xml$/)![1]), xml: strFromU8(files[name]!) }))
    .sort((a, b) => a.n - b.n);
  const text = slides
    .map((s) => {
      const paragraphs = s.xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]!)).join(""));
      return `[Slide ${s.n}]\n${paragraphs.filter((p) => p.trim()).join("\n")}`;
    })
    .join("\n\n");
  return done(text, slides.length);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string): string {
  return decodeXml(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The page a quote comes from, from the "[Page N]" markers readDocument adds. Null for formats
 * without pages, or when the quote can't be found.
 */
export function pageOf(text: string, excerpt: string): number | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const haystack = norm(text);
  const at = haystack.indexOf(norm(excerpt).slice(0, 60));
  if (at < 0) return null;
  const marker = [...haystack.slice(0, at).matchAll(/\[(?:page|slide) (\d+)\]/g)].at(-1);
  return marker ? Number(marker[1]) : null;
}

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@kept/db";
import type { Transcriber } from "@kept/agents";
import { ApiError, AuthError, downloadFile, FileTooLargeError, type ConnectorConfig, type FileSource } from "@kept/connectors";
import { formatOf, readDocument } from "@kept/documents";
import { clientForConnection } from "../connection-client.js";

/** Files read per job; the rest wait for the next job (one is queued while any remain). */
const PER_JOB = 10;
/** Scans OCR'd only up to this size: OCR costs far more than reading text. */
const MAX_OCR_PAGES = 20;
const MAX_OCR_BYTES = 10 * 1024 * 1024;
/** Attempts before a file that keeps failing is given up on. */
const MAX_ATTEMPTS = 3;

/**
 * What happened when Kept tried to read a file:
 * - read / ocr: its text is the item's content (ocr: from a scan, through a vision model)
 * - unsupported: a format Kept can't read (zip, video, old .doc...)
 * - too_large: over the size limit
 * - no_access: the connection can't open it (deleted, not shared, or a missing permission like Slack's files:read)
 * - needs_ocr: a scan too big to OCR, or OCR unavailable
 * - empty: no text at all
 * - failed: kept failing; see readError
 */
export type ContentStatus = "pending" | "read" | "ocr" | "unsupported" | "too_large" | "no_access" | "needs_ocr" | "empty" | "failed";

type FileMeta = { file?: FileSource; mimeType?: string | null; readAttempts?: number } & Record<string, unknown>;

/**
 * Downloads and reads files routed to a client and not read yet. Their text becomes the item's
 * content, and the new content hash hands them to extraction like any other item.
 */
export async function readPendingDocuments(
  prisma: PrismaClient,
  config: ConnectorConfig | null,
  transcriber: Transcriber | null,
  orgId: string,
): Promise<{ read: number; skipped: number; more: boolean }> {
  if (!config) return { read: 0, skipped: 0, more: false };
  const docs = await prisma.sourceItem.findMany({
    where: { orgId, kind: "document", matchStatus: "matched", deletedAt: null, metadata: { path: ["contentStatus"], equals: "pending" } },
    include: { connection: true },
    orderBy: { occurredAt: "desc" },
    take: PER_JOB + 1,
  });
  let read = 0;
  let skipped = 0;

  for (const doc of docs.slice(0, PER_JOB)) {
    const meta = (doc.metadata ?? {}) as FileMeta;
    const mark = async (status: ContentStatus, extra: Record<string, unknown> = {}) => {
      await prisma.sourceItem.update({ where: { id: doc.id }, data: { metadata: { ...meta, contentStatus: status, ...extra } as Prisma.InputJsonValue } });
      skipped++;
    };
    if (!meta.file || doc.connection.status !== "active") {
      await mark(meta.file ? "no_access" : "unsupported");
      continue;
    }
    // Known-unreadable types are skipped without downloading.
    const declared = formatOf(meta.mimeType, doc.title);
    if (meta.mimeType && !declared && !meta.mimeType.startsWith("application/vnd.google-apps.") && meta.file.kind !== "ms-share") {
      await mark("unsupported");
      continue;
    }

    try {
      const { client } = clientForConnection(prisma, config, doc.connection);
      const file = await downloadFile(client, meta.file);
      const name = (doc.title && doc.title !== "Linked file" ? doc.title : file.name) ?? doc.title ?? "file";
      const format = formatOf(file.mimeType ?? meta.mimeType, file.name ?? name);
      if (!format) {
        await mark("unsupported", { mimeType: file.mimeType ?? meta.mimeType });
        continue;
      }
      const result = await readDocument(file.bytes, format);
      let text = result.text;
      let status: ContentStatus = "read";
      let ocrCostUsd: number | undefined;
      if (result.needsOcr) {
        const ocrable = transcriber && (format === "pdf" || format === "image") && file.bytes.byteLength <= MAX_OCR_BYTES && (result.pages ?? 1) <= MAX_OCR_PAGES;
        if (!ocrable) {
          await mark("needs_ocr", { format, pages: result.pages });
          continue;
        }
        const mimeType = format === "pdf" ? "application/pdf" : (file.mimeType ?? meta.mimeType ?? "image/png");
        const ocr = await transcriber.transcribe({ bytes: file.bytes, mimeType, name });
        text = ocr.text.trim();
        status = "ocr";
        ocrCostUsd = ocr.usage.costUsd;
      }
      if (!text.trim()) {
        await mark("empty", { format, pages: result.pages });
        continue;
      }
      await prisma.sourceItem.update({
        where: { id: doc.id },
        data: {
          title: name,
          contentText: text,
          contentHash: createHash("sha256").update(text).digest("hex"),
          metadata: {
            ...meta,
            contentStatus: status,
            format,
            pages: result.pages,
            truncated: result.truncated,
            mimeType: file.mimeType ?? meta.mimeType ?? null,
            ...(ocrCostUsd !== undefined ? { ocrCostUsd } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      read++;
    } catch (err) {
      if (err instanceof FileTooLargeError) await mark("too_large", { size: err.bytes });
      else if (err instanceof ApiError && (err.status === 403 || err.status === 404)) await mark("no_access", { readError: err.message.slice(0, 200) });
      else if (err instanceof ApiError && err.status === 415) await mark("unsupported");
      else if (err instanceof AuthError) await mark("no_access", { readError: "The connection needs reconnecting" });
      else {
        const attempts = (meta.readAttempts ?? 0) + 1;
        await mark(attempts >= MAX_ATTEMPTS ? "failed" : "pending", { readAttempts: attempts, readError: (err as Error).message.slice(0, 200) });
      }
    }
  }
  return { read, skipped, more: docs.length > PER_JOB };
}

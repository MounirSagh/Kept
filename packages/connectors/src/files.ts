// Files: how to download each kind a connector reports, and how to find links to files in text.
// Connectors only report a file (name, type, size, where to get it). It's downloaded and read
// later, once it's known to belong to a client: most files in a drive are internal.

import { ApiError, type ApiClient } from "./http.js";

/** Where a file's bytes are, recorded on the item at sync time. */
export type FileSource =
  | { kind: "gmail-attachment"; messageId: string; partId: string }
  | { kind: "graph-attachment"; messageId: string; attachmentId: string }
  | { kind: "slack-file"; url: string }
  | { kind: "gdrive"; fileId: string }
  | { kind: "onedrive"; itemId: string }
  /** A OneDrive or SharePoint sharing link, resolved through Graph's /shares. */
  | { kind: "ms-share"; url: string };

/**
 * Metadata a connector puts on a file item: where to download it, and that it hasn't been read.
 * The worker reads it (contentStatus becomes "read", "ocr", "unsupported"...) once it's routed to a client.
 */
export function fileMetadata(source: FileSource, file: { mimeType?: string | null; size?: number | null }) {
  return { file: source, mimeType: file.mimeType ?? null, size: file.size ?? null, contentStatus: "pending" };
}

/** Attachments smaller than this are signatures, logos and tracking pixels, not documents. */
export const MIN_ATTACHMENT_BYTES = 2 * 1024;
/** Images below this size are almost always logos or inline pictures; bigger ones may be scans. */
export const MIN_IMAGE_BYTES = 100 * 1024;

/** Whether an attachment is worth reporting as a document. */
export function isDocumentAttachment(file: { mimeType?: string | null; size?: number | null; inline?: boolean }): boolean {
  const size = file.size ?? 0;
  if (file.inline || size < MIN_ATTACHMENT_BYTES) return false;
  if (file.mimeType?.startsWith("image/") && size < MIN_IMAGE_BYTES) return false;
  return true;
}

/** Files larger than this aren't downloaded. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export class FileTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`File is ${Math.round(bytes / 1024 / 1024)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
}

export interface DownloadedFile {
  bytes: Uint8Array;
  mimeType: string | null;
  name: string | null;
}

const GOOGLE_EXPORTS: Record<string, string> = {
  // Docs and Slides as text; Sheets as a workbook, so every tab survives.
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function bytesOf(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_FILE_BYTES) throw new FileTooLargeError(declared);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileTooLargeError(bytes.byteLength);
  return bytes;
}

const BINARY = { headers: { Accept: "*/*" } };

/** Downloads a file with its connection's client. Throws ApiError (403/404 = no access) or FileTooLargeError. */
export async function downloadFile(client: ApiClient, source: FileSource): Promise<DownloadedFile> {
  switch (source.kind) {
    case "gmail-attachment": {
      // Attachment ids aren't stable between requests; the part id is, so look the attachment up again.
      type Part = { partId?: string; filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[] };
      const message = await client.json<{ payload?: Part }>(`/gmail/v1/users/me/messages/${source.messageId}`, { query: { format: "full" } });
      const find = (p?: Part): Part | undefined => (p?.partId === source.partId ? p : p?.parts?.map(find).find(Boolean));
      const part = find(message.payload);
      if (!part?.body?.attachmentId) throw new ApiError(404, "attachment not found", source.messageId);
      if ((part.body.size ?? 0) > MAX_FILE_BYTES) throw new FileTooLargeError(part.body.size!);
      const att = await client.json<{ data: string }>(`/gmail/v1/users/me/messages/${source.messageId}/attachments/${part.body.attachmentId}`);
      return { bytes: new Uint8Array(Buffer.from(att.data, "base64url")), mimeType: part.mimeType ?? null, name: part.filename ?? null };
    }
    case "graph-attachment": {
      const res = await client.raw(`/me/messages/${source.messageId}/attachments/${source.attachmentId}/$value`, BINARY);
      return { bytes: await bytesOf(res), mimeType: res.headers.get("content-type"), name: null };
    }
    case "slack-file": {
      const res = await client.raw(source.url, BINARY);
      // Without files:read, Slack answers 200 with its HTML sign-in page instead of the file.
      if (res.headers.get("content-type")?.startsWith("text/html")) throw new ApiError(403, "files:read permission missing", source.url);
      return { bytes: await bytesOf(res), mimeType: res.headers.get("content-type"), name: null };
    }
    case "gdrive": {
      const meta = await client.json<{ name?: string; mimeType?: string; size?: string }>(`/drive/v3/files/${source.fileId}`, {
        query: { fields: "name,mimeType,size", supportsAllDrives: "true" },
      });
      if (Number(meta.size ?? 0) > MAX_FILE_BYTES) throw new FileTooLargeError(Number(meta.size));
      const exportAs = meta.mimeType ? GOOGLE_EXPORTS[meta.mimeType] : undefined;
      if (meta.mimeType?.startsWith("application/vnd.google-apps.") && !exportAs) {
        throw new ApiError(415, `Google ${meta.mimeType.split(".").pop()} files can't be read`, source.fileId);
      }
      const res = exportAs
        ? await client.raw(`/drive/v3/files/${source.fileId}/export`, { ...BINARY, query: { mimeType: exportAs } })
        : await client.raw(`/drive/v3/files/${source.fileId}`, { ...BINARY, query: { alt: "media", supportsAllDrives: "true" } });
      return { bytes: await bytesOf(res), mimeType: exportAs ?? meta.mimeType ?? null, name: meta.name ?? null };
    }
    case "onedrive": {
      const meta = await client.json<{ name?: string; size?: number; file?: { mimeType?: string } }>(`/me/drive/items/${source.itemId}?$select=name,size,file`);
      if ((meta.size ?? 0) > MAX_FILE_BYTES) throw new FileTooLargeError(meta.size!);
      const res = await client.raw(`/me/drive/items/${source.itemId}/content`, BINARY);
      return { bytes: await bytesOf(res), mimeType: meta.file?.mimeType ?? null, name: meta.name ?? null };
    }
    case "ms-share": {
      // https://learn.microsoft.com/graph/api/shares-get: "u!" + unpadded base64url of the URL.
      const id = `u!${Buffer.from(source.url).toString("base64url")}`;
      const meta = await client.json<{ name?: string; size?: number; file?: { mimeType?: string } }>(`/shares/${id}/driveItem?$select=name,size,file`);
      if ((meta.size ?? 0) > MAX_FILE_BYTES) throw new FileTooLargeError(meta.size!);
      const res = await client.raw(`/shares/${id}/driveItem/content`, BINARY);
      return { bytes: await bytesOf(res), mimeType: meta.file?.mimeType ?? null, name: meta.name ?? null };
    }
  }
}

/** A link to a file found in a message, calendar event or note. */
export type FileLink = { provider: "google"; fileId: string; url: string } | { provider: "microsoft"; url: string };

const GOOGLE_LINK = /https:\/\/(?:docs|drive)\.google\.com\/(?:(?:document|spreadsheets|presentation|file)\/d\/|open\?id=)([A-Za-z0-9_-]{20,})[^\s<>")\]]*/g;
const MICROSOFT_LINK = /https:\/\/(?:[a-z0-9-]+\.sharepoint\.com|onedrive\.live\.com|1drv\.ms)\/[^\s<>")\]]+/gi;

/** Google Drive, OneDrive and SharePoint file links in a text, without duplicates. */
export function findFileLinks(text: string | null | undefined): FileLink[] {
  if (!text) return [];
  const out = new Map<string, FileLink>();
  for (const m of text.matchAll(GOOGLE_LINK)) out.set(`g:${m[1]}`, { provider: "google", fileId: m[1]!, url: m[0] });
  for (const m of text.matchAll(MICROSOFT_LINK)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    out.set(`m:${url}`, { provider: "microsoft", url });
  }
  return [...out.values()];
}

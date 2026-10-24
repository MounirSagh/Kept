// Google Workspace, connected per user: Gmail, Google Calendar (primary), Google Drive.
// gmail.readonly and drive.readonly are restricted scopes, and gmail.send is sensitive: production
// use needs Google's app verification and a security assessment (testing mode allows up to 100 test users).
// gmail.send lets Kept send emails a person approved, from their own mailbox.

import { ApiError, type ApiClient } from "../http.js";
import { standardToken } from "../oauth.js";
import { clip, date, htmlToText } from "../text.js";
import type { ProviderDefinition, SourceItemInput, Stream } from "../types.js";

// ------------------------------------------------------------------ Gmail

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart;
}

const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return undefined;
}

export function mapGmail(m: GmailMessage): SourceItemInput | null {
  if (m.labelIds?.some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH")) return null;
  const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value;
  const plain = findPart(m.payload, "text/plain");
  const html = findPart(m.payload, "text/html");
  const text = plain ? clip(decode(plain.body?.data)) : html ? htmlToText(decode(html.body?.data)) : (m.snippet ?? "");
  const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  return {
    externalId: `gmail:${m.id}`,
    kind: "email",
    title: header("subject") ?? "(no subject)",
    author: header("from"),
    url: `https://mail.google.com/mail/u/0/#all/${m.id}`,
    occurredAt: date(Number(m.internalDate)),
    contentText: text,
    metadata: { threadId: m.threadId, labels: m.labelIds ?? [], to: list(header("to")), cc: list(header("cc")), sent: m.labelIds?.includes("SENT") ?? false },
  };
}

type GmailCursor =
  | { phase: "backfill"; pageToken?: string; startHistoryId: string }
  | { phase: "history"; historyId: string; pageToken?: string };

async function fetchMessages(client: ApiClient, ids: string[]): Promise<SourceItemInput[]> {
  const messages = await Promise.all(
    ids.map((id) =>
      client
        .json<GmailMessage>(`/gmail/v1/users/me/messages/${id}`, { query: { format: "full" } })
        .catch((err: unknown) => {
          // Deleted between listing and fetching.
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
    ),
  );
  return messages.filter((m): m is GmailMessage => !!m).map(mapGmail).filter((i): i is SourceItemInput => !!i);
}

/** Backfills the window with a search, then follows the history API from where the backfill began. */
const gmailStream: Stream = {
  name: "gmail",
  async step(client, raw, ctx) {
    let cursor = raw as GmailCursor | undefined;
    if (!cursor) {
      const profile = await client.json<{ historyId: string }>("/gmail/v1/users/me/profile");
      cursor = { phase: "backfill", startHistoryId: profile.historyId };
    }

    if (cursor.phase === "backfill") {
      const after = Math.floor(ctx.since.getTime() / 1000);
      const page = await client.json<{ messages?: { id: string }[]; nextPageToken?: string }>("/gmail/v1/users/me/messages", {
        query: { q: `after:${after}`, maxResults: 25, pageToken: cursor.pageToken },
      });
      const items = await fetchMessages(client, (page.messages ?? []).map((m) => m.id));
      if (page.nextPageToken) return { items, cursor: { ...cursor, pageToken: page.nextPageToken }, more: true };
      return { items, cursor: { phase: "history", historyId: cursor.startHistoryId }, more: true };
    }

    let page: { history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string; historyId?: string };
    try {
      page = await client.json("/gmail/v1/users/me/history", {
        query: { startHistoryId: cursor.historyId, historyTypes: "messageAdded", maxResults: 100, pageToken: cursor.pageToken },
      });
    } catch (err) {
      // History older than about a week is gone: start over with a fresh backfill.
      if (err instanceof ApiError && err.status === 404) return { items: [], cursor: undefined, more: true };
      throw err;
    }
    const ids = [...new Set((page.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((a) => a.message.id)))];
    const items = await fetchMessages(client, ids);
    if (page.nextPageToken) return { items, cursor: { ...cursor, pageToken: page.nextPageToken }, more: true };
    return { items, cursor: { phase: "history", historyId: page.historyId ?? cursor.historyId }, more: false };
  },
};

// --------------------------------------------------------------- Calendar

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string }[];
}

type CalendarCursor = { phase: "backfill" | "updates"; pageToken?: string; watermark: string; maxSeen?: string };

/**
 * Backfill by event time (Google rejects an updatedMin that is too old), then follow
 * changes with updatedMin from the moment the backfill started.
 */
const calendarStream: Stream = {
  name: "calendar",
  async step(client, raw, ctx) {
    const cursor: CalendarCursor = (raw as CalendarCursor | undefined) ?? { phase: "backfill", watermark: ctx.now.toISOString() };
    const query =
      cursor.phase === "backfill"
        ? { timeMin: ctx.since.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 100, pageToken: cursor.pageToken }
        : { updatedMin: cursor.watermark, orderBy: "updated", showDeleted: false, maxResults: 100, pageToken: cursor.pageToken };
    const page = await client.json<{ items?: GEvent[]; nextPageToken?: string }>("/calendar/v3/calendars/primary/events", { query });

    let maxSeen = cursor.maxSeen;
    const items: SourceItemInput[] = [];
    for (const e of page.items ?? []) {
      if (e.updated && (!maxSeen || e.updated > maxSeen)) maxSeen = e.updated;
      if (e.status === "cancelled") continue;
      items.push({
        externalId: `gcal:${e.id}`,
        kind: "event",
        title: e.summary ?? "(no title)",
        author: e.organizer?.displayName ?? e.organizer?.email,
        url: e.htmlLink,
        occurredAt: date(e.start?.dateTime ?? e.start?.date),
        contentText: e.description ? htmlToText(e.description) : undefined,
        metadata: {
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          organizer: e.organizer?.email,
          attendees: (e.attendees ?? []).map((a) => a.email).filter(Boolean),
        },
      });
    }
    if (page.nextPageToken) return { items, cursor: { ...cursor, pageToken: page.nextPageToken, maxSeen }, more: true };
    // Backfill hands over to updates from when it started; updates advance to the newest change seen.
    const watermark = cursor.phase === "backfill" ? cursor.watermark : (maxSeen ?? cursor.watermark);
    return { items, cursor: { phase: "updates", watermark }, more: cursor.phase === "backfill" };
  },
};

// ------------------------------------------------------------------ Drive

interface GFile {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
}

const GOOGLE_DOC = "application/vnd.google-apps.document";

type DriveCursor = { watermark?: string; pageToken?: string; maxSeen?: string };

/** Files modified since the watermark. Google Docs are exported as text; other files are metadata only for now. */
const driveStream: Stream = {
  name: "drive",
  async step(client, raw, ctx) {
    const cursor = (raw as DriveCursor | undefined) ?? {};
    const watermark = cursor.watermark ?? ctx.since.toISOString();
    const page = await client.json<{ files?: GFile[]; nextPageToken?: string }>("/drive/v3/files", {
      query: {
        q: `modifiedTime > '${watermark}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        orderBy: "modifiedTime",
        pageSize: 50,
        pageToken: cursor.pageToken,
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,lastModifyingUser(displayName,emailAddress))",
      },
    });

    let maxSeen = cursor.maxSeen;
    const items: SourceItemInput[] = [];
    for (const f of page.files ?? []) {
      if (f.modifiedTime && (!maxSeen || f.modifiedTime > maxSeen)) maxSeen = f.modifiedTime;
      const text =
        f.mimeType === GOOGLE_DOC
          ? await client.text(`/drive/v3/files/${f.id}/export`, { query: { mimeType: "text/plain" } }).catch(() => undefined)
          : undefined;
      items.push({
        externalId: `gdrive:${f.id}`,
        kind: "document",
        title: f.name,
        author: f.lastModifyingUser?.displayName,
        url: f.webViewLink,
        occurredAt: date(f.modifiedTime),
        contentText: text ? clip(text) : undefined,
        metadata: { mimeType: f.mimeType, modifiedBy: f.lastModifyingUser?.emailAddress },
      });
    }
    if (page.nextPageToken) return { items, cursor: { watermark, pageToken: page.nextPageToken, maxSeen }, more: true };
    return { items, cursor: { watermark: maxSeen ?? watermark }, more: false };
  },
};

export const google: ProviderDefinition = {
  id: "google",
  name: "Google Workspace",
  scope: "personal",
  reads: "Your Gmail, Google Calendar and Google Drive. Sends only emails you approve.",
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
    // offline + consent: Google only returns a refresh token on the first consent otherwise.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    clientAuth: "body",
    bodyFormat: "form",
  },
  apiBase: "https://www.googleapis.com",
  parseToken: (raw) => standardToken(raw),
  async identify(client) {
    const me = await client.json<{ sub: string; email?: string }>("https://openidconnect.googleapis.com/v1/userinfo");
    return { externalAccountId: me.sub, label: me.email ?? me.sub };
  },
  streams: [gmailStream, calendarStream, driveStream],
};

// Google Workspace, connected per user: Gmail, Google Calendar (primary), Google Drive.
// gmail.readonly and drive.readonly are restricted scopes, and gmail.send is sensitive: production
// use needs Google's app verification and a security assessment (testing mode allows up to 100 test users).
// gmail.send lets Kept send emails a person approved, from their own mailbox.

import { fileMetadata, isDocumentAttachment } from "../files.js";
import { ApiError, type ApiClient } from "../http.js";
import { standardToken } from "../oauth.js";
import { clip, date, htmlToText } from "../text.js";
import type { ProviderDefinition, SourceItemInput, Stream } from "../types.js";

// ------------------------------------------------------------------ Gmail

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};
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

/** Attached files (not inline images), anywhere in the MIME tree. */
function attachments(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  const inline = part.headers?.some((h) => h.name.toLowerCase() === "content-disposition" && h.value.toLowerCase().startsWith("inline"));
  const self = part.filename && part.body?.attachmentId && isDocumentAttachment({ mimeType: part.mimeType, size: part.body.size, inline }) ? [part] : [];
  return [...self, ...(part.parts ?? []).flatMap(attachments)];
}

/** The email, followed by one document item per attached file. */
export function mapGmail(m: GmailMessage): SourceItemInput[] {
  if (m.labelIds?.some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH")) return [];
  const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value;
  const plain = findPart(m.payload, "text/plain");
  const html = findPart(m.payload, "text/html");
  const text = plain ? clip(decode(plain.body?.data)) : html ? htmlToText(decode(html.body?.data)) : (m.snippet ?? "");
  const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const files = attachments(m.payload);
  const url = `https://mail.google.com/mail/u/0/#all/${m.id}`;
  const occurredAt = date(Number(m.internalDate));
  // Attachments route like their email: same participants.
  const people = { to: list(header("to")), cc: list(header("cc")) };
  const email: SourceItemInput = {
    externalId: `gmail:${m.id}`,
    kind: "email",
    title: header("subject") ?? "(no subject)",
    author: header("from"),
    url,
    occurredAt,
    contentText: files.length ? `${text}\n\n[Attached: ${files.map((f) => f.filename).join(", ")}]` : text,
    metadata: { threadId: m.threadId, labels: m.labelIds ?? [], ...people, sent: m.labelIds?.includes("SENT") ?? false },
  };
  return [
    email,
    ...files.map((f) => ({
      externalId: `gmail:${m.id}:part:${f.partId}`,
      kind: "document" as const,
      title: f.filename,
      author: header("from"),
      url,
      occurredAt,
      metadata: {
        ...people,
        parent: email.externalId,
        attachedTo: email.title,
        ...fileMetadata({ kind: "gmail-attachment", messageId: m.id, partId: f.partId! }, { mimeType: f.mimeType, size: f.body?.size }),
      },
    })),
  ];
}

type GmailCursor =
  | { phase: "backfill"; pageToken?: string; startHistoryId: string }
  | { phase: "history"; historyId: string; pageToken?: string };

/** Messages fetched at once: each costs 5 of Gmail's per-user quota units, counted per minute. */
const GMAIL_CONCURRENCY = 5;

async function fetchMessages(client: ApiClient, ids: string[]): Promise<SourceItemInput[]> {
  const messages: (GmailMessage | null)[] = [];
  for (let i = 0; i < ids.length; i += GMAIL_CONCURRENCY) {
    const batch = await Promise.all(
      ids.slice(i, i + GMAIL_CONCURRENCY).map((id) =>
        client
          .json<GmailMessage>(`/gmail/v1/users/me/messages/${id}`, { query: { format: "full" } })
          .catch((err: unknown) => {
            // Deleted between listing and fetching.
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          }),
      ),
    );
    messages.push(...batch);
  }
  return messages.filter((m): m is GmailMessage => !!m).flatMap(mapGmail);
}

/** Gmail's tabs for newsletters, social networks and mailing lists: never a conversation with a client. */
const SKIPPED_CATEGORIES = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const SKIP_QUERY = "-category:promotions -category:social -category:forums";

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
        query: { q: `after:${after} ${SKIP_QUERY}`, maxResults: 25, pageToken: cursor.pageToken },
      });
      const items = await fetchMessages(client, (page.messages ?? []).map((m) => m.id));
      if (page.nextPageToken) return { items, cursor: { ...cursor, pageToken: page.nextPageToken }, more: true };
      return { items, cursor: { phase: "history", historyId: cursor.startHistoryId }, more: true };
    }

    let page: { history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; nextPageToken?: string; historyId?: string };
    try {
      page = await client.json("/gmail/v1/users/me/history", {
        query: { startHistoryId: cursor.historyId, historyTypes: "messageAdded", maxResults: 100, pageToken: cursor.pageToken },
      });
    } catch (err) {
      // History older than about a week is gone: start over with a fresh backfill.
      if (err instanceof ApiError && err.status === 404) return { items: [], cursor: undefined, more: true };
      throw err;
    }
    // History carries each message's labels, so newsletters are skipped before they're fetched.
    const ids = [
      ...new Set(
        (page.history ?? []).flatMap((h) =>
          (h.messagesAdded ?? []).filter((a) => !a.message.labelIds?.some((l) => SKIPPED_CATEGORIES.includes(l))).map((a) => a.message.id),
        ),
      ),
    ];
    const items = await fetchMessages(client, ids);
    if (page.nextPageToken) return { items, cursor: { ...cursor, pageToken: page.nextPageToken }, more: true };
    return { items, cursor: { phase: "history", historyId: page.historyId ?? cursor.historyId }, more: false };
  },
};

// --------------------------------------------------------------- Calendar

interface GEvent {
  id: string;
  status?: string;
  /** "default" for meetings; Google also creates birthdays, working locations, focus time and out-of-office. */
  eventType?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string }[];
  attachments?: { fileId?: string; fileUrl?: string; title?: string; mimeType?: string }[];
}

type CalendarCursor = { phase: "backfill" | "updates"; pageToken?: string; watermark: string; maxSeen?: string };

/** Meetings planned this far ahead are read; without a limit a recurring event repeats for decades. */
const CALENDAR_AHEAD_MS = 180 * 24 * 60 * 60 * 1000;
/** Entries Google adds by itself: never a meeting with anyone. */
const SKIPPED_EVENT_TYPES = new Set(["birthday", "workingLocation", "focusTime", "outOfOffice"]);

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
        ? {
            timeMin: ctx.since.toISOString(),
            timeMax: new Date(ctx.now.getTime() + CALENDAR_AHEAD_MS).toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 100,
            pageToken: cursor.pageToken,
          }
        : { updatedMin: cursor.watermark, orderBy: "updated", showDeleted: false, maxResults: 100, pageToken: cursor.pageToken };
    const page = await client.json<{ items?: GEvent[]; nextPageToken?: string }>("/calendar/v3/calendars/primary/events", { query });

    let maxSeen = cursor.maxSeen;
    const items: SourceItemInput[] = [];
    for (const e of page.items ?? []) {
      if (e.updated && (!maxSeen || e.updated > maxSeen)) maxSeen = e.updated;
      if (e.status === "cancelled" || SKIPPED_EVENT_TYPES.has(e.eventType ?? "default")) continue;
      const participants = { organizer: e.organizer?.email, attendees: (e.attendees ?? []).map((a) => a.email).filter(Boolean) };
      // Agendas and decks attached to the meeting: Drive files, routed by the meeting's attendees.
      for (const a of e.attachments ?? []) {
        if (!a.fileId) continue;
        items.push({
          externalId: `gdrive:${a.fileId}`,
          kind: "document",
          title: a.title,
          author: e.organizer?.displayName ?? e.organizer?.email,
          url: a.fileUrl,
          occurredAt: date(e.start?.dateTime ?? e.start?.date),
          metadata: { ...participants, parent: `gcal:${e.id}`, attachedTo: e.summary, ...fileMetadata({ kind: "gdrive", fileId: a.fileId }, { mimeType: a.mimeType }) },
        });
      }
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
  size?: string;
  parents?: string[];
  permissions?: { type?: string; emailAddress?: string; domain?: string }[];
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
}

type DriveCursor = { watermark?: string; pageToken?: string; maxSeen?: string; folders?: Record<string, string> };

/** Folder names remembered between syncs, for labeling containers. */
const MAX_FOLDER_NAMES = 500;

/**
 * Files modified since the watermark, as metadata: who they're shared with (people and domains,
 * so a file shared with @northwind.com routes to Northwind) and their folder (which owners can map
 * to a client on the Routing page). Contents are read later, only for files routed to a client.
 */
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
        fields:
          "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size,parents,permissions(type,emailAddress,domain),lastModifyingUser(displayName,emailAddress))",
      },
    });

    const folders = { ...(cursor.folders ?? {}) };
    for (const parent of new Set((page.files ?? []).map((f) => f.parents?.[0]).filter((p): p is string => !!p))) {
      if (folders[parent]) continue;
      const folder = await client.json<{ name?: string }>(`/drive/v3/files/${parent}`, { query: { fields: "name" } }).catch(() => ({ name: undefined }));
      folders[parent] = folder.name ?? "Folder";
    }
    // Keep the most recent names only.
    const keptFolders = Object.fromEntries(Object.entries(folders).slice(-MAX_FOLDER_NAMES));

    let maxSeen = cursor.maxSeen;
    const items: SourceItemInput[] = [];
    for (const f of page.files ?? []) {
      if (f.modifiedTime && (!maxSeen || f.modifiedTime > maxSeen)) maxSeen = f.modifiedTime;
      const perms = f.permissions ?? [];
      const parent = f.parents?.[0];
      items.push({
        externalId: `gdrive:${f.id}`,
        kind: "document",
        title: f.name,
        author: f.lastModifyingUser?.displayName,
        url: f.webViewLink,
        occurredAt: date(f.modifiedTime),
        metadata: {
          modifiedBy: f.lastModifyingUser?.emailAddress,
          sharedWith: perms.filter((p) => p.emailAddress).map((p) => p.emailAddress!.toLowerCase()),
          sharedWithDomains: perms.filter((p) => p.type === "domain" && p.domain).map((p) => p.domain!.toLowerCase()),
          ...fileMetadata({ kind: "gdrive", fileId: f.id }, { mimeType: f.mimeType, size: f.size ? Number(f.size) : null }),
        },
        container: parent ? { id: `folder:${parent}`, label: `Drive › ${keptFolders[parent] ?? "Folder"}` } : undefined,
      });
    }
    if (page.nextPageToken) return { items, cursor: { watermark, pageToken: page.nextPageToken, maxSeen, folders: keptFolders }, more: true };
    return { items, cursor: { watermark: maxSeen ?? watermark, folders: keptFolders }, more: false };
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

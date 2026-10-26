// Microsoft 365 via Microsoft Graph, connected per user (delegated permissions):
// Outlook inbox and sent mail with their attachments, Outlook calendar, OneDrive files, Teams chats
// and the files shared in them. Files are reported as metadata and read later, once routed to a client.
// Teams channel messages need admin-consented permissions and are not read yet.

import { createHash } from "node:crypto";
import { fileMetadata, findFileLinks, isDocumentAttachment } from "../files.js";
import { ApiError, type ApiClient } from "../http.js";
import { standardToken } from "../oauth.js";
import { clip, date, htmlToText } from "../text.js";
import type { ProviderDefinition, SourceItemInput, Stream, StreamStep } from "../types.js";

const PAGE = 'odata.maxpagesize=50';

type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
type Recipient = { emailAddress?: { name?: string; address?: string } };

interface Message {
  id: string;
  subject?: string;
  from?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  body?: { content?: string };
  bodyPreview?: string;
  webLink?: string;
  conversationId?: string;
  hasAttachments?: boolean;
  "@removed"?: unknown;
}

interface Attachment {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  "@odata.type"?: string;
}

const person = (r?: Recipient) =>
  r?.emailAddress ? (r.emailAddress.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : (r.emailAddress.address ?? "")) : undefined;
const addresses = (rs?: Recipient[]) => (rs ?? []).map((r) => r.emailAddress?.address).filter((a): a is string => !!a);

type DeltaCursor = { next?: string; delta?: string } | undefined;

/** A Graph delta query: page through nextLinks, then keep the deltaLink for the next run. */
function deltaStep<T>(
  initial: (since: Date) => string,
  headers: Record<string, string>,
  map: (item: T) => SourceItemInput | null,
) {
  return async (client: ApiClient, raw: unknown, ctx: { since: Date }): Promise<StreamStep> => {
    const cursor = raw as DeltaCursor;
    const url = cursor?.next ?? cursor?.delta ?? initial(ctx.since);
    let page: GraphPage<T & { "@removed"?: unknown }>;
    try {
      page = await client.json(url, { headers });
    } catch (err) {
      // 410 Gone: the delta token expired; Graph asks for a full resync.
      if (err instanceof ApiError && err.status === 410) return { items: [], cursor: undefined, more: true };
      throw err;
    }
    const items = page.value.filter((v) => !v["@removed"]).map(map).filter((i): i is SourceItemInput => !!i);
    if (page["@odata.nextLink"]) return { items, cursor: { next: page["@odata.nextLink"] }, more: true };
    return { items, cursor: { delta: page["@odata.deltaLink"] ?? cursor?.delta }, more: false };
  };
}

/**
 * One document item per attached file of the emails that have any. Listing attachments without
 * their content keeps this cheap; the bytes are downloaded only if the email routes to a client.
 */
async function withAttachments(client: ApiClient, step: StreamStep): Promise<StreamStep> {
  const extra: SourceItemInput[] = [];
  for (const email of step.items) {
    if (!email.metadata.hasAttachments) continue;
    const messageId = email.metadata.messageId as string;
    const page = await client.json<GraphPage<Attachment>>(`/me/messages/${messageId}/attachments?$select=id,name,contentType,size,isInline`);
    for (const a of page.value) {
      // Only files: item attachments (forwarded emails) and reference attachments (links) are skipped.
      if (a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
      if (!isDocumentAttachment({ mimeType: a.contentType, size: a.size, inline: a.isInline })) continue;
      extra.push({
        externalId: `${email.externalId}:att:${a.id}`,
        kind: "document",
        title: a.name,
        author: email.author,
        url: email.url,
        occurredAt: email.occurredAt,
        metadata: {
          from: email.metadata.from,
          to: email.metadata.to,
          cc: email.metadata.cc,
          parent: email.externalId,
          attachedTo: email.title,
          ...fileMetadata({ kind: "graph-attachment", messageId, attachmentId: a.id }, { mimeType: a.contentType, size: a.size }),
        },
      });
    }
  }
  return { ...step, items: [...step.items, ...extra] };
}

function mailStream(folder: "inbox" | "sentitems"): Stream {
  const select = "subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,bodyPreview,webLink,conversationId,hasAttachments";
  const read = deltaStep<Message>(
      (since) =>
        `/me/mailFolders/${folder}/messages/delta?$select=${select}&$filter=receivedDateTime ge ${since.toISOString()}`,
      { Prefer: `${PAGE}, outlook.body-content-type="text"` },
      (m) => ({
        externalId: `mail:${m.id}`,
        kind: "email",
        title: m.subject ?? "(no subject)",
        author: person(m.from),
        url: m.webLink,
        occurredAt: date(folder === "sentitems" ? (m.sentDateTime ?? m.receivedDateTime) : m.receivedDateTime),
        contentText: clip(m.body?.content ?? m.bodyPreview ?? ""),
        metadata: {
          folder,
          messageId: m.id,
          conversationId: m.conversationId,
          hasAttachments: m.hasAttachments ?? false,
          from: m.from?.emailAddress?.address,
          to: addresses(m.toRecipients),
          cc: addresses(m.ccRecipients),
        },
      }),
  );
  return { name: `mail_${folder}`, step: async (client, cursor, ctx) => withAttachments(client, await read(client, cursor, ctx)) };
}

interface CalendarEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  webLink?: string;
  isCancelled?: boolean;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  organizer?: Recipient;
  attendees?: Recipient[];
  location?: { displayName?: string };
}

const calendarStream: Stream = {
  name: "calendar",
  step: deltaStep<CalendarEvent>(
    (since) => {
      const end = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
      return `/me/calendarView/delta?startDateTime=${since.toISOString()}&endDateTime=${end.toISOString()}`;
    },
    { Prefer: `${PAGE}, outlook.timezone="UTC"` },
    (e) =>
      e.isCancelled
        ? null
        : {
            externalId: `event:${e.id}`,
            kind: "event",
            title: e.subject ?? "(no title)",
            author: person(e.organizer),
            url: e.webLink,
            occurredAt: date(e.start?.dateTime ? `${e.start.dateTime}Z` : undefined),
            contentText: e.bodyPreview,
            metadata: {
              start: e.start?.dateTime,
              end: e.end?.dateTime,
              location: e.location?.displayName,
              organizer: e.organizer?.emailAddress?.address,
              attendees: addresses(e.attendees),
            },
          },
  ),
};

interface DriveItem {
  id: string;
  parentReference?: { id?: string; name?: string };
  name?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string; email?: string } };
  file?: { mimeType?: string };
  folder?: unknown;
  deleted?: unknown;
  size?: number;
}

/**
 * OneDrive files, as metadata with their folder (which owners can map to a client on the Routing
 * page). Contents are read later, only for files routed to a client.
 */
const filesStream: Stream = {
  name: "files",
  step: async (client, cursor, ctx) => {
    const step = await deltaStep<DriveItem>(
      () => `/me/drive/root/delta?$select=id,name,webUrl,lastModifiedDateTime,lastModifiedBy,file,folder,deleted,size,parentReference`,
      { Prefer: PAGE },
      (f) =>
        f.folder || f.deleted || !f.file
          ? null
          : {
              externalId: `file:${f.id}`,
              kind: "document",
              title: f.name,
              author: f.lastModifiedBy?.user?.displayName,
              url: f.webUrl,
              occurredAt: date(f.lastModifiedDateTime),
              metadata: {
                modifiedBy: f.lastModifiedBy?.user?.email,
                ...fileMetadata({ kind: "onedrive", itemId: f.id }, { mimeType: f.file.mimeType, size: f.size }),
              },
              container: f.parentReference?.id
                ? { id: `folder:${f.parentReference.id}`, label: `OneDrive › ${f.parentReference.name ?? "Folder"}` }
                : undefined,
            },
    )(client, cursor, ctx);
    // The first delta lists the whole drive; keep only files touched inside the window.
    return { ...step, items: step.items.filter((i) => i.occurredAt >= ctx.since) };
  },
};

interface ChatMessage {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  webUrl?: string;
  from?: { user?: { displayName?: string; id?: string } };
  body?: { content?: string; contentType?: string };
  attachments?: { contentType?: string; contentUrl?: string; name?: string }[];
}

type ChatsCursor = {
  phase: "list" | "messages";
  chatsNext?: string;
  queue: { id: string; topic?: string }[];
  index: number;
  messagesNext?: string;
  /** Newest lastModifiedDateTime seen per chat; messages at or before it are already synced. */
  watermarks: Record<string, string>;
  pending?: string;
};

/** Teams 1:1 and group chats: list the chats, then read each one's new messages. */
const chatsStream: Stream = {
  name: "teams_chats",
  step: async (client, raw, ctx) => {
    const cursor: ChatsCursor = (raw as ChatsCursor | undefined) ?? { phase: "list", queue: [], index: 0, watermarks: {} };

    if (cursor.phase === "list") {
      const page = await client.json<GraphPage<{ id: string; topic?: string }>>(cursor.chatsNext ?? "/me/chats?$top=50");
      const queue = [...cursor.queue, ...page.value.map((c) => ({ id: c.id, topic: c.topic }))];
      const next = page["@odata.nextLink"];
      if (next) return { items: [], cursor: { ...cursor, chatsNext: next, queue }, more: true };
      if (queue.length === 0) return { items: [], cursor: { phase: "list", queue: [], index: 0, watermarks: cursor.watermarks }, more: false };
      return { items: [], cursor: { ...cursor, phase: "messages", chatsNext: undefined, queue, index: 0 }, more: true };
    }

    const chat = cursor.queue[cursor.index];
    if (!chat) return { items: [], cursor: { ...cursor, phase: "list", queue: [], index: 0 }, more: false };
    const since = cursor.watermarks[chat.id] ?? ctx.since.toISOString();
    const page = await client.json<GraphPage<ChatMessage>>(
      cursor.messagesNext ??
        `/me/chats/${encodeURIComponent(chat.id)}/messages?$top=50&$orderby=lastModifiedDateTime desc&$filter=lastModifiedDateTime gt ${since}`,
    );
    let pending = cursor.pending;
    const items: SourceItemInput[] = [];
    for (const m of page.value) {
      if (m.lastModifiedDateTime && (!pending || m.lastModifiedDateTime > pending)) pending = m.lastModifiedDateTime;
      if (m.messageType && m.messageType !== "message") continue;
      const message: SourceItemInput = {
        externalId: `chat:${chat.id}:${m.id}`,
        kind: "message",
        title: chat.topic ?? "Teams chat",
        author: m.from?.user?.displayName,
        url: m.webUrl,
        occurredAt: date(m.createdDateTime),
        contentText: m.body?.contentType === "html" ? htmlToText(m.body.content ?? "") : clip(m.body?.content ?? ""),
        metadata: { chatId: chat.id, userId: m.from?.user?.id },
      };
      items.push(message);
      // Files shared in a chat are OneDrive or SharePoint links ("reference" attachments).
      for (const a of m.attachments ?? []) {
        if (a.contentType !== "reference" || !a.contentUrl || findFileLinks(a.contentUrl).length === 0) continue;
        items.push({
          externalId: `msfile:${createHash("sha256").update(a.contentUrl).digest("hex").slice(0, 32)}`,
          kind: "document",
          title: a.name,
          author: message.author,
          url: a.contentUrl,
          occurredAt: message.occurredAt,
          metadata: { ...message.metadata, parent: message.externalId, ...fileMetadata({ kind: "ms-share", url: a.contentUrl }, {}) },
        });
      }
    }
    const next = page["@odata.nextLink"];
    if (next) return { items, cursor: { ...cursor, messagesNext: next, pending }, more: true };

    const watermarks = pending ? { ...cursor.watermarks, [chat.id]: pending } : cursor.watermarks;
    const index = cursor.index + 1;
    const done = index >= cursor.queue.length;
    return {
      items,
      cursor: done
        ? { phase: "list", queue: [], index: 0, watermarks }
        : { ...cursor, index, messagesNext: undefined, pending: undefined, watermarks },
      more: !done,
    };
  },
};

export const microsoft: ProviderDefinition = {
  id: "microsoft",
  name: "Microsoft 365",
  scope: "personal",
  reads: "Your Outlook mail and attachments, calendar, OneDrive and SharePoint files, and Teams chats. Sends only emails you approve.",
  oauth: {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // Mail.Send lets Kept send emails a person approved, from their own mailbox.
    // Files.Read.All and Sites.Read.All: files shared with the person and SharePoint documents linked in conversations.
    scopes: ["offline_access", "openid", "email", "User.Read", "Mail.Read", "Mail.Send", "Calendars.Read", "Files.Read.All", "Sites.Read.All", "Chat.Read"],
    extraAuthorizeParams: { prompt: "select_account" },
    clientAuth: "body",
    bodyFormat: "form",
  },
  apiBase: "https://graph.microsoft.com/v1.0",
  parseToken: (raw) => standardToken(raw),
  async identify(client) {
    const me = await client.json<{ id: string; mail?: string; userPrincipalName?: string }>(
      "/me?$select=id,mail,userPrincipalName",
    );
    return { externalAccountId: me.id, label: me.mail ?? me.userPrincipalName ?? me.id };
  },
  streams: [mailStream("inbox"), mailStream("sentitems"), calendarStream, filesStream, chatsStream],
};

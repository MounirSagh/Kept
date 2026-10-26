// Slack, connected once per workspace as a bot. The bot only reads channels it has been
// added to (invite @Kept to a channel), which keeps what Kept sees explicit. Thread replies
// are read too, each with an excerpt of the message it answers.

import { fileMetadata } from "../files.js";
import { ApiError, type ApiClient } from "../http.js";
import { standardToken } from "../oauth.js";
import { clip, date } from "../text.js";
import type { ProviderDefinition, SourceItemInput, Stream } from "../types.js";

type SlackResponse = { ok: boolean; error?: string; response_metadata?: { next_cursor?: string } };

/** Slack answers HTTP 200 with ok:false on errors. */
async function slack<T extends SlackResponse>(client: ApiClient, method: string, query: Record<string, string | number | undefined>): Promise<T> {
  const res = await client.json<T>(`/${method}`, { query });
  if (!res.ok) throw new ApiError(400, res.error ?? "unknown_error", `https://slack.com/api/${method}`);
  return res;
}

interface SlackMessage {
  ts: string;
  user?: string;
  username?: string;
  text?: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
  files?: SlackFile[];
}

interface SlackFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
  permalink?: string;
  /** "hidden_by_limit" or "tombstone" when the file isn't available. */
  mode?: string;
}

/**
 * The files shared with a message, as document items routed by the same channel. Their contents
 * are downloaded (files:read) only if the channel belongs to a client.
 */
function fileItems(m: SlackMessage, message: SourceItemInput, channel: { id: string; name: string }): SourceItemInput[] {
  return (m.files ?? [])
    .filter((f) => f.url_private_download && f.mode !== "hidden_by_limit" && f.mode !== "tombstone")
    .map((f) => ({
      externalId: `slack-file:${f.id}`,
      kind: "document" as const,
      title: f.name ?? f.title,
      author: message.author,
      url: f.permalink,
      occurredAt: message.occurredAt,
      metadata: {
        channel: channel.id,
        parent: message.externalId,
        ...fileMetadata({ kind: "slack-file", url: f.url_private_download! }, { mimeType: f.mimetype, size: f.size }),
      },
      container: { id: channel.id, label: `#${channel.name}` },
    }));
}

/** "[Shared file: MSA.pdf]" appended to a message, so the model knows a file came with it. */
const sharedFiles = (m: SlackMessage) => (m.files?.length ? `\n\n[Shared file: ${m.files.map((f) => f.name ?? f.title).join(", ")}]` : "");

/** A thread being followed: the last reply synced, the start of its parent, and its last activity (ms). */
type Thread = { seen: string; parent: string; active: number };

/** Threads stay followed this long after their last reply; a reply to an older thread isn't picked up. */
const THREAD_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Threads followed per channel, most recently active first: each costs one API call per sync. */
const MAX_THREADS_PER_CHANNEL = 50;
/** How much of the parent message a reply carries as context. */
const PARENT_EXCERPT_CHARS = 300;

/** Joins, topic changes and similar system messages carry no commitments. */
const KEPT_SUBTYPES = new Set([undefined, "bot_message", "thread_broadcast", "file_share"]);

type ChannelsCursor = {
  phase: "list" | "history";
  listCursor?: string;
  queue: { id: string; name: string }[];
  index: number;
  historyCursor?: string;
  /** Latest message ts synced per channel (Slack ts strings sort as numbers). */
  watermarks: Record<string, string>;
  pending?: string;
  /** Display names by Slack user id, so each person is looked up once. */
  people?: Record<string, string>;
  /** Email addresses by Slack user id (users:read.email), "" when Slack has none (bots). */
  emails?: Record<string, string>;
  /**
   * Threads to check for new replies, keyed "<channel>/<thread ts>". A reply doesn't bring an old
   * thread back into the channel's history, so threads are followed for a while after their last reply.
   */
  threads?: Record<string, Thread>;
};

/**
 * Slack's message markup: mentions become @Name, links keep their label (or URL), and the three
 * characters Slack escapes are restored. Escapes go last so "&lt;@U1&gt;" typed by a person stays text.
 */
function slackToText(text: string, name: (id: string) => string): string {
  return text
    .replace(MENTION, (_all, id: string) => `@${name(id)}`)
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** <@U0123ABC> or <@U0123ABC|name>: how Slack writes a mention in message text. */
const MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

/** Who a Slack user id is: names for people and the model to read, emails for routing. */
type Directory = { people: Record<string, string>; emails: Record<string, string> };

/**
 * Names (users:read) and emails (users:read.email) for the given user ids. Messages carry only ids,
 * which mean nothing to a person or to the model reading them; the email lets a message from a
 * client's contact (a Slack Connect channel) route itself. A lookup that fails leaves the id as it is.
 */
async function resolvePeople(client: ApiClient, ids: Iterable<string>, known: Directory): Promise<Directory> {
  const people = { ...known.people };
  const emails = { ...known.emails };
  for (const id of new Set(ids)) {
    // Looked up before the email was asked for: once more, for the email.
    if (people[id] && id in emails) continue;
    try {
      const res = await slack<SlackResponse & { user?: { name?: string; real_name?: string; profile?: { real_name?: string; display_name?: string; email?: string } } }>(
        client,
        "users.info",
        { user: id },
      );
      const u = res.user;
      const name = u?.profile?.real_name || u?.real_name || u?.profile?.display_name || u?.name;
      if (name) people[id] = name;
      emails[id] = u?.profile?.email?.toLowerCase() ?? "";
    } catch {
      // Deleted or external users can fail to resolve; the id stays.
    }
  }
  return { people, emails };
}

/**
 * New replies in one channel's followed threads. Each reply becomes an item that starts with an
 * excerpt of the message it answers, so "done, sent it" can be tied to what was promised.
 * Threads quiet for THREAD_TTL_MS are dropped, except on first sight: an old thread is read once.
 */
async function syncThreads(
  client: ApiClient,
  channel: { id: string; name: string },
  all: Record<string, Thread>,
  known: Directory,
  now: number,
): Promise<{ items: SourceItemInput[]; threads: Record<string, Thread>; directory: Directory }> {
  const prefix = `${channel.id}/`;
  const others = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(prefix)));
  const mine = Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .sort(([, a], [, b]) => b.active - a.active)
    .slice(0, MAX_THREADS_PER_CHANNEL);

  let directory = known;
  const items: SourceItemInput[] = [];
  const kept: Record<string, Thread> = {};
  for (const [key, thread] of mine) {
    const threadTs = key.slice(prefix.length);
    const neverRead = thread.seen === threadTs;
    if (!neverRead && thread.active < now - THREAD_TTL_MS) continue;

    const res = await slack<SlackResponse & { messages: SlackMessage[] }>(client, "conversations.replies", {
      channel: channel.id,
      ts: threadTs,
      oldest: thread.seen,
      limit: 200,
    });
    const fresh = res.messages.filter((m) => m.ts !== threadTs && Number(m.ts) > Number(thread.seen) && KEPT_SUBTYPES.has(m.subtype) && (m.text || m.files?.length));
    directory = await resolvePeople(client, fresh.flatMap((m) => [...(m.user ? [m.user] : []), ...[...(m.text ?? "").matchAll(MENTION)].map((x) => x[1]!)]), directory);
    const { people, emails } = directory;
    const name = (id: string) => people[id] ?? id;

    let seen = thread.seen;
    for (const m of fresh) {
      if (Number(m.ts) > Number(seen)) seen = m.ts;
      const reply: SourceItemInput = {
        externalId: `slack:${channel.id}:${m.ts}`,
        kind: "message",
        title: `#${channel.name} (thread)`,
        author: m.user ? name(m.user) : m.username,
        occurredAt: date(Number(m.ts) * 1000),
        contentText: clip(`In reply to: "${thread.parent}"\n\n${slackToText(m.text ?? "", name)}${sharedFiles(m)}`),
        metadata: { channel: channel.id, channelName: channel.name, ts: m.ts, threadTs, user: m.user, authorEmail: (m.user && emails[m.user]) || undefined, reply: true },
        container: { id: channel.id, label: `#${channel.name}` },
      };
      items.push(reply, ...fileItems(m, reply, channel));
    }
    const active = Math.max(thread.active, Number(seen) * 1000);
    // Followed while it's active; an old thread read for the first time isn't kept.
    if (active >= now - THREAD_TTL_MS) kept[key] = { ...thread, seen, active };
  }
  return { items, threads: { ...others, ...kept }, directory };
}

const channelsStream: Stream = {
  name: "channels",
  async step(client, raw, ctx) {
    const cursor: ChannelsCursor = (raw as ChannelsCursor | undefined) ?? { phase: "list", queue: [], index: 0, watermarks: {} };

    if (cursor.phase === "list") {
      const page = await slack<SlackResponse & { channels: { id: string; name: string; is_member?: boolean }[] }>(
        client,
        "conversations.list",
        { types: "public_channel,private_channel", exclude_archived: "true", limit: 200, cursor: cursor.listCursor },
      );
      const queue = [...cursor.queue, ...page.channels.filter((c) => c.is_member).map((c) => ({ id: c.id, name: c.name }))];
      const next = page.response_metadata?.next_cursor;
      if (next) return { items: [], cursor: { ...cursor, listCursor: next, queue }, more: true };
      if (queue.length === 0) return { items: [], cursor: { phase: "list", queue: [], index: 0, watermarks: cursor.watermarks, people: cursor.people, emails: cursor.emails, threads: cursor.threads }, more: false };
      return { items: [], cursor: { ...cursor, phase: "history", listCursor: undefined, queue, index: 0 }, more: true };
    }

    const channel = cursor.queue[cursor.index];
    if (!channel) return { items: [], cursor: { phase: "list", queue: [], index: 0, watermarks: cursor.watermarks, people: cursor.people, emails: cursor.emails, threads: cursor.threads }, more: false };
    const oldest = cursor.watermarks[channel.id] ?? String(ctx.since.getTime() / 1000);
    const page = await slack<SlackResponse & { messages: SlackMessage[]; has_more?: boolean }>(client, "conversations.history", {
      channel: channel.id,
      oldest,
      limit: 200,
      cursor: cursor.historyCursor,
    });

    let pending = cursor.pending;
    const kept = page.messages.filter((m) => KEPT_SUBTYPES.has(m.subtype) && (m.text || m.files?.length));
    const ids = kept.flatMap((m) => [...(m.user ? [m.user] : []), ...[...(m.text ?? "").matchAll(MENTION)].map((x) => x[1]!)]);
    const directory = await resolvePeople(client, ids, { people: cursor.people ?? {}, emails: cursor.emails ?? {} });
    const { people, emails } = directory;
    const name = (id: string) => people[id] ?? id;

    const threads = { ...(cursor.threads ?? {}) };
    const items: SourceItemInput[] = [];
    for (const m of page.messages) {
      if (!pending || Number(m.ts) > Number(pending)) pending = m.ts;
      if (!KEPT_SUBTYPES.has(m.subtype) || !(m.text || m.files?.length)) continue;
      // A message with replies starts a thread to follow.
      if ((m.reply_count ?? 0) > 0 && (m.thread_ts ?? m.ts) === m.ts) {
        const key = `${channel.id}/${m.ts}`;
        threads[key] = {
          seen: threads[key]?.seen ?? m.ts,
          parent: slackToText(m.text ?? "", name).replace(/\s+/g, " ").slice(0, PARENT_EXCERPT_CHARS),
          active: Math.max(threads[key]?.active ?? 0, Number(m.latest_reply ?? m.ts) * 1000),
        };
      }
      const message: SourceItemInput = {
        externalId: `slack:${channel.id}:${m.ts}`,
        kind: "message",
        title: `#${channel.name}`,
        author: m.user ? name(m.user) : m.username,
        occurredAt: date(Number(m.ts) * 1000),
        contentText: clip(slackToText(m.text ?? "", name) + sharedFiles(m)),
        metadata: {
          channel: channel.id, channelName: channel.name, ts: m.ts, threadTs: m.thread_ts, user: m.user,
          authorEmail: (m.user && emails[m.user]) || undefined, replies: m.reply_count ?? 0,
        },
        container: { id: channel.id, label: `#${channel.name}` },
      };
      items.push(message, ...fileItems(m, message, channel));
    }
    const next = page.response_metadata?.next_cursor;
    if (next) return { items, cursor: { ...cursor, historyCursor: next, pending, people, emails, threads }, more: true };

    // The channel's history is done: collect new replies in its followed threads.
    const replies = await syncThreads(client, channel, threads, directory, ctx.now.getTime());
    items.push(...replies.items);
    const followed = replies.threads;
    const known = replies.directory;

    const watermarks = pending ? { ...cursor.watermarks, [channel.id]: pending } : cursor.watermarks;
    const index = cursor.index + 1;
    const done = index >= cursor.queue.length;
    return {
      items,
      cursor: done
        ? { phase: "list", queue: [], index: 0, watermarks, people: known.people, emails: known.emails, threads: followed }
        : { ...cursor, index, historyCursor: undefined, pending: undefined, watermarks, people: known.people, emails: known.emails, threads: followed },
      more: !done,
    };
  },
};

export const slackProvider: ProviderDefinition = {
  id: "slack",
  name: "Slack",
  scope: "org",
  reads: "Messages in the channels you add the Kept app to.",
  oauth: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    // files:read downloads files shared in channels routed to a client; users:read.email routes a
    // client contact's messages (Slack Connect) by their address.
    scopes: ["channels:read", "channels:history", "groups:read", "groups:history", "users:read", "users:read.email", "team:read", "files:read"],
    scopeSeparator: ",",
    clientAuth: "body",
    bodyFormat: "form",
  },
  apiBase: "https://slack.com/api",
  // The bot token is the top-level access_token; it doesn't expire unless token rotation is on.
  parseToken: (raw) => standardToken(raw),
  async identify(_client, raw) {
    const team = raw.team as { id?: string; name?: string } | undefined;
    if (!team?.id) throw new Error("Slack did not report a workspace");
    return { externalAccountId: team.id, label: team.name ?? team.id };
  },
  streams: [channelsStream],
};

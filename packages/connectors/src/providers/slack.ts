// Slack, connected once per workspace as a bot. The bot only reads channels it has been
// added to (invite @Kept to a channel), which keeps what Kept sees explicit. Thread
// replies are not read yet; thread starters and broadcast replies are.

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
}

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

/**
 * Names for the given user ids (users:read). Messages carry only ids, which mean nothing to a
 * person or to the model reading them. A lookup that fails leaves the id as it is.
 */
async function resolvePeople(client: ApiClient, ids: Iterable<string>, known: Record<string, string>) {
  const people = { ...known };
  for (const id of new Set(ids)) {
    if (people[id]) continue;
    try {
      const res = await slack<SlackResponse & { user?: { name?: string; real_name?: string; profile?: { real_name?: string; display_name?: string } } }>(
        client,
        "users.info",
        { user: id },
      );
      const u = res.user;
      const name = u?.profile?.real_name || u?.real_name || u?.profile?.display_name || u?.name;
      if (name) people[id] = name;
    } catch {
      // Deleted or external users can fail to resolve; the id stays.
    }
  }
  return people;
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
      if (queue.length === 0) return { items: [], cursor: { phase: "list", queue: [], index: 0, watermarks: cursor.watermarks, people: cursor.people }, more: false };
      return { items: [], cursor: { ...cursor, phase: "history", listCursor: undefined, queue, index: 0 }, more: true };
    }

    const channel = cursor.queue[cursor.index];
    if (!channel) return { items: [], cursor: { phase: "list", queue: [], index: 0, watermarks: cursor.watermarks, people: cursor.people }, more: false };
    const oldest = cursor.watermarks[channel.id] ?? String(ctx.since.getTime() / 1000);
    const page = await slack<SlackResponse & { messages: SlackMessage[]; has_more?: boolean }>(client, "conversations.history", {
      channel: channel.id,
      oldest,
      limit: 200,
      cursor: cursor.historyCursor,
    });

    let pending = cursor.pending;
    const kept = page.messages.filter((m) => KEPT_SUBTYPES.has(m.subtype) && m.text);
    const ids = kept.flatMap((m) => [...(m.user ? [m.user] : []), ...[...m.text!.matchAll(MENTION)].map((x) => x[1]!)]);
    const people = await resolvePeople(client, ids, cursor.people ?? {});
    const name = (id: string) => people[id] ?? id;

    const items: SourceItemInput[] = [];
    for (const m of page.messages) {
      if (!pending || Number(m.ts) > Number(pending)) pending = m.ts;
      if (!KEPT_SUBTYPES.has(m.subtype) || !m.text) continue;
      items.push({
        externalId: `slack:${channel.id}:${m.ts}`,
        kind: "message",
        title: `#${channel.name}`,
        author: m.user ? name(m.user) : m.username,
        occurredAt: date(Number(m.ts) * 1000),
        contentText: clip(slackToText(m.text, name)),
        metadata: { channel: channel.id, channelName: channel.name, ts: m.ts, threadTs: m.thread_ts, user: m.user, replies: m.reply_count ?? 0 },
        container: { id: channel.id, label: `#${channel.name}` },
      });
    }
    const next = page.response_metadata?.next_cursor;
    if (next) return { items, cursor: { ...cursor, historyCursor: next, pending, people }, more: true };

    const watermarks = pending ? { ...cursor.watermarks, [channel.id]: pending } : cursor.watermarks;
    const index = cursor.index + 1;
    const done = index >= cursor.queue.length;
    return {
      items,
      cursor: done
        ? { phase: "list", queue: [], index: 0, watermarks, people }
        : { ...cursor, index, historyCursor: undefined, pending: undefined, watermarks, people },
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
    scopes: ["channels:read", "channels:history", "groups:read", "groups:history", "users:read", "team:read"],
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

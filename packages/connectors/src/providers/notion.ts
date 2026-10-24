// Notion, connected once per workspace: the pages the connecting user shares with Kept
// in Notion's consent screen. Reads each page's top-level text blocks.

import type { ApiClient } from "../http.js";
import { standardToken } from "../oauth.js";
import { clip, date } from "../text.js";
import type { ProviderDefinition, SourceItemInput, Stream } from "../types.js";

type RichText = { plain_text?: string }[];
interface Page {
  id: string;
  url?: string;
  created_time?: string;
  last_edited_time: string;
  last_edited_by?: { id?: string };
  archived?: boolean;
  in_trash?: boolean;
  parent?: Record<string, unknown>;
  properties?: Record<string, { type?: string; title?: RichText }>;
}

const plain = (rt?: RichText) => (rt ?? []).map((t) => t.plain_text ?? "").join("");

/** The page's parent (page, database or workspace): the unit owners map to an account. */
function parentContainer(page: Page): { id: string; label: string } {
  const parent = page.parent ?? {};
  const type = String(parent.type ?? "workspace");
  const id = typeof parent[type] === "string" ? (parent[type] as string) : type;
  const label = type === "workspace" ? "Workspace (top level)" : `${type.replace("_id", "").replace("_", " ")} ${id.slice(0, 8)}`;
  return { id: `${type}:${id}`, label };
}

function pageTitle(page: Page): string {
  for (const prop of Object.values(page.properties ?? {})) if (prop.type === "title") return plain(prop.title) || "Untitled";
  return "Untitled";
}

const TEXT_BLOCKS = new Set([
  "paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item",
  "to_do", "quote", "callout", "toggle",
]);

/** Text of the page's top-level blocks (first 100). Nested blocks are not read yet. */
async function pageText(client: ApiClient, pageId: string): Promise<string> {
  const res = await client.json<{ results: ({ type: string } & Record<string, { rich_text?: RichText; checked?: boolean }>)[] }>(
    `/v1/blocks/${pageId}/children`,
    { query: { page_size: 100 } },
  );
  return res.results
    .filter((b) => TEXT_BLOCKS.has(b.type))
    .map((b) => {
      const block = b[b.type];
      const text = plain(block?.rich_text);
      return b.type === "to_do" ? `[${block?.checked ? "x" : " "}] ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

type PagesCursor = { watermark?: string; startCursor?: string; maxSeen?: string };

/** Notion's search sorts by last edit, newest first: page until reaching already-synced edits. */
const pagesStream: Stream = {
  name: "pages",
  async step(client, raw, ctx) {
    const cursor = (raw as PagesCursor | undefined) ?? {};
    const watermark = cursor.watermark ?? ctx.since.toISOString();
    const res = await client.json<{ results: Page[]; has_more: boolean; next_cursor?: string | null }>("/v1/search", {
      body: {
        filter: { property: "object", value: "page" },
        sort: { timestamp: "last_edited_time", direction: "descending" },
        page_size: 25,
        start_cursor: cursor.startCursor,
      },
    });

    let maxSeen = cursor.maxSeen;
    let reachedSynced = false;
    const items: SourceItemInput[] = [];
    for (const page of res.results) {
      if (page.last_edited_time <= watermark) {
        reachedSynced = true;
        break;
      }
      if (!maxSeen || page.last_edited_time > maxSeen) maxSeen = page.last_edited_time;
      if (page.archived || page.in_trash) continue;
      items.push({
        externalId: `notion:${page.id}`,
        kind: "document",
        title: pageTitle(page),
        author: page.last_edited_by?.id,
        url: page.url,
        occurredAt: date(page.last_edited_time),
        contentText: clip(await pageText(client, page.id)),
        metadata: { createdAt: page.created_time, parent: page.parent },
        container: parentContainer(page),
      });
    }
    if (!reachedSynced && res.has_more && res.next_cursor) {
      return { items, cursor: { watermark, startCursor: res.next_cursor, maxSeen }, more: true };
    }
    return { items, cursor: { watermark: maxSeen ?? watermark }, more: false };
  },
};

export const notion: ProviderDefinition = {
  id: "notion",
  name: "Notion",
  scope: "org",
  reads: "The Notion pages you share with Kept.",
  oauth: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    extraAuthorizeParams: { owner: "user" },
    clientAuth: "basic",
    bodyFormat: "json",
  },
  apiBase: "https://api.notion.com",
  apiHeaders: { "Notion-Version": "2022-06-28" },
  parseToken: (raw) => standardToken(raw),
  async identify(_client, raw) {
    const id = raw.workspace_id;
    if (typeof id !== "string") throw new Error("Notion did not report a workspace");
    return { externalAccountId: id, label: typeof raw.workspace_name === "string" ? raw.workspace_name : id };
  },
  streams: [pagesStream],
};

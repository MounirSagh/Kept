// Linear, connected once per workspace: issues and their comments, via the GraphQL API.

import { ApiError, type ApiClient } from "../http.js";
import { standardToken } from "../oauth.js";
import { clip, date } from "../text.js";
import type { ProviderDefinition, SourceItemInput, Stream } from "../types.js";

async function graphql<T>(client: ApiClient, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await client.json<{ data?: T; errors?: { message: string }[] }>("/graphql", { body: { query, variables } });
  if (res.errors?.length || !res.data) {
    throw new ApiError(400, res.errors?.map((e) => e.message).join("; ") ?? "no data", "https://api.linear.app/graphql");
  }
  return res.data;
}

type Person = { name?: string; email?: string } | null;
interface Issue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string | null;
  creator?: Person;
  assignee?: Person;
  state?: { name: string; type: string } | null;
  team?: { key: string; name: string } | null;
  labels?: { nodes: { name: string }[] };
  comments?: { nodes: { body: string; createdAt: string; user?: Person }[] };
}

const ISSUES = `query Issues($after: String, $since: DateTimeOrDuration!) {
  issues(first: 50, after: $after, orderBy: updatedAt, filter: { updatedAt: { gt: $since } }) {
    nodes {
      id identifier title description url createdAt updatedAt dueDate
      creator { name email } assignee { name email }
      state { name type } team { key name } labels { nodes { name } }
      comments(first: 50) { nodes { body createdAt user { name email } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export function mapIssue(i: Issue): SourceItemInput {
  const comments = (i.comments?.nodes ?? [])
    .map((c) => `${c.user?.name ?? "Someone"} (${c.createdAt}): ${c.body}`)
    .join("\n\n");
  return {
    externalId: `linear:${i.id}`,
    kind: "ticket",
    title: `${i.identifier} ${i.title}`,
    author: i.creator?.name ?? i.creator?.email,
    url: i.url,
    occurredAt: date(i.createdAt),
    contentText: clip([i.description ?? "", comments].filter(Boolean).join("\n\n---\n\n")),
    metadata: {
      identifier: i.identifier,
      state: i.state?.name,
      stateType: i.state?.type,
      team: i.team?.key,
      assignee: i.assignee?.email ?? i.assignee?.name,
      dueDate: i.dueDate,
      updatedAt: i.updatedAt,
      labels: (i.labels?.nodes ?? []).map((l) => l.name),
    },
    container: i.team ? { id: i.team.key, label: i.team.name } : undefined,
  };
}

type IssuesCursor = { watermark?: string; after?: string; maxSeen?: string };

const issuesStream: Stream = {
  name: "issues",
  async step(client, raw, ctx) {
    const cursor = (raw as IssuesCursor | undefined) ?? {};
    const since = cursor.watermark ?? ctx.since.toISOString();
    const data = await graphql<{ issues: { nodes: Issue[]; pageInfo: { hasNextPage: boolean; endCursor?: string } } }>(client, ISSUES, {
      after: cursor.after,
      since,
    });
    let maxSeen = cursor.maxSeen;
    for (const i of data.issues.nodes) if (!maxSeen || i.updatedAt > maxSeen) maxSeen = i.updatedAt;
    const items = data.issues.nodes.map(mapIssue);
    if (data.issues.pageInfo.hasNextPage) {
      return { items, cursor: { watermark: since, after: data.issues.pageInfo.endCursor, maxSeen }, more: true };
    }
    return { items, cursor: { watermark: maxSeen ?? since }, more: false };
  },
};

export const linear: ProviderDefinition = {
  id: "linear",
  name: "Linear",
  scope: "org",
  reads: "Issues and comments across your Linear workspace.",
  oauth: {
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: ["read"],
    scopeSeparator: ",",
    extraAuthorizeParams: { prompt: "consent" },
    clientAuth: "body",
    bodyFormat: "form",
  },
  apiBase: "https://api.linear.app",
  parseToken: (raw) => standardToken(raw),
  async identify(client) {
    const data = await graphql<{ organization: { id: string; name: string } }>(client, "{ organization { id name } }");
    return { externalAccountId: data.organization.id, label: data.organization.name };
  },
  streams: [issuesStream],
};

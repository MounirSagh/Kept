import { ApiClient } from "../src/http.js";
import type { ProviderDefinition, SourceItemInput, SyncContext } from "../src/types.js";
import { runSync, type SyncState } from "../src/sync.js";

export type Route = {
  method?: string;
  /** Matches when the URL (path + query) contains every one of these strings. */
  match: string[];
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** Respond only this many times, then fall through to later routes. */
  times?: number;
};

export function fakeFetch(routes: Route[]) {
  const calls: { method: string; url: string; body?: string; headers: Record<string, string> }[] = [];
  const used = new Map<Route, number>();
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    // Query strings may encode spaces as %20 or +; match against the decoded, space-normalized URL.
    const readable = decodeURIComponent(url.replace(/\+/g, " "));
    calls.push({ method, url: readable, body: init?.body as string | undefined, headers });
    const route = routes.find(
      (r) =>
        (!r.method || r.method === method) &&
        r.match.every((m) => readable.includes(m)) &&
        (r.times === undefined || (used.get(r) ?? 0) < r.times),
    );
    if (!route) return new Response(`no fake route for ${method} ${url}`, { status: 599 });
    used.set(route, (used.get(route) ?? 0) + 1);
    const body = route.text ?? JSON.stringify(route.json ?? {});
    return new Response(body, { status: route.status ?? 200, headers: route.headers });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function client(def: ProviderDefinition, f: typeof fetch) {
  return new ApiClient({ baseUrl: def.apiBase, headers: def.apiHeaders, getAccessToken: async () => "token", fetch: f, sleep: async () => {} });
}

export const ctx: SyncContext = { since: new Date("2026-07-12T00:00:00Z"), now: new Date("2026-10-10T00:00:00Z") };

/** Runs a full sync and returns every item plus the final state. */
export async function sync(def: ProviderDefinition, f: typeof fetch, state: SyncState = {}) {
  const items: SourceItemInput[] = [];
  const result = await runSync(def, client(def, f), state, ctx, { onPage: async (p) => void items.push(...p.items) });
  return { items, state: result.state, complete: result.complete };
}

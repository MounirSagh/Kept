// HTTP client shared by every connector: bearer auth, one token refresh on 401,
// and retries with backoff on 429 / 5xx (honouring Retry-After).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    url: string,
  ) {
    super(`${status} from ${url}: ${body.slice(0, 300)}`);
  }
}

/** The connection's grant is gone (revoked, expired refresh token): the user must reconnect. */
export class AuthError extends Error {}

type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST";
  query?: Query;
  /** Sent as JSON unless `form` is set. */
  body?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ApiClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  getAccessToken(): Promise<string>;
  /** Refreshes the token after a 401. Returns false when the grant can't be refreshed. */
  refresh?(): Promise<boolean>;
  fetch?: typeof fetch;
  maxRetries?: number;
  /** Injectable for tests. */
  sleep?(ms: number): Promise<void>;
}

export class ApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async json<T>(pathOrUrl: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.raw(pathOrUrl, opts);
    return (await res.json()) as T;
  }

  async text(pathOrUrl: string, opts: RequestOptions = {}): Promise<string> {
    return (await this.raw(pathOrUrl, opts)).text();
  }

  async raw(pathOrUrl: string, opts: RequestOptions = {}): Promise<Response> {
    const url = buildUrl(this.opts.baseUrl, pathOrUrl, opts.query);
    const maxRetries = this.opts.maxRetries ?? 4;
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...this.opts.headers,
        ...opts.headers,
        Authorization: `Bearer ${await this.opts.getAccessToken()}`,
      };
      let body: string | undefined;
      if (opts.form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(opts.form).toString();
      } else if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.body);
      }

      let res: Response;
      try {
        res = await this.fetchFn(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        await this.sleep(backoff(attempt));
        continue;
      }

      if (res.ok) return res;

      if (res.status === 401 && !refreshed && this.opts.refresh) {
        refreshed = true;
        if (await this.opts.refresh()) continue;
        throw new AuthError(`Access was revoked or expired for ${new URL(url).host}`);
      }
      if (res.status === 401) throw new AuthError(`Unauthorized at ${new URL(url).host}`);

      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await this.sleep(retryAfter(res) ?? backoff(attempt));
        continue;
      }
      throw new ApiError(res.status, await res.text(), url);
    }
  }
}

function buildUrl(base: string, pathOrUrl: string, query?: Query): string {
  const url = new URL(/^https?:\/\//.test(pathOrUrl) ? pathOrUrl : base.replace(/\/$/, "") + pathOrUrl);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  return url.toString();
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

function retryAfter(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(60_000, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.min(60_000, date - Date.now())) : undefined;
}

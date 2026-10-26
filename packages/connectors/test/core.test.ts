import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { ApiClient, ApiError, AuthError } from "../src/http.js";
import { decryptToken, encryptToken, signState, verifyState } from "../src/crypto.js";
import { authorizeUrl, exchangeCode, OAuthError, refreshTokens } from "../src/oauth.js";
import { PROVIDERS } from "../src/registry.js";
import { fakeFetch } from "./fake.js";

describe("ApiClient", () => {
  const make = (f: typeof fetch, refresh?: () => Promise<boolean>) => {
    const sleeps: number[] = [];
    const c = new ApiClient({ baseUrl: "https://api.test", getAccessToken: async () => "t", refresh, fetch: f, sleep: async (ms) => void sleeps.push(ms) });
    return { c, sleeps };
  };

  it("retries 429 after Retry-After, then succeeds", async () => {
    const { fetch } = fakeFetch([
      { match: ["/x"], status: 429, headers: { "retry-after": "2" }, times: 1 },
      { match: ["/x"], json: { ok: 1 } },
    ]);
    const { c, sleeps } = make(fetch);
    expect(await c.json("/x")).toEqual({ ok: 1 });
    expect(sleeps).toEqual([2000]);
  });

  it("refreshes once on 401 and retries", async () => {
    const { fetch } = fakeFetch([{ match: ["/x"], status: 401, times: 1 }, { match: ["/x"], json: { ok: 1 } }]);
    let refreshed = 0;
    const { c } = make(fetch, async () => (refreshed++, true));
    expect(await c.json("/x")).toEqual({ ok: 1 });
    expect(refreshed).toBe(1);
  });

  it("raises AuthError when the grant can't be refreshed", async () => {
    const { fetch } = fakeFetch([{ match: ["/x"], status: 401 }]);
    await expect(make(fetch, async () => false).c.json("/x")).rejects.toBeInstanceOf(AuthError);
  });

  it("gives up on persistent 5xx with ApiError", async () => {
    const { fetch, calls } = fakeFetch([{ match: ["/x"], status: 503 }]);
    await expect(make(fetch).c.json("/x")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(5);
  });
});

describe("crypto", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips tokens and rejects tampering", () => {
    const sealed = encryptToken("secret-token", key);
    expect(decryptToken(sealed, key)).toBe("secret-token");
    sealed[30] = sealed[30]! ^ 1;
    expect(() => decryptToken(sealed, key)).toThrow();
  });

  it("signs state, rejects forged and expired state", () => {
    const now = Date.now();
    const token = signState({ provider: "slack", orgId: "o", userId: "u" }, "secret", now);
    expect(verifyState(token, "secret", now)?.orgId).toBe("o");
    expect(verifyState(token, "other-secret", now)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), orgId: "evil" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, "secret", now)).toBeNull();
    expect(verifyState(token, "secret", now + 11 * 60 * 1000)).toBeNull();
  });
});

describe("oauth", () => {
  const app = { clientId: "id", clientSecret: "secret" };

  it("builds provider-specific authorize URLs", () => {
    const slack = new URL(authorizeUrl(PROVIDERS.slack, app, "https://kept.test/cb", "st"));
    expect(slack.searchParams.get("scope")).toBe("channels:read,channels:history,groups:read,groups:history,users:read,users:read.email,team:read,files:read");
    const google = new URL(authorizeUrl(PROVIDERS.google, app, "https://kept.test/cb", "st"));
    expect(google.searchParams.get("access_type")).toBe("offline");
    expect(google.searchParams.get("state")).toBe("st");
  });

  it("sends Notion's token request as JSON with basic auth", async () => {
    const { fetch, calls } = fakeFetch([{ match: ["/v1/oauth/token"], json: { access_token: "n", workspace_id: "w" } }]);
    const { tokens, raw } = await exchangeCode(PROVIDERS.notion, app, "code", "https://kept.test/cb", fetch);
    expect(tokens.accessToken).toBe("n");
    expect(raw.workspace_id).toBe("w");
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ grant_type: "authorization_code", code: "code", redirect_uri: "https://kept.test/cb" });
  });

  it("treats Slack's ok:false as an error", async () => {
    const { fetch } = fakeFetch([{ match: ["oauth.v2.access"], json: { ok: false, error: "invalid_code" } }]);
    await expect(exchangeCode(PROVIDERS.slack, app, "bad", "https://kept.test/cb", fetch)).rejects.toThrow(OAuthError);
  });

  it("keeps the old refresh token when the provider doesn't rotate it", async () => {
    const { fetch, calls } = fakeFetch([{ match: ["oauth2.googleapis.com/token"], json: { access_token: "new", expires_in: 3600 } }]);
    const next = await refreshTokens(PROVIDERS.google, app, { accessToken: "old", refreshToken: "r1", scopes: ["a"] }, fetch);
    expect(next).toMatchObject({ accessToken: "new", refreshToken: "r1", scopes: ["a"] });
    expect(calls[0]!.body).toContain("grant_type=refresh_token");
    expect(next.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

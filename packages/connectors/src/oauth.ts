// The OAuth authorization-code flow, with each provider's quirks described by its OAuthSpec.

import type { OAuthApp, ProviderDefinition, TokenSet } from "./types.js";

export function authorizeUrl(def: ProviderDefinition, app: OAuthApp, redirectUri: string, state: string): string {
  const url = new URL(def.oauth.authorizeUrl);
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (def.oauth.scopes.length > 0) url.searchParams.set("scope", def.oauth.scopes.join(def.oauth.scopeSeparator ?? " "));
  for (const [k, v] of Object.entries(def.oauth.extraAuthorizeParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

export class OAuthError extends Error {}

async function tokenRequest(
  def: ProviderDefinition,
  app: OAuthApp,
  params: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const body: Record<string, string> = { ...params };
  if (def.oauth.clientAuth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`;
  } else {
    body.client_id = app.clientId;
    body.client_secret = app.clientSecret;
  }
  let payload: string;
  if (def.oauth.bodyFormat === "json") {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body).toString();
  }

  const res = await fetchFn(def.oauth.tokenUrl, { method: "POST", headers, body: payload });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new OAuthError(`${def.name} token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }
  // Slack answers 200 with ok:false on errors.
  if (!res.ok || json.ok === false || json.error) {
    const reason = String(json.error_description ?? json.error ?? res.status);
    throw new OAuthError(`${def.name} rejected the request: ${reason}`);
  }
  return json;
}

export async function exchangeCode(
  def: ProviderDefinition,
  app: OAuthApp,
  code: string,
  redirectUri: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ tokens: TokenSet; raw: Record<string, unknown> }> {
  const raw = await tokenRequest(def, app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, fetchFn);
  return { tokens: def.parseToken(raw), raw };
}

/** Uses the refresh token; keeps the old one when the provider doesn't rotate it. */
export async function refreshTokens(
  def: ProviderDefinition,
  app: OAuthApp,
  current: TokenSet,
  fetchFn: typeof fetch = fetch,
): Promise<TokenSet> {
  if (!current.refreshToken) throw new OAuthError(`${def.name} connection has no refresh token`);
  const raw = await tokenRequest(def, app, { grant_type: "refresh_token", refresh_token: current.refreshToken }, fetchFn);
  const next = def.parseToken(raw);
  return { ...next, refreshToken: next.refreshToken ?? current.refreshToken, scopes: next.scopes.length ? next.scopes : current.scopes };
}

/** The common token shape (RFC 6749). Providers with a different shape override parseToken. */
export function standardToken(raw: Record<string, unknown>, now = Date.now()): TokenSet {
  const expiresIn = Number(raw.expires_in);
  return {
    accessToken: String(raw.access_token ?? ""),
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now + expiresIn * 1000) : undefined,
    scopes: typeof raw.scope === "string" ? raw.scope.split(/[ ,]+/).filter(Boolean) : [],
  };
}

import { ApiClient } from "./http.js";
import { refreshTokens } from "./oauth.js";
import type { OAuthApp, ProviderDefinition, TokenSet } from "./types.js";

/** Refresh this long before expiry, so a request never starts with a token about to lapse. */
const EARLY_REFRESH_MS = 2 * 60 * 1000;

/**
 * An API client for one connection. Refreshes the token shortly before it expires and on a 401,
 * and hands each new token set to `onTokens` so the caller can persist it.
 */
export function connectionClient(opts: {
  def: ProviderDefinition;
  app: OAuthApp | undefined;
  tokens: TokenSet;
  onTokens(tokens: TokenSet): Promise<void>;
  fetch?: typeof fetch;
  /** Retries on 429 and 5xx. Pass 0 for requests that must not repeat, like sending an email. */
  maxRetries?: number;
}): ApiClient {
  let tokens = opts.tokens;

  const refresh = async (): Promise<boolean> => {
    if (!tokens.refreshToken || !opts.app) return false;
    try {
      tokens = await refreshTokens(opts.def, opts.app, tokens, opts.fetch);
    } catch {
      return false;
    }
    await opts.onTokens(tokens);
    return true;
  };

  return new ApiClient({
    baseUrl: opts.def.apiBase,
    headers: opts.def.apiHeaders,
    fetch: opts.fetch,
    maxRetries: opts.maxRetries,
    refresh,
    async getAccessToken() {
      if (tokens.expiresAt && tokens.expiresAt.getTime() - Date.now() < EARLY_REFRESH_MS) await refresh();
      return tokens.accessToken;
    },
  });
}

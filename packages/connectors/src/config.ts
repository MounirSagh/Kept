import { createHmac } from "node:crypto";
import { PROVIDER_IDS } from "./registry.js";
import type { OAuthApp, ProviderId } from "./types.js";

export interface ConnectorConfig {
  /** Base64, 32 bytes: encrypts stored OAuth tokens. */
  encryptionKey: string;
  /** Signs OAuth state; derived from the encryption key so there is one secret to manage. */
  stateSecret: string;
  /** Providers whose OAuth client id and secret are set. */
  apps: Partial<Record<ProviderId, OAuthApp>>;
}

const ENV_PREFIX: Record<ProviderId, string> = {
  microsoft: "MICROSOFT",
  google: "GOOGLE",
  slack: "SLACK",
  linear: "LINEAR",
  notion: "NOTION",
  hubspot: "HUBSPOT",
};

/** Reads <PROVIDER>_CLIENT_ID / _CLIENT_SECRET and TOKEN_ENCRYPTION_KEY. Null when no key is set. */
export function connectorConfig(env: Record<string, string | undefined>): ConnectorConfig | null {
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) return null;
  if (Buffer.from(encryptionKey, "base64").length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  }
  const apps: ConnectorConfig["apps"] = {};
  for (const id of PROVIDER_IDS) {
    const clientId = env[`${ENV_PREFIX[id]}_CLIENT_ID`]?.trim();
    const clientSecret = env[`${ENV_PREFIX[id]}_CLIENT_SECRET`]?.trim();
    if (clientId && clientSecret) apps[id] = { clientId, clientSecret };
  }
  return {
    encryptionKey,
    stateSecret: createHmac("sha256", Buffer.from(encryptionKey, "base64")).update("kept:oauth-state").digest("base64"),
    apps,
  };
}

/** Every provider redirects to the same web route; the signed state says which provider and org. */
export function redirectUri(webOrigin: string): string {
  return new URL("/oauth/callback", webOrigin).toString();
}

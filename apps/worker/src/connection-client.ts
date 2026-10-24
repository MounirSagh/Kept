import type { Connection, PrismaClient } from "@kept/db";
import {
  PROVIDERS, connectionClient, decryptToken, encryptToken, isProviderId,
  type ApiClient, type ConnectorConfig, type ProviderDefinition, type TokenSet,
} from "@kept/connectors";

/**
 * An API client for a stored connection: decrypts its tokens, and saves refreshed ones back.
 * `maxRetries: 0` for requests that must not repeat (sending email).
 */
export function clientForConnection(
  prisma: PrismaClient,
  config: ConnectorConfig,
  connection: Connection,
  opts: { maxRetries?: number } = {},
): { def: ProviderDefinition; client: ApiClient } {
  if (!isProviderId(connection.provider) || !connection.accessTokenEnc) {
    throw new Error(`Connection ${connection.id} has no usable token (${connection.provider})`);
  }
  const def = PROVIDERS[connection.provider];
  const key = config.encryptionKey;
  const tokens: TokenSet = {
    accessToken: decryptToken(connection.accessTokenEnc, key),
    refreshToken: connection.refreshTokenEnc ? decryptToken(connection.refreshTokenEnc, key) : undefined,
    expiresAt: connection.tokenExpiresAt ?? undefined,
    scopes: connection.scopes,
  };
  const client = connectionClient({
    def,
    app: config.apps[def.id],
    tokens,
    maxRetries: opts.maxRetries,
    async onTokens(next) {
      await prisma.connection.update({
        where: { id: connection.id },
        data: {
          accessTokenEnc: encryptToken(next.accessToken, key),
          refreshTokenEnc: next.refreshToken ? encryptToken(next.refreshToken, key) : null,
          tokenExpiresAt: next.expiresAt ?? null,
        },
      });
    },
  });
  return { def, client };
}

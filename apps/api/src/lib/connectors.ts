import { connectorConfig, redirectUri } from "@kept/connectors";
import { env } from "../env.js";

/** Null until TOKEN_ENCRYPTION_KEY is set: connecting tools is then unavailable. */
export const connectors = connectorConfig(process.env);

export const OAUTH_REDIRECT_URI = redirectUri(env.WEB_ORIGIN);

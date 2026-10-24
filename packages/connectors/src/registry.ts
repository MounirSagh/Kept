import { google } from "./providers/google.js";
import { hubspot } from "./providers/hubspot.js";
import { linear } from "./providers/linear.js";
import { microsoft } from "./providers/microsoft.js";
import { notion } from "./providers/notion.js";
import { slackProvider } from "./providers/slack.js";
import type { ProviderDefinition, ProviderId } from "./types.js";

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  microsoft,
  google,
  slack: slackProvider,
  linear,
  notion,
  hubspot,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

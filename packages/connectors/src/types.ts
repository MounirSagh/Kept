import type { ApiClient } from "./http.js";

export type ProviderId = "microsoft" | "google" | "slack" | "linear" | "notion" | "hubspot";

/**
 * personal: each member connects their own account (mailbox, calendar, files); what syncs is
 * private to them until it is matched to a client account.
 * org: an owner connects a workspace once for the whole organization.
 */
export type ConnectionScope = "personal" | "org";

/** Mirrors the SourceKind enum in packages/db. */
export type SourceKind = "email" | "message" | "document" | "ticket" | "deal" | "event" | "crm_record";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
}

/** One item read from a provider, ready to become a source_items row. */
export interface SourceItemInput {
  /** Unique within the connection; the upsert key. */
  externalId: string;
  kind: SourceKind;
  title?: string;
  author?: string;
  url?: string;
  occurredAt: Date;
  contentText?: string;
  metadata: Record<string, unknown>;
  /**
   * Where the item lives in its tool, for sources whose client can't be read from participants
   * (Slack channel, Linear team, Notion parent). Owners map containers to accounts.
   */
  container?: { id: string; label: string };
}

export interface SyncContext {
  /** How far back the first sync of a stream reaches. */
  since: Date;
  now: Date;
}

export interface StreamStep {
  items: SourceItemInput[];
  /** Where to resume. Persisted after every step, so a sync can stop at any point. */
  cursor: unknown;
  /** True while this stream has more to read right now; false once it is caught up. */
  more: boolean;
}

/** One kind of data from a provider (inbox, calendar, a CRM object...), read a page per step. */
export interface Stream {
  name: string;
  step(client: ApiClient, cursor: unknown, ctx: SyncContext): Promise<StreamStep>;
}

export interface Identity {
  /** Stable id of the connected account (user id, workspace id, portal id). */
  externalAccountId: string;
  /** Human-readable: an email address or a workspace name. */
  label: string;
  /** Granted scopes, for providers whose token response doesn't list them. */
  scopes?: string[];
}

export interface OAuthSpec {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Slack puts bot scopes in `scope`; everything else uses the standard param. */
  scopeSeparator?: " " | ",";
  extraAuthorizeParams?: Record<string, string>;
  /** How the client authenticates to the token endpoint. */
  clientAuth: "body" | "basic";
  /** Notion's token endpoint takes JSON; everyone else takes a form. */
  bodyFormat: "form" | "json";
}

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  scope: ConnectionScope;
  /** What Kept reads, shown on the Integrations page. */
  reads: string;
  oauth: OAuthSpec;
  /** Base URL for relative request paths. */
  apiBase: string;
  /** Extra headers on every API request (e.g. Notion-Version). */
  apiHeaders?: Record<string, string>;
  /** Normalizes the token endpoint's response; providers disagree on its shape. */
  parseToken(raw: Record<string, unknown>): TokenSet;
  /** Who was connected. Gets the raw token response too: some providers only report identity there. */
  identify(client: ApiClient, tokenResponse: Record<string, unknown>): Promise<Identity>;
  streams: Stream[];
}

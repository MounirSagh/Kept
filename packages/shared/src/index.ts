import type { OrgRole } from "./permissions.js";

export * from "./permissions.js";
export * from "./csv.js";

export const AGENT_RUN_QUEUE = "agent-runs";

export interface AgentRunJobData {
  runId: string;
}

export const EMAIL_QUEUE = "emails";

/** A fully rendered email. The worker only delivers it; rendering happens where the data is. */
export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface HealthDto {
  status: "ok" | "degraded";
  postgres: boolean;
  redis: boolean;
}


export interface OrgDto {
  id: string;
  name: string;
  slug: string;
}

/**
 * What Kept knows about the organization itself. Agents read it when drafting on the
 * company's behalf (signature, contact details, time zone for dates). Every field is optional.
 */
export interface OrgProfile {
  legalName?: string;
  website?: string;
  industry?: string;
  /** A few sentences on what the company does and for whom. */
  description?: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  /** IANA time zone, e.g. "Europe/Paris". */
  timezone?: string;
  /** ISO 4217 code, e.g. "USD". */
  currency?: string;
  /** Sign-off appended to emails Kept drafts. */
  emailSignature?: string;
}

export interface OrgDetailsDto extends OrgDto {
  profile: OrgProfile;
}

export interface MeDto {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    isPlatformAdmin: boolean;
  };
  orgs: (OrgDto & { role: OrgRole; teamId: string | null })[];
}

export interface TeamDto {
  id: string;
  name: string;
}

export interface MemberDto {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: OrgRole;
  teamId: string | null;
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: OrgRole;
  teamId: string | null;
  expiresAt: string;
  createdAt: string;
}

/** Returned on creation and on resend: the token is never stored, so the link can't be recovered later. */
export interface CreatedInvitationDto extends InvitationDto {
  acceptUrl: string;
  /** True when the email was queued for the worker to send. False when email isn't configured: share acceptUrl instead. */
  emailQueued: boolean;
}

export interface AcceptedInvitationDto {
  org: OrgDto;
  role: OrgRole;
  teamId: string | null;
}

/** How a client relates to the company, as CRMs classify it. */
export const COMPANY_TYPES = ["Customer", "Prospect", "Partner", "Reseller", "Vendor", "Other"] as const;

/** A client's company profile, like a CRM company record. */
export interface AccountProfile {
  industry: string | null;
  companyType: string | null;
  description: string | null;
  employeeCount: number | null;
  /** The client's own yearly revenue, in cents of the account's currency. */
  annualRevenueCents: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  /** IANA time zone, e.g. "America/Toronto". */
  timezone: string | null;
  linkedinUrl: string | null;
}

/**
 * Fields a CRM keeps in sync for the accounts it imported. They're read-only in Kept for those
 * accounts (edit them in the CRM); owner, renewal date and contract value always stay Kept's.
 */
export const CRM_SYNCED_FIELDS = [
  "name", "domain", "industry", "companyType", "description", "employeeCount", "annualRevenueCents",
  "city", "region", "postalCode", "country", "timezone", "linkedinUrl",
] as const;

export interface AccountDto extends AccountProfile {
  id: string;
  name: string;
  domain: string | null;
  /** "hubspot" when imported from a CRM: the CRM_SYNCED_FIELDS are then kept in sync from it. */
  source: string | null;
  ownerUserId: string | null;
  /** What the client pays a year, in cents. */
  annualValueCents: string | null;
  currency: string | null;
  renewalDate: string | null;
  healthScore: number | null;
  contactCount: number;
}

export type ProviderId = "microsoft" | "google" | "slack" | "linear" | "notion" | "hubspot";

export interface ProviderInfoDto {
  id: ProviderId;
  name: string;
  scope: "personal" | "org";
  reads: string;
  /** False until the provider's OAuth client id and secret are set on the server. */
  configured: boolean;
}

export interface ConnectionDto {
  id: string;
  provider: ProviderId;
  scope: "personal" | "org";
  label: string | null;
  status: "active" | "expired" | "revoked" | "error";
  ownerUserId: string | null;
  connectedById: string | null;
  lastSyncedAt: string | null;
  /** True while a sync is running. */
  syncing: boolean;
  lastError: string | null;
  itemCount: number;
  createdAt: string;
}

export interface ConnectionsDto {
  providers: ProviderInfoDto[];
  connections: ConnectionDto[];
}

export const SOURCE_SYNC_QUEUE = "source-sync";

export interface SourceSyncJobData {
  connectionId: string;
}

export const MATCH_QUEUE = "source-match";

export interface MatchJobData {
  orgId: string;
  /** Re-evaluate every item (rules changed), not just new or changed ones. */
  all?: boolean;
}

export interface AccountInput extends Partial<AccountProfile> {
  name: string;
  domain: string | null;
  ownerUserId: string | null;
  /** YYYY-MM-DD */
  renewalDate?: string | null;
  annualValueCents?: string | null;
  /** ISO 4217, e.g. "USD". */
  currency?: string | null;
}

export interface ContactDto {
  id: string;
  accountId: string | null;
  fullName: string | null;
  email: string | null;
  title: string | null;
  phone: string | null;
  /** "hubspot" when imported from a CRM: it's then kept in sync from there and read-only in Kept. */
  source: string | null;
  createdAt: string;
}

export interface ContactInput {
  fullName: string | null;
  email: string | null;
  title: string | null;
  phone: string | null;
}

export interface ImportResultDto {
  created: number;
  updated: number;
  /** Rows that already matched and needed no change (e.g. an existing team). */
  unchanged?: number;
  /** Rows the server rejected; row numbers match the spreadsheet (header = row 1). */
  errors: { row: number; message: string }[];
}

export interface CommitmentDto {
  id: string;
  accountId: string | null;
  accountName: string | null;
  summary: string;
  notes: string | null;
  madeBy: string | null;
  ownerUserId: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  status: "open" | "fulfilled" | "broken" | "unknown" | "superseded";
  /** "commitment": the team promised it; "obligation": the customer did. */
  type: PromiseSide;
  origin: "extracted" | "manual" | "import";
  sourceUrl: string | null;
  createdAt: string;
  /** The page of the document it was quoted from, for promises found in files. */
  sourcePage: number | null;
  /** The most severe open flag about this commitment: Kept found evidence it's at risk. */
  risk: { flagId: string; severity: SeverityValue; title: string } | null;
}

/** Who made the promise: the team ("commitment") or the customer ("obligation"). */
export type PromiseSide = "commitment" | "obligation";

export interface CommitmentInput {
  accountId: string;
  /** Defaults to "commitment" (a promise the team made). */
  type?: PromiseSide;
  summary: string;
  notes: string | null;
  madeBy: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  status: "open" | "fulfilled" | "broken";
}

export type MatchStatusValue = "pending" | "matched" | "unmatched" | "ambiguous" | "ignored";

export interface RoutingContainerDto {
  connectionId: string;
  provider: ProviderId;
  connectionLabel: string | null;
  containerId: string;
  containerLabel: string;
  itemCount: number;
  lastActivityAt: string;
  /**
   * null: nobody routed it. auto: Kept routed it from its name or its people (reason says which),
   * until an owner confirms or changes it. An owner's "not routed" keeps Kept from routing it.
   */
  mapping: { accountId: string | null; ignored: boolean; auto: boolean; reason: string | null } | null;
}

export interface RoutingDto {
  /** Items per match status across the org. */
  counts: Partial<Record<MatchStatusValue, number>>;
  /** Slack channels, Linear teams and Notion parents seen in synced data, most recent first. */
  containers: RoutingContainerDto[];
  /** Whether Kept routes containers by their name and people (on unless an owner turned it off). */
  auto: boolean;
}

export interface RoutingSettingsInput {
  auto: boolean;
}

export interface RoutingMappingInput {
  /** null with ignored=false: not routed, item by item only (and Kept won't route it). */
  accountId: string | null;
  ignored: boolean;
}

/* Agent pipeline ------------------------------------------------------------------------------ */

/** Reads matched source items that have new content and records what they commit to. */
export const EXTRACT_QUEUE = "extract";

export interface ExtractJobData {
  orgId: string;
}

/** Carries out a proposed action a person approved. */
export const ACTION_QUEUE = "actions";

export interface ActionJobData {
  actionId: string;
}

/**
 * Ticks hourly. In each org's own time zone it runs the daily sweep (agent runs for accounts with
 * promises coming due) and sends each person's daily digest, once per local day.
 */
export const DAILY_QUEUE = "daily";

/** Stores something Kept learned from a person's decision in H-MEM, for later runs to recall. */
export const LEARN_QUEUE = "learn";

export interface LearnJobData {
  orgId: string;
  accountId: string | null;
  content: string;
  /** The flag this lesson came from: its hmem_ref is set to the new memory. */
  flagId?: string;
}

export type FlagKindValue = "unkept_promise" | "mismatch" | "deadline_risk" | "churn_signal";
export type SeverityValue = "low" | "medium" | "high" | "critical";
export type FlagStatusValue = "open" | "confirmed" | "dismissed" | "resolved";

export interface EvidenceDto {
  stance: "supports" | "contradicts" | "context";
  excerpt: string | null;
  source: { id: string; title: string | null; provider: ProviderId; url: string | null; occurredAt: string } | null;
  commitment: { id: string; summary: string } | null;
}

export interface FlagDto {
  id: string;
  accountId: string;
  accountName: string;
  /** What's at stake on the account, for ordering and context. */
  accountRenewalDate: string | null;
  accountValueCents: string | null;
  accountCurrency: string | null;
  /** The commitment the flag is about; null for signals that aren't about one promise. */
  commitment: { id: string; summary: string; dueDate: string | null } | null;
  kind: FlagKindValue;
  title: string;
  explanation: string;
  severity: SeverityValue;
  confidence: number | null;
  status: FlagStatusValue;
  resolutionNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  evidence: EvidenceDto[];
  /** Proposed actions still waiting for a decision. */
  pendingActions: number;
}

export interface FlagDecisionInput {
  status: "confirmed" | "dismissed" | "resolved";
  note?: string;
}

export type ActionTypeValue = "send_email" | "schedule_reminder" | "internal_alert" | "update_account" | "create_ticket" | "update_crm";
export type ActionStatusValue = "pending" | "approved" | "rejected" | "executing" | "done" | "failed";

export interface SendEmailPayload {
  to: string[];
  subject: string;
  body: string;
}

export interface ReminderPayload {
  title: string;
  /** YYYY-MM-DD */
  remindOn: string;
}

export interface AlertPayload {
  message: string;
}

/** Contract terms Kept read in a document, to set on the company once someone approves. */
export interface AccountUpdatePayload {
  /** YYYY-MM-DD */
  renewalDate: string | null;
  /** Yearly contract value in currency units, e.g. "48000". */
  annualValue: string | null;
  currency: string | null;
  noticeDays: number | null;
  /** Where the terms come from, shown to whoever approves. */
  documentTitle: string;
  excerpt: string;
}

/** A Linear issue for the team that has to do the work. */
export interface TicketPayload {
  /** Linear team key, e.g. "ENG". */
  teamKey: string;
  title: string;
  /** Markdown. */
  description: string;
}

/** A task on the company's HubSpot record, for the account owner. */
export interface CrmTaskPayload {
  subject: string;
  body: string;
  /** YYYY-MM-DD */
  dueDate: string;
}

export type ActionPayload = SendEmailPayload | ReminderPayload | AlertPayload | AccountUpdatePayload | TicketPayload | CrmTaskPayload;

export interface ProposedActionDto {
  id: string;
  type: ActionTypeValue;
  status: ActionStatusValue;
  accountId: string | null;
  accountName: string | null;
  flag: { id: string; title: string; severity: SeverityValue } | null;
  rationale: string | null;
  /** What will run: the person's edit if they made one, otherwise the proposal. */
  payload: ActionPayload;
  edited: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  lastError: string | null;
  executedAt: string | null;
  /** What running it produced, e.g. the Linear issue's identifier and url. */
  result: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActionsDto {
  actions: ProposedActionDto[];
  /** Whether the current user has a Gmail or Outlook connection allowed to send, for approving emails. */
  canSendEmail: boolean;
  /** Linear teams an issue can be filed in (seen in synced issues), for editing a ticket. */
  linearTeams: { key: string; name: string }[];
}

export interface ActionDecisionInput {
  decision: "approve" | "reject";
  /** Edited payload, approve only. */
  payload?: ActionPayload;
  note?: string;
}

/* Paged tables -------------------------------------------------------------------------------- */

/** A file routed to a company: an attachment, a shared or linked file. */
export interface DocumentDto {
  id: string;
  title: string | null;
  url: string | null;
  /** Where it came from, e.g. "Gmail attachment", "Slack", "Google Drive". */
  origin: string;
  occurredAt: string;
  /** "pending" until read; then "read", "ocr", "unsupported", "too_large", "no_access", "needs_ocr", "empty" or "failed". */
  status: string;
  pages: number | null;
  /** Why it belongs to this company: "linked from …", "shared with northwind.com"... */
  reason: string | null;
}

export interface PageDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type SortDir = "asc" | "desc";

export const PAGE_SIZES = [25, 50, 100] as const;

export interface CompaniesQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "name" | "contactCount" | "annualValue" | "renewalDate" | "createdAt";
  dir?: SortDir;
  /** A member's user id, or "none" for accounts without an owner. */
  owner?: string;
  /** "crm": imported from a CRM; "kept": added in Kept. */
  source?: "crm" | "kept";
  /** Renewal within the next 30 or 90 days, or already passed. */
  renewal?: "30d" | "90d" | "passed";
  type?: string;
}

export interface ContactRowDto extends ContactDto {
  accountName: string | null;
}

export interface ContactsQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "name" | "email" | "company" | "createdAt";
  dir?: SortDir;
  /** An account id, or "none" for contacts not linked to a company. */
  accountId?: string;
  source?: "crm" | "kept";
}

/* Zetaris ------------------------------------------------------------------------------------- */

/** A read-only query the agents can run live for one company; {{domain}} etc. are filled in for it. */
export interface ZetarisDatasetDto {
  id: string;
  name: string;
  description: string;
  sql: string;
}

export interface ZetarisDto {
  connected: boolean;
  /** The engine's REST base (…/api/v1.0) or the web app's address. */
  restUrl: string | null;
  zetarisOrgId: string | null;
  lastError: string | null;
  datasets: ZetarisDatasetDto[];
  /** Parameters a dataset can use. */
  params: string[];
}

export interface ZetarisConnectInput {
  restUrl: string;
  zetarisOrgId: string;
  /** Required the first time; left out to keep the stored key. */
  apiKey?: string;
}

export interface ZetarisDatasetInput {
  name: string;
  description: string;
  sql: string;
}

export interface ZetarisTestInput {
  sql: string;
  accountId: string;
}

export interface ZetarisTestDto {
  /** The SQL as run for that company, or null when it doesn't apply to it. */
  sql: string | null;
  columns: string[];
  rows: unknown[][];
  note: string | null;
}

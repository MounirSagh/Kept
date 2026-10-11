import type { OrgRole } from "./permissions.js";

export * from "./permissions.js";

export const AGENT_RUN_QUEUE = "agent-runs";

export interface AgentRunJobData {
  runId: string;
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

/** Returned once, on creation: the token is never stored and can't be recovered later. */
export interface CreatedInvitationDto extends InvitationDto {
  acceptUrl: string;
}

export interface AcceptedInvitationDto {
  org: OrgDto;
  role: OrgRole;
  teamId: string | null;
}

export interface AccountDto {
  id: string;
  name: string;
  domain: string | null;
  ownerUserId: string | null;
  annualValueCents: string | null;
  currency: string | null;
  renewalDate: string | null;
  healthScore: number | null;
}

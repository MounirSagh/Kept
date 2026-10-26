import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import type {
  AcceptedInvitationDto,
  ActionDecisionInput,
  ActionsDto,
  FlagDecisionInput,
  FlagDto,
  ProposedActionDto,
  AccountDto,
  AccountImportRow,
  AccountInput,
  CommitmentDto,
  CommitmentImportRow,
  CommitmentInput,
  ContactDto,
  ContactInput,
  ContactRowDto,
  DocumentDto,
  PageDto,
  ConnectionsDto,
  CreatedInvitationDto,
  HealthDto,
  ImportResultDto,
  InvitationDto,
  InvitationImportRow,
  OrgDetailsDto,
  OrgProfile,
  TeamImportRow,
  MeDto,
  MemberDto,
  OrgDto,
  OrgRole,
  RoutingDto,
  RoutingMappingInput,
  RoutingSettingsInput,
  TeamDto,
} from "@kept/shared";

/**
 * The account form's body: amounts in currency units as typed (e.g. "48000"); the API stores cents.
 * Fields left out are left unchanged.
 */
export type AccountBody = Omit<AccountInput, "annualValueCents" | "annualRevenueCents"> & {
  annualValue?: string | null;
  annualRevenue?: string | null;
};

export function useApi() {
  const { getToken } = useAuth();

  return useMemo(() => {
    async function request<T>(path: string, init?: RequestInit): Promise<T> {
      const token = await getToken();
      const res = await fetch(`/api${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
          ...init?.headers,
        },
      });
      // /health answers 503 with a body describing what's degraded; everything else non-2xx is an error.
      if (!res.ok && !(res.status === 503 && path === "/health")) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof body?.error === "string" ? body.error : `${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }

    return {
      health: () => request<HealthDto>("/health"),
      me: () => request<MeDto>("/me"),
      createOrg: (input: { name: string; slug: string }) =>
        request<OrgDto>("/orgs", { method: "POST", body: JSON.stringify(input) }),
      org: (orgId: string) => request<OrgDetailsDto>(`/orgs/${orgId}`),
      updateOrg: (orgId: string, changes: { name?: string; profile?: OrgProfile }) =>
        request<OrgDetailsDto>(`/orgs/${orgId}`, { method: "PATCH", body: JSON.stringify(changes) }),

      teams: (orgId: string) => request<TeamDto[]>(`/orgs/${orgId}/teams`),
      createTeam: (orgId: string, name: string) =>
        request<TeamDto>(`/orgs/${orgId}/teams`, { method: "POST", body: JSON.stringify({ name }) }),
      renameTeam: (orgId: string, teamId: string, name: string) =>
        request<TeamDto>(`/orgs/${orgId}/teams/${teamId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
      importTeams: (orgId: string, rows: (TeamImportRow & { row: number })[]) =>
        request<ImportResultDto>(`/orgs/${orgId}/teams/import`, { method: "POST", body: JSON.stringify({ rows }) }),
      deleteTeam: (orgId: string, teamId: string) =>
        request<void>(`/orgs/${orgId}/teams/${teamId}`, { method: "DELETE" }),

      members: (orgId: string) => request<MemberDto[]>(`/orgs/${orgId}/members`),
      updateMember: (orgId: string, userId: string, changes: { role?: OrgRole; teamId?: string | null }) =>
        request<void>(`/orgs/${orgId}/members/${userId}`, { method: "PATCH", body: JSON.stringify(changes) }),
      removeMember: (orgId: string, userId: string) =>
        request<void>(`/orgs/${orgId}/members/${userId}`, { method: "DELETE" }),

      invitations: (orgId: string) => request<InvitationDto[]>(`/orgs/${orgId}/invitations`),
      invite: (orgId: string, input: { email: string; role: OrgRole; teamId: string | null }) =>
        request<CreatedInvitationDto>(`/orgs/${orgId}/invitations`, { method: "POST", body: JSON.stringify(input) }),
      resendInvitation: (orgId: string, invitationId: string) =>
        request<CreatedInvitationDto>(`/orgs/${orgId}/invitations/${invitationId}/resend`, { method: "POST" }),
      invitationLink: (orgId: string, invitationId: string) =>
        request<CreatedInvitationDto>(`/orgs/${orgId}/invitations/${invitationId}/link`, { method: "POST" }),
      importInvitations: (orgId: string, rows: (InvitationImportRow & { row: number })[]) =>
        request<ImportResultDto>(`/orgs/${orgId}/invitations/import`, { method: "POST", body: JSON.stringify({ rows }) }),
      revokeInvitation: (orgId: string, invitationId: string) =>
        request<void>(`/orgs/${orgId}/invitations/${invitationId}`, { method: "DELETE" }),
      acceptInvitation: (token: string) =>
        request<AcceptedInvitationDto>("/invitations/accept", { method: "POST", body: JSON.stringify({ token }) }),

      connections: (orgId: string) => request<ConnectionsDto>(`/orgs/${orgId}/connections`),
      authorizeConnection: (orgId: string, provider: string) =>
        request<{ url: string }>(`/orgs/${orgId}/connections/${provider}/authorize`, { method: "POST" }),
      completeConnection: (code: string, state: string) =>
        request<{ orgSlug: string; provider: string; label: string }>("/oauth/callback", {
          method: "POST",
          body: JSON.stringify({ code, state }),
        }),
      syncConnection: (orgId: string, connectionId: string) =>
        request<void>(`/orgs/${orgId}/connections/${connectionId}/sync`, { method: "POST" }),
      removeConnection: (orgId: string, connectionId: string) =>
        request<void>(`/orgs/${orgId}/connections/${connectionId}`, { method: "DELETE" }),

      accounts: (orgId: string) => request<AccountDto[]>(`/orgs/${orgId}/accounts`),
      createAccount: (orgId: string, input: AccountBody) =>
        request<AccountDto>(`/orgs/${orgId}/accounts`, { method: "POST", body: JSON.stringify(input) }),
      updateAccount: (orgId: string, accountId: string, input: AccountBody) =>
        request<AccountDto>(`/orgs/${orgId}/accounts/${accountId}`, { method: "PATCH", body: JSON.stringify(input) }),
      importAccounts: (orgId: string, rows: (AccountImportRow & { row: number })[]) =>
        request<ImportResultDto>(`/orgs/${orgId}/accounts/import`, { method: "POST", body: JSON.stringify({ rows }) }),
      companiesPage: (orgId: string, query: Record<string, string | number>) =>
        request<PageDto<AccountDto>>(`/orgs/${orgId}/accounts/page?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`),
      contactsPage: (orgId: string, query: Record<string, string | number>) =>
        request<PageDto<ContactRowDto>>(`/orgs/${orgId}/contacts?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`),
      accountDocuments: (orgId: string, accountId: string) => request<DocumentDto[]>(`/orgs/${orgId}/accounts/${accountId}/documents`),
      contacts: (orgId: string, accountId: string) => request<ContactDto[]>(`/orgs/${orgId}/accounts/${accountId}/contacts`),
      createContact: (orgId: string, accountId: string, input: ContactInput) =>
        request<ContactDto>(`/orgs/${orgId}/accounts/${accountId}/contacts`, { method: "POST", body: JSON.stringify(input) }),
      updateContact: (orgId: string, contactId: string, input: ContactInput) =>
        request<ContactDto>(`/orgs/${orgId}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(input) }),
      deleteContact: (orgId: string, contactId: string) => request<void>(`/orgs/${orgId}/contacts/${contactId}`, { method: "DELETE" }),

      commitments: (orgId: string, filter: { status?: string; accountId?: string; type?: "commitment" | "obligation" } = {}) => {
        const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
        return request<CommitmentDto[]>(`/orgs/${orgId}/commitments${q.size ? `?${q}` : ""}`);
      },
      createCommitment: (orgId: string, input: CommitmentInput) =>
        request<CommitmentDto>(`/orgs/${orgId}/commitments`, { method: "POST", body: JSON.stringify(input) }),
      updateCommitment: (orgId: string, id: string, input: Partial<CommitmentInput>) =>
        request<CommitmentDto>(`/orgs/${orgId}/commitments/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      deleteCommitment: (orgId: string, id: string) => request<void>(`/orgs/${orgId}/commitments/${id}`, { method: "DELETE" }),
      importCommitments: (orgId: string, rows: (CommitmentImportRow & { row: number })[]) =>
        request<ImportResultDto>(`/orgs/${orgId}/commitments/import`, { method: "POST", body: JSON.stringify({ rows }) }),
      flags: (orgId: string, status: "open" | "closed") => request<FlagDto[]>(`/orgs/${orgId}/flags?status=${status}`),
      decideFlag: (orgId: string, flagId: string, input: FlagDecisionInput) =>
        request<FlagDto>(`/orgs/${orgId}/flags/${flagId}/decision`, { method: "POST", body: JSON.stringify(input) }),
      actions: (orgId: string, view: "pending" | "history") => request<ActionsDto>(`/orgs/${orgId}/actions?view=${view}`),
      decideAction: (orgId: string, actionId: string, input: ActionDecisionInput) =>
        request<ProposedActionDto>(`/orgs/${orgId}/actions/${actionId}/decision`, { method: "POST", body: JSON.stringify(input) }),

      deleteAccount: (orgId: string, accountId: string) =>
        request<void>(`/orgs/${orgId}/accounts/${accountId}`, { method: "DELETE" }),

      routing: (orgId: string) => request<RoutingDto>(`/orgs/${orgId}/routing`),
      setRoutingSettings: (orgId: string, input: RoutingSettingsInput) =>
        request<void>(`/orgs/${orgId}/routing/settings`, { method: "PUT", body: JSON.stringify(input) }),
      setRouting: (orgId: string, connectionId: string, containerId: string, input: RoutingMappingInput) =>
        request<void>(`/orgs/${orgId}/routing/${connectionId}/${encodeURIComponent(containerId)}`, {
          method: "PUT",
          body: JSON.stringify(input),
        }),

      account: (orgId: string, accountId: string) => request<AccountDto>(`/orgs/${orgId}/accounts/${accountId}`),
    };
  }, [getToken]);
}

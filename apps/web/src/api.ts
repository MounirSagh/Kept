import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import type {
  AcceptedInvitationDto,
  AccountDto,
  CreatedInvitationDto,
  HealthDto,
  InvitationDto,
  MeDto,
  MemberDto,
  OrgDto,
  OrgRole,
  TeamDto,
} from "@kept/shared";

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
      if (!res.ok && res.status !== 503) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof body?.error === "string" ? body.error : `${res.status} ${res.statusText}`);
      }
      if (res.status === 204) return undefined as T;
      return res.json() as Promise<T>;
    }

    return {
      health: () => request<HealthDto>("/health"),
      me: () => request<MeDto>("/me"),
      createOrg: (input: { name: string; slug: string }) =>
        request<OrgDto>("/orgs", { method: "POST", body: JSON.stringify(input) }),
      renameOrg: (orgId: string, name: string) =>
        request<OrgDto>(`/orgs/${orgId}`, { method: "PATCH", body: JSON.stringify({ name }) }),

      teams: (orgId: string) => request<TeamDto[]>(`/orgs/${orgId}/teams`),
      createTeam: (orgId: string, name: string) =>
        request<TeamDto>(`/orgs/${orgId}/teams`, { method: "POST", body: JSON.stringify({ name }) }),
      renameTeam: (orgId: string, teamId: string, name: string) =>
        request<TeamDto>(`/orgs/${orgId}/teams/${teamId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
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
      revokeInvitation: (orgId: string, invitationId: string) =>
        request<void>(`/orgs/${orgId}/invitations/${invitationId}`, { method: "DELETE" }),
      acceptInvitation: (token: string) =>
        request<AcceptedInvitationDto>("/invitations/accept", { method: "POST", body: JSON.stringify({ token }) }),

      accounts: (orgId: string) => request<AccountDto[]>(`/orgs/${orgId}/accounts`),
      account: (orgId: string, accountId: string) => request<AccountDto>(`/orgs/${orgId}/accounts/${accountId}`),
    };
  }, [getToken]);
}

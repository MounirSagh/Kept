import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import type { Actor, MeDto, MemberDto, TeamDto } from "@kept/shared";
import { useApi } from "../api";

export type Org = MeDto["orgs"][number];

export interface OrgContext {
  me: MeDto;
  org: Org;
  orgId: string;
  actor: Actor;
  members: MemberDto[];
  teams: TeamDto[];
  /** Reload members and teams after a change. */
  refresh: () => Promise<void>;
  /** The signed-in user's own profile or membership changed (role, team, org name, or left the org). */
  onSelfChanged: () => void;
}

const Ctx = createContext<OrgContext | null>(null);

export function useOrg() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOrg must be used inside <OrgProvider>");
  return ctx;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/** Loads the org named by `:orgSlug` along with its members and teams. */
export function OrgProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const api = useApi();
  const { orgSlug } = useParams();
  const [me, setMe] = useState<MeDto | null>(null);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const loadMe = useCallback(() => {
    api.me().then(setMe, (err: Error) => setState({ status: "error", message: err.message }));
  }, [api]);

  useEffect(loadMe, [loadMe]);

  const org = me?.orgs.find((o) => o.slug === orgSlug);
  const orgId = org?.id;

  const refresh = useCallback(async () => {
    if (!orgId) return;
    try {
      const [m, t] = await Promise.all([api.members(orgId), api.teams(orgId)]);
      setMembers(m);
      setTeams(t);
      setState({ status: "ready" });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }, [api, orgId]);

  // Switching orgs shows the loading state instead of the previous org's people.
  useEffect(() => {
    setState({ status: "loading" });
    void refresh();
  }, [refresh]);

  if (state.status === "error") return <p className="p-6 text-sm text-danger">{state.message}</p>;
  if (!me) return fallback;
  // Unknown slug, or the user just left this org.
  if (!org) return <Navigate to="/home" replace />;
  if (state.status === "loading") return fallback;

  const actor: Actor = {
    userId: me.user.id,
    isPlatformAdmin: me.user.isPlatformAdmin,
    role: org.role,
    teamId: org.teamId,
  };

  return (
    <Ctx.Provider value={{ me, org, orgId: org.id, actor, members, teams, refresh, onSelfChanged: loadMe }}>
      {children}
    </Ctx.Provider>
  );
}

export function memberName(members: MemberDto[], userId: string | null) {
  if (!userId) return "—";
  const m = members.find((x) => x.userId === userId);
  return m ? (m.fullName ?? m.email) : "Former member";
}

export function teamName(teams: TeamDto[], teamId: string | null) {
  return teams.find((t) => t.id === teamId)?.name ?? "—";
}

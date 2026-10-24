// Single source of truth for who may do what inside an org. The API enforces
// these rules; the web app uses the same functions to decide what to show.

export type OrgRole = "owner" | "manager" | "member";

export const ORG_ROLES: readonly OrgRole[] = ["owner", "manager", "member"];

/** The signed-in user as seen from one org. `role` is null for a platform admin who isn't a member. */
export interface Actor {
  userId: string;
  isPlatformAdmin: boolean;
  role: OrgRole | null;
  teamId: string | null;
}

/** A membership or invitation being created, changed, or removed. */
export interface MemberTarget {
  userId?: string;
  role: OrgRole;
  teamId: string | null;
}

/** personal: one member's own account (mailbox, calendar). org: a workspace connected for everyone. */
export type ConnectionScope = "personal" | "org";

export type Permission =
  | { action: "org.manage" }
  | { action: "account.manage" }
  | { action: "connection.create"; scope: ConnectionScope }
  | { action: "connection.manage"; scope: ConnectionScope; ownerUserId: string | null }
  | { action: "team.manage" }
  | { action: "invitation.create"; target: MemberTarget }
  | { action: "invitation.list" }
  | { action: "invitation.revoke"; target: MemberTarget }
  | { action: "member.update"; target: MemberTarget; next: MemberTarget }
  | { action: "member.remove"; target: MemberTarget };

function isSuperuser(actor: Actor) {
  return actor.isPlatformAdmin || actor.role === "owner";
}

/** Managers act only on plain members of their own team. */
function managesTarget(actor: Actor, target: MemberTarget) {
  return (
    actor.role === "manager" &&
    actor.teamId !== null &&
    target.role === "member" &&
    target.teamId === actor.teamId
  );
}

export function can(actor: Actor, permission: Permission): boolean {
  switch (permission.action) {
    case "org.manage":
    case "team.manage":
    case "account.manage":
      return isSuperuser(actor);
    case "invitation.list":
      return isSuperuser(actor) || actor.role === "manager";
    case "invitation.create":
    case "invitation.revoke":
      return isSuperuser(actor) || managesTarget(actor, permission.target);
    case "member.update":
      return isSuperuser(actor);
    case "connection.create":
      // Anyone in the org can connect their own account; workspaces are connected by owners.
      return permission.scope === "personal" ? actor.role !== null || actor.isPlatformAdmin : isSuperuser(actor);
    case "connection.manage":
      // Sync now / disconnect: owners for anything, members for their own personal connections.
      return isSuperuser(actor) || (permission.scope === "personal" && permission.ownerUserId === actor.userId);
    case "member.remove":
      if (permission.target.userId === actor.userId) return true;
      return isSuperuser(actor) || managesTarget(actor, permission.target);
  }
}

/** Shape rules that hold no matter who is acting. Returns an error message, or null when valid. */
export function validateMemberTarget(target: MemberTarget): string | null {
  if (target.role === "manager" && target.teamId === null) return "A manager must belong to a team";
  return null;
}

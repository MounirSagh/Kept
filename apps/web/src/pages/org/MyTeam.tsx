import { UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { can, type CreatedInvitationDto, type InvitationDto, type MemberDto } from "@kept/shared";
import { useApi } from "../../api";
import { teamName, useOrg } from "../../app/org-context";
import { ConfirmDialog } from "../../components/Modal";
import { EmptyState, Page, Section } from "../../components/Page";
import { ui } from "../../ui";
import { CopyLinkDialog, InviteDialog, InviteImportDialog, InviteResult } from "./InviteDialog";
import { MemberIdentity, RemoveMemberDialog } from "./Members";

type Dialog =
  | { kind: "invite" }
  | { kind: "import" }
  | { kind: "link"; invitation: InvitationDto }
  | { kind: "remove"; member: MemberDto }
  | { kind: "resend"; invitation: InvitationDto }
  | { kind: "revoke"; invitation: InvitationDto };

/**
 * Pending invitations into the actor's team (the API scopes a manager's list to their team).
 * Members can't see invitations, so for them this is always empty and makes no request.
 */
export function useTeamInvitations() {
  const api = useApi();
  const { orgId, actor } = useOrg();
  const allowed = can(actor, { action: "invitation.list" });
  const [invitations, setInvitations] = useState<InvitationDto[] | null>(allowed ? null : []);
  const load = useCallback(async () => {
    if (!allowed) return;
    await api.invitations(orgId).then(setInvitations, () => setInvitations([]));
  }, [api, orgId, allowed]);
  useEffect(() => {
    void load();
  }, [load]);
  return { invitations, reload: load };
}

/**
 * The team page for managers and members. Managers invite and remove people here;
 * members see who they work with. Both can leave the org from here.
 */
export function MyTeamPage() {
  const api = useApi();
  const ctx = useOrg();
  const { actor, members, teams } = ctx;
  const isManager = actor.role === "manager";
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialog | null>(isManager && params.has("new") ? { kind: "invite" } : null);
  const self = members.find((m) => m.userId === actor.userId);
  const [resent, setResent] = useState<CreatedInvitationDto | null>(null);
  const { invitations, reload } = useTeamInvitations();

  function close() {
    setDialog(null);
    if (params.has("new")) setParams({}, { replace: true });
  }

  const leave = self && (
    <LeaveSection onLeave={() => setDialog({ kind: "remove", member: self })} />
  );
  const removeDialog = dialog?.kind === "remove" && (
    <RemoveMemberDialog
      member={dialog.member}
      onClose={close}
      onRemoved={async () => {
        if (dialog.member.userId === actor.userId) ctx.onSelfChanged();
        else await ctx.refresh();
      }}
    />
  );

  if (actor.teamId === null) {
    return (
      <Page title="My team">
        <EmptyState icon={UsersRound} title="You're not on a team yet">
          {isManager
            ? `Managers lead one team. Ask an owner of ${ctx.org.name} to add you to a team, then you can invite people into it.`
            : `Ask an owner of ${ctx.org.name} to add you to a team. You'll see your teammates and manager here.`}
        </EmptyState>
        <div className="mt-10">{leave}</div>
        {removeDialog}
      </Page>
    );
  }

  const name = teamName(teams, actor.teamId);
  const people = members.filter((m) => m.teamId === actor.teamId);
  const pending = invitations ?? [];
  const leaders = people.filter((m) => m.role === "manager").map((m) => (m.userId === actor.userId ? "you" : (m.fullName ?? m.email)));
  const count = `${people.length} ${people.length === 1 ? "person" : "people"}`;

  return (
    <Page
      title={name}
      description={
        isManager
          ? `${count} on your team. You see the accounts they own.`
          : `${count} on your team${leaders.length > 0 ? `, led by ${leaders.join(" and ")}` : ""}.`
      }
      actions={
        isManager && (
          <>
            <button className={ui.button.ghost} onClick={() => setDialog({ kind: "import" })}>
              Import CSV
            </button>
            <button className={ui.button.primary} onClick={() => setDialog({ kind: "invite" })}>
              Invite to {name}
            </button>
          </>
        )
      }
    >
      <Section title="People">
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Member</th>
                <th className={ui.th}>Role</th>
                <th className={ui.th}>Joined</th>
                <th className={ui.th} aria-label="Actions" />
              </tr>
            </thead>
            <tbody className={ui.tbody}>
              {people.map((m) => {
                const self = m.userId === actor.userId;
                const removable =
                  !self && can(actor, { action: "member.remove", target: { userId: m.userId, role: m.role, teamId: m.teamId } });
                return (
                  <tr key={m.userId}>
                    <td className={ui.td}>
                      <MemberIdentity member={m} self={self} />
                    </td>
                    <td className={ui.td}>
                      <span className={ui.badge}>{m.role}</span>
                    </td>
                    <td className={`${ui.td} text-ink-muted tabular-nums`}>
                      {new Date(m.joinedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className={ui.tdActions}>
                      {removable && (
                        <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "remove", member: m })}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isManager && people.length === 1 && pending.length === 0 && (
          <p className={`${ui.hint} mt-3`}>
            It's just you so far. Invite the CSMs on your team so their accounts and commitments show up here.
          </p>
        )}
      </Section>

      {pending.length > 0 && (
        <Section title="Pending invitations" aside="Links expire after 7 days">
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <tbody className={ui.tbody}>
                {pending.map((i) => (
                  <tr key={i.id}>
                    <td className={`${ui.td} font-medium`}>{i.email}</td>
                    <td className={`${ui.td} text-ink-muted tabular-nums`}>
                      Expires {new Date(i.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </td>
                    <td className={ui.tdActions}>
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "resend", invitation: i })}>
                        Resend
                      </button>
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "link", invitation: i })}>
                        Copy link
                      </button>
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "revoke", invitation: i })}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {leave}

      {dialog?.kind === "invite" && <InviteDialog onClose={close} onInvited={() => void reload()} />}
      {dialog?.kind === "import" && (
        <InviteImportDialog
          onClose={() => {
            close();
            void reload();
          }}
        />
      )}
      {dialog?.kind === "link" && <CopyLinkDialog invitation={dialog.invitation} onClose={close} onIssued={() => void reload()} />}
      {removeDialog}
      {dialog?.kind === "resend" && (
        <ConfirmDialog
          title={`Resend invitation to ${dialog.invitation.email}?`}
          confirmLabel="Resend"
          onClose={close}
          onConfirm={async () => {
            setResent(await api.resendInvitation(ctx.orgId, dialog.invitation.id));
            await reload();
          }}
        >
          We'll email a new link and restart the 7-day expiry. The previous link stops working.
        </ConfirmDialog>
      )}
      {resent && <InviteResult invitation={resent} onClose={() => setResent(null)} />}
      {dialog?.kind === "revoke" && (
        <ConfirmDialog
          title={`Revoke invitation for ${dialog.invitation.email}?`}
          confirmLabel="Revoke"
          tone="danger"
          onClose={close}
          onConfirm={async () => {
            await api.revokeInvitation(ctx.orgId, dialog.invitation.id);
            await reload();
          }}
        >
          The link stops working immediately. You can invite them again later.
        </ConfirmDialog>
      )}
    </Page>
  );
}

function LeaveSection({ onLeave }: { onLeave: () => void }) {
  const { org } = useOrg();
  return (
    <Section title="Your membership">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line px-4 py-4">
        <p className="min-w-0 flex-1 text-sm text-ink-muted">
          Leaving removes your access to {org.name}. Accounts you own stay in place for an owner to reassign.
        </p>
        <button className={ui.button.ghostSm} onClick={onLeave}>
          Leave {org.name}
        </button>
      </div>
    </Section>
  );
}

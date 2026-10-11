import { Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { can, type InvitationDto } from "@kept/shared";
import { useApi } from "../../api";
import { teamName, useOrg } from "../../app/org-context";
import { ConfirmDialog } from "../../components/Modal";
import { EmptyState, Loading, Page } from "../../components/Page";
import { ui } from "../../ui";
import { InviteDialog } from "./InviteDialog";

type Dialog = { kind: "invite" } | { kind: "revoke"; invitation: InvitationDto };

export function InvitationsPage() {
  const api = useApi();
  const { orgId, actor, teams } = useOrg();
  const [params, setParams] = useSearchParams();
  const [invitations, setInvitations] = useState<InvitationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Links like the Overview checklist open the invite modal with ?new=1.
  const [dialog, setDialog] = useState<Dialog | null>(params.has("new") ? { kind: "invite" } : null);

  const load = useCallback(
    () => api.invitations(orgId).then(setInvitations, (err: Error) => setError(err.message)),
    [api, orgId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  function close() {
    setDialog(null);
    if (params.has("new")) setParams({}, { replace: true });
  }

  if (actor.role === "manager" && !actor.isPlatformAdmin && actor.teamId === null) {
    return (
      <Page title="Invitations">
        <EmptyState icon={Mail} title="You're not on a team yet">
          Managers invite people into their own team. Ask an owner to add you to a team first.
        </EmptyState>
      </Page>
    );
  }

  const invite = (
    <button className={ui.button.primary} onClick={() => setDialog({ kind: "invite" })}>
      Invite people
    </button>
  );

  return (
    <Page
      title="Invitations"
      description="Pending invitations. Links expire after 7 days. Emails aren't sent yet, so share each link yourself."
      actions={invitations && invitations.length > 0 && invite}
    >
      {error && <p className={ui.errorBlock}>{error}</p>}
      {!invitations && !error && <Loading />}
      {invitations?.length === 0 && (
        <EmptyState icon={Mail} title="No pending invitations" action={invite}>
          Invite the managers and CSMs who own customer relationships. Invitations stay here until they're accepted,
          revoked or expire.
        </EmptyState>
      )}
      {invitations && invitations.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Email</th>
                <th className={ui.th}>Role</th>
                <th className={ui.th}>Team</th>
                <th className={ui.th}>Expires</th>
                <th className={ui.th} aria-label="Actions" />
              </tr>
            </thead>
            <tbody className={ui.tbody}>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <td className={`${ui.td} font-medium`}>{i.email}</td>
                  <td className={ui.td}>
                    <span className={ui.badge}>{i.role}</span>
                  </td>
                  <td className={ui.td}>{teamName(teams, i.teamId)}</td>
                  <td className={`${ui.td} tabular-nums`}>
                    {new Date(i.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </td>
                  <td className={ui.tdActions}>
                    {can(actor, { action: "invitation.revoke", target: { role: i.role, teamId: i.teamId } }) && (
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "revoke", invitation: i })}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === "invite" && <InviteDialog onClose={close} onInvited={() => void load()} />}
      {dialog?.kind === "revoke" && (
        <ConfirmDialog
          title={`Revoke invitation for ${dialog.invitation.email}?`}
          confirmLabel="Revoke"
          tone="danger"
          onClose={close}
          onConfirm={async () => {
            await api.revokeInvitation(orgId, dialog.invitation.id);
            await load();
          }}
        >
          The link stops working immediately. You can invite them again later.
        </ConfirmDialog>
      )}
    </Page>
  );
}

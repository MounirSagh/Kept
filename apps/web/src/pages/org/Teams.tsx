import { UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { can, type TeamDto } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { ConfirmDialog, Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { EmptyState, Page } from "../../components/Page";
import { ui } from "../../ui";

type Dialog = { kind: "create" } | { kind: "rename"; team: TeamDto } | { kind: "delete"; team: TeamDto };

export function TeamsPage() {
  const api = useApi();
  const ctx = useOrg();
  const manage = can(ctx.actor, { action: "team.manage" });
  const [params, setParams] = useSearchParams();
  // Links like the Overview checklist open the create modal with ?new=1.
  const [dialog, setDialog] = useState<Dialog | null>(manage && params.has("new") ? { kind: "create" } : null);

  function close() {
    setDialog(null);
    if (params.has("new")) setParams({}, { replace: true });
  }

  const memberCount = (teamId: string) => ctx.members.filter((m) => m.teamId === teamId).length;
  const managers = (teamId: string) =>
    ctx.members
      .filter((m) => m.teamId === teamId && m.role === "manager")
      .map((m) => m.fullName ?? m.email)
      .join(", ") || "—";

  const newTeam = (
    <button className={ui.button.primary} onClick={() => setDialog({ kind: "create" })}>
      New team
    </button>
  );

  return (
    <Page
      title="Teams"
      description="Each person belongs to at most one team. A manager leads one team."
      actions={manage && ctx.teams.length > 0 && newTeam}
    >
      {ctx.teams.length === 0 ? (
        <EmptyState icon={UsersRound} title="No teams yet" action={manage && newTeam}>
          Teams group people under a manager. Managers see their team's accounts and can invite people into it.
        </EmptyState>
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Team</th>
                <th className={ui.th}>Managers</th>
                <th className={`${ui.th} text-right`}>People</th>
                {manage && <th className={ui.th} aria-label="Actions" />}
              </tr>
            </thead>
            <tbody className={ui.tbody}>
              {ctx.teams.map((t) => (
                <tr key={t.id}>
                  <td className={`${ui.td} font-medium`}>{t.name}</td>
                  <td className={ui.td}>{managers(t.id)}</td>
                  <td className={`${ui.td} text-right tabular-nums`}>{memberCount(t.id)}</td>
                  {manage && (
                    <td className={ui.tdActions}>
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "rename", team: t })}>
                        Rename
                      </button>
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "delete", team: t })}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === "create" && <TeamDialog onClose={close} />}
      {dialog?.kind === "rename" && <TeamDialog team={dialog.team} onClose={close} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.team.name}?`}
          confirmLabel="Delete team"
          tone="danger"
          onClose={close}
          onConfirm={async () => {
            await api.deleteTeam(ctx.orgId, dialog.team.id);
            await ctx.refresh();
          }}
        >
          {memberCount(dialog.team.id) > 0
            ? "Move this team's people to another team first. Pending invitations into it will be revoked."
            : "Pending invitations into this team will be revoked."}
        </ConfirmDialog>
      )}
    </Page>
  );
}

/** Creates a team, or renames `team` when given. */
function TeamDialog({ team, onClose }: { team?: TeamDto; onClose: () => void }) {
  const api = useApi();
  const { orgId, refresh } = useOrg();
  const [name, setName] = useState(team?.name ?? "");
  const { pending, error, submit } = useSubmit();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      if (team) await api.renameTeam(orgId, team.id, name);
      else await api.createTeam(orgId, name);
      await refresh();
      onClose();
    });
  }

  return (
    <Modal title={team ? "Rename team" : "New team"} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <Field label="Name" htmlFor="team-name">
          <input
            id="team-name"
            className={`${ui.input} w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Enterprise"
            maxLength={100}
            autoFocus
            required
          />
        </Field>
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending || name.trim() === (team?.name ?? "")}>
            {pending ? "Saving…" : team ? "Save" : "Create team"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

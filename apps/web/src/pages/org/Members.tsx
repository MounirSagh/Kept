import { useState, type FormEvent } from "react";
import { can, ORG_ROLES, type MemberDto, type MemberTarget, type OrgRole } from "@kept/shared";
import { useApi } from "../../api";
import { teamName, useOrg } from "../../app/org-context";
import { ConfirmDialog, Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { Page } from "../../components/Page";
import { roleLabel, ui } from "../../ui";
import { InviteDialog } from "./InviteDialog";

type Dialog = { kind: "invite" } | { kind: "edit"; member: MemberDto } | { kind: "remove"; member: MemberDto };

export function MembersPage() {
  const ctx = useOrg();
  const { actor, members, teams } = ctx;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  async function afterChange(member: MemberDto) {
    if (member.userId === actor.userId) ctx.onSelfChanged();
    await ctx.refresh();
  }

  return (
    <Page
      title="Members"
      description={`${members.length} ${members.length === 1 ? "person" : "people"} in ${ctx.org.name}.`}
      actions={
        can(actor, { action: "invitation.list" }) && (
          <button className={ui.button.primary} onClick={() => setDialog({ kind: "invite" })}>
            Invite people
          </button>
        )
      }
    >
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>Member</th>
              <th className={ui.th}>Role</th>
              <th className={ui.th}>Team</th>
              <th className={ui.th} aria-label="Actions" />
            </tr>
          </thead>
          <tbody className={ui.tbody}>
            {members.map((m) => {
              const target: MemberTarget = { userId: m.userId, role: m.role, teamId: m.teamId };
              const editable = can(actor, { action: "member.update", target, next: target });
              const removable = can(actor, { action: "member.remove", target });
              const self = m.userId === actor.userId;
              return (
                <tr key={m.userId}>
                  <td className={ui.td}>
                    <MemberIdentity member={m} self={self} />
                  </td>
                  <td className={ui.td}>
                    <span className={ui.badge}>{m.role}</span>
                  </td>
                  <td className={ui.td}>{teamName(teams, m.teamId)}</td>
                  <td className={ui.tdActions}>
                    {editable && (
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "edit", member: m })}>
                        Edit
                      </button>
                    )}
                    {removable && (
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "remove", member: m })}>
                        {self ? "Leave" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog?.kind === "invite" && <InviteDialog onClose={close} />}
      {dialog?.kind === "edit" && (
        <EditMemberDialog member={dialog.member} onClose={close} onSaved={() => afterChange(dialog.member)} />
      )}
      {dialog?.kind === "remove" && (
        <RemoveMemberDialog member={dialog.member} onClose={close} onRemoved={() => afterChange(dialog.member)} />
      )}
    </Page>
  );
}

function EditMemberDialog({
  member,
  onClose,
  onSaved,
}: {
  member: MemberDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useApi();
  const { orgId, teams } = useOrg();
  const [role, setRole] = useState<OrgRole>(member.role);
  const [teamId, setTeamId] = useState<string | null>(member.teamId);
  const { pending, error, submit } = useSubmit();
  const unchanged = role === member.role && teamId === member.teamId;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      await api.updateMember(orgId, member.userId, { role, teamId });
      await onSaved();
      onClose();
    });
  }

  return (
    <Modal title={`Edit ${member.fullName ?? member.email}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role" htmlFor="member-role">
            <select
              id="member-role"
              className={`${ui.select} w-full`}
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
            >
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </Field>
          <Field label="Team" htmlFor="member-team">
            <select
              id="member-team"
              className={`${ui.select} w-full`}
              value={teamId ?? ""}
              onChange={(e) => setTeamId(e.target.value || null)}
            >
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <p className={ui.hint}>
          {role === "manager" && teamId === null
            ? "A manager needs a team."
            : "Owners manage the whole org. Managers manage the people on their team."}
        </p>
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending || unchanged}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

export function RemoveMemberDialog({
  member,
  onClose,
  onRemoved,
}: {
  member: MemberDto;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const api = useApi();
  const { orgId, org, actor } = useOrg();
  const self = member.userId === actor.userId;
  const name = member.fullName ?? member.email;

  return (
    <ConfirmDialog
      title={self ? `Leave ${org.name}?` : `Remove ${name}?`}
      confirmLabel={self ? "Leave organization" : "Remove"}
      tone="danger"
      onClose={onClose}
      onConfirm={async () => {
        await api.removeMember(orgId, member.userId);
        await onRemoved();
      }}
    >
      {self
        ? "You'll lose access to its accounts and commitments until someone invites you again."
        : `${name} will lose access to ${org.name}. Accounts they own stay in place and can be reassigned.`}
    </ConfirmDialog>
  );
}

export function MemberIdentity({ member, self }: { member: MemberDto; self: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar text-xs font-medium text-ink-muted">
        {initials(member)}
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">
          {member.fullName ?? member.email}
          {self && <span className="font-normal text-ink-muted"> (you)</span>}
        </div>
        {member.fullName && <div className={`${ui.hint} truncate`}>{member.email}</div>}
      </div>
    </div>
  );
}

function initials(m: MemberDto) {
  const source = m.fullName ?? m.email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (m.fullName ? (parts[1]?.[0] ?? "") : "")).toUpperCase();
}

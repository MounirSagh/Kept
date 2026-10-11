import { Check, Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { can, ORG_ROLES, type CreatedInvitationDto, type OrgRole } from "@kept/shared";
import { useApi } from "../../api";
import { teamName, useOrg } from "../../app/org-context";
import { Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { roleLabel, ui } from "../../ui";

export function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited?: () => void }) {
  const api = useApi();
  const { orgId, actor, teams } = useOrg();
  // Managers can only invite into their own team, so their team is fixed.
  const isManager = actor.role === "manager" && !actor.isPlatformAdmin;
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState<string | null>(isManager ? actor.teamId : null);
  const [role, setRole] = useState<OrgRole>("member");
  const [created, setCreated] = useState<CreatedInvitationDto | null>(null);
  const { pending, error, submit } = useSubmit();

  const allowedRoles = ORG_ROLES.filter((r) => can(actor, { action: "invitation.create", target: { role: r, teamId } }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      setCreated(await api.invite(orgId, { email, role, teamId }));
      onInvited?.();
    });
  }

  if (created) return <InviteLink invitation={created} onClose={onClose} />;

  return (
    <Modal
      title="Invite people"
      description={
        isManager
          ? `They'll join ${teamName(teams, teamId)} as a member.`
          : "They'll join with the role and team you pick here."
      }
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <Field label="Email" htmlFor="invite-email">
          <input
            id="invite-email"
            className={`${ui.input} w-full`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            autoFocus
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role" htmlFor="invite-role">
            {allowedRoles.length === 1 ? (
              <input id="invite-role" className={`${ui.input} w-full bg-sidebar text-ink-muted`} value={roleLabel(role)} readOnly />
            ) : (
              <select
                id="invite-role"
                className={`${ui.select} w-full`}
                value={role}
                onChange={(e) => setRole(e.target.value as OrgRole)}
              >
                {allowedRoles.map((r) => (
                  <option key={r} value={r}>{roleLabel(r)}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Team" htmlFor="invite-team">
            {isManager ? (
              <input id="invite-team" className={`${ui.input} w-full bg-sidebar text-ink-muted`} value={teamName(teams, teamId)} readOnly />
            ) : (
              <select
                id="invite-team"
                className={`${ui.select} w-full`}
                value={teamId ?? ""}
                onChange={(e) => setTeamId(e.target.value || null)}
              >
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {role === "manager" && teamId === null && <p className={ui.hint}>A manager needs a team.</p>}
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending}>
            {pending ? "Creating…" : "Create invite link"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function InviteLink({ invitation, onClose }: { invitation: CreatedInvitationDto; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(invitation.acceptUrl);
    setCopied(true);
  }

  return (
    <Modal
      title="Invite link ready"
      description={
        <>
          Send this link to <span className="font-medium text-ink">{invitation.email}</span>. It works once, expires in 7
          days, and is shown only now.
        </>
      }
      onClose={onClose}
    >
      <div className="flex gap-2">
        <input
          className={`${ui.input} min-w-0 flex-1 font-mono text-xs`}
          value={invitation.acceptUrl}
          readOnly
          onFocus={(e) => e.target.select()}
          aria-label="Invite link"
        />
        <button type="button" className={ui.button.ghost} onClick={() => void copy()}>
          {copied ? <Check className="size-4 text-accent" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <ModalActions>
        <button type="button" className={ui.button.primary} onClick={onClose}>
          Done
        </button>
      </ModalActions>
    </Modal>
  );
}

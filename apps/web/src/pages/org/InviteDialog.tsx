import { Check, Copy } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { can, ORG_ROLES, toInvitationRows, type CreatedInvitationDto, type InvitationDto, type OrgRole } from "@kept/shared";
import { useApi } from "../../api";
import { teamName, useOrg } from "../../app/org-context";
import { ImportDialog } from "../../components/ImportDialog";
import { ConfirmDialog, Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
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

  if (created) return <InviteResult invitation={created} onClose={onClose} />;

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
            {pending ? "Sending…" : "Send invitation"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

/**
 * Shown after an invitation is created, resent, or given a new link: confirms the email, or
 * hands over the link (always for mode "link", where the inviter asked for the link itself).
 */
export function InviteResult({
  invitation,
  onClose,
  mode = "sent",
}: {
  invitation: CreatedInvitationDto;
  onClose: () => void;
  mode?: "sent" | "link";
}) {
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(mode === "link" || !invitation.emailQueued);

  async function copy() {
    await navigator.clipboard.writeText(invitation.acceptUrl);
    setCopied(true);
  }

  const email = <span className="font-medium text-ink">{invitation.email}</span>;

  return (
    <Modal
      title={mode === "link" ? "New invite link" : invitation.emailQueued ? "Invitation sent" : "Share the invite link"}
      description={
        mode === "link" ? (
          <>Send this link to {email}. It works once, expires in 7 days, and is shown only now. Any earlier link no longer works.</>
        ) : invitation.emailQueued ? (
          <>We're emailing {email} a link to join. It works once and expires in 7 days.</>
        ) : (
          <>
            We couldn't email {email}, so send them this link yourself. It works once, expires in 7 days, and is shown
            only now.
          </>
        )
      }
      onClose={onClose}
    >
      {showLink ? (
        <div className="flex gap-2">
          <input
            className={`${ui.input} min-w-0 flex-1 font-mono text-xs`}
            value={invitation.acceptUrl}
            readOnly
            onFocus={(e) => e.target.select()}
            aria-label="Invite link"
          />
          <button type="button" className={ui.button.ghost} onClick={() => void copy()}>
            {copied ? <Check className="size-4 text-brand" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="text-[0.8125rem] font-medium text-brand hover:underline"
          onClick={() => setShowLink(true)}
        >
          Copy the link instead
        </button>
      )}
      <ModalActions>
        <button type="button" className={ui.button.primary} onClick={onClose}>
          Done
        </button>
      </ModalActions>
    </Modal>
  );
}

/**
 * For when the invitation email doesn't arrive: issues a fresh link without emailing it.
 * Links are stored only as hashes, so the earlier one can't be shown again; this replaces it.
 */
export function CopyLinkDialog({
  invitation,
  onClose,
  onIssued,
}: {
  invitation: InvitationDto;
  onClose: () => void;
  onIssued?: () => void;
}) {
  const api = useApi();
  const { orgId } = useOrg();
  const [issued, setIssued] = useState<CreatedInvitationDto | null>(null);
  // ConfirmDialog closes itself after confirming; keep this dialog open to show the link.
  const issuedRef = useRef(false);

  if (issued) return <InviteResult invitation={issued} mode="link" onClose={onClose} />;
  return (
    <ConfirmDialog
      title={`Get a link for ${invitation.email}?`}
      confirmLabel="Get link"
      onClose={() => {
        if (!issuedRef.current) onClose();
      }}
      onConfirm={async () => {
        const result = await api.invitationLink(orgId, invitation.id);
        issuedRef.current = true;
        setIssued(result);
        onIssued?.();
      }}
    >
      You'll get a new link to share yourself, and the 7-day expiry restarts. The link in any email already sent stops
      working.
    </ConfirmDialog>
  );
}

const INVITES_TEMPLATE = `Email,Role,Team
lina@yourcompany.com,member,Enterprise
omar@yourcompany.com,manager,Mid-market
`;

/** Bulk invitations: everyone in the file gets an invitation email, with the same rules as one at a time. */
export function InviteImportDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { orgId, actor, teams } = useOrg();
  const isManager = actor.role === "manager" && !actor.isPlatformAdmin;
  return (
    <ImportDialog
      title="Invite people from a CSV"
      description={
        isManager
          ? `One row per person. Everyone joins ${teamName(teams, actor.teamId)} as a member and gets an invitation email.`
          : "One row per person: email, role (owner, manager or member; member if blank) and team name. Everyone gets an invitation email. Managers need a team."
      }
      template={isManager ? "Email\nlina@yourcompany.com\n" : INVITES_TEMPLATE}
      templateName="kept-invitations.csv"
      convert={toInvitationRows}
      columns={[
        { label: "Email", render: (r) => r.email },
        { label: "Role", render: (r) => roleLabel(r.role) },
        { label: "Team", render: (r) => r.team ?? (isManager ? teamName(teams, actor.teamId) : null) },
      ]}
      onImport={(rows) => api.importInvitations(orgId, rows)}
      onClose={onClose}
    />
  );
}

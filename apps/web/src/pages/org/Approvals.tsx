import { BellRing, CircleCheck, Mail, Megaphone, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { ActionPayload, ActionsDto, AlertPayload, ProposedActionDto, ReminderPayload, SendEmailPayload } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { EmptyState, Loading, Page } from "../../components/Page";
import { cx, ui } from "../../ui";
import { formatDue, today } from "./Commitments";
import { SEVERITY } from "./Flags";

const TABS = [
  { id: "pending", label: "To review" },
  { id: "history", label: "History" },
] as const;

const TYPE: Record<ProposedActionDto["type"], { label: string; icon: LucideIcon; approve: string }> = {
  send_email: { label: "Email", icon: Mail, approve: "Approve and send" },
  schedule_reminder: { label: "Reminder", icon: BellRing, approve: "Approve reminder" },
  internal_alert: { label: "Team alert", icon: Megaphone, approve: "Approve and notify" },
};

const STATUS: Record<ProposedActionDto["status"], { label: string; className: string }> = {
  pending: { label: "To review", className: "" },
  approved: { label: "Approved", className: "" },
  executing: { label: "Sending", className: "" },
  done: { label: "Done", className: "border-brand/30 bg-brand-soft text-brand" },
  rejected: { label: "Rejected", className: "" },
  failed: { label: "Failed", className: "border-danger/30 bg-danger-soft text-danger" },
};

/** One line saying what the action will do. */
function headline(a: ProposedActionDto) {
  if (a.type === "send_email") {
    const p = a.payload as SendEmailPayload;
    return <>Email {p.to.join(", ")}: <span className="text-ink-muted">“{p.subject}”</span></>;
  }
  if (a.type === "schedule_reminder") {
    const p = a.payload as ReminderPayload;
    return <>Remind the account owner on {formatDue(p.remindOn)}: <span className="text-ink-muted">{p.title}</span></>;
  }
  return <>Alert the account team: <span className="text-ink-muted">{(a.payload as AlertPayload).message}</span></>;
}

export function ApprovalsPage() {
  const api = useApi();
  const { orgId } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") === "history" ? "history" : "pending";
  const [data, setData] = useState<ActionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<ProposedActionDto | null>(null);

  const load = useCallback(() => api.actions(orgId, tab).then(setData, (err: Error) => setError(err.message)), [api, orgId, tab]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const needsMailbox = !!data && !data.canSendEmail && data.actions.some((a) => a.type === "send_email" && (a.status === "pending" || a.status === "failed"));

  return (
    <Page title="Approvals" description="Follow-ups Kept proposes. Nothing happens until someone approves it.">
      <div className="mb-5 flex gap-1" role="tablist" aria-label="View">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === "pending" ? {} : { view: t.id }, { replace: true })}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              tab === t.id ? "bg-selected text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {needsMailbox && (
        <div className={ui.notice}>
          <p className="text-sm font-medium">Emails go out from your own mailbox</p>
          <p className="mt-1 text-sm text-ink-muted">
            To approve emails, connect Gmail or Outlook with permission to send. If you connected one before, reconnect it
            to grant sending.{" "}
            <Link to="../integrations" className="font-medium text-brand hover:text-brand-hover">
              Go to Integrations
            </Link>
          </p>
        </div>
      )}

      {error && <p className={ui.errorBlock}>{error}</p>}
      {!data && !error && <Loading />}

      {data?.actions.length === 0 &&
        (tab === "pending" ? (
          <EmptyState icon={CircleCheck} title="Nothing to review">
            For each flag, Kept drafts the next step: an email to the customer, a reminder or an alert for the team. You
            can edit, approve or reject each one here.
          </EmptyState>
        ) : (
          <EmptyState icon={CircleCheck} title="No decisions yet">
            Approved and rejected actions appear here, with what happened when they ran.
          </EmptyState>
        ))}

      {data && data.actions.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data.actions.map((a) => {
            const Icon = TYPE[a.type].icon;
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar text-ink-muted">
                  <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span>{TYPE[a.type].label}</span>
                    {a.accountName && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="font-medium text-ink">{a.accountName}</span>
                      </>
                    )}
                    {a.status !== "pending" && <span className={cx(ui.badge, "normal-case", STATUS[a.status].className)}>{STATUS[a.status].label}</span>}
                    {a.edited && <span>Edited</span>}
                  </div>
                  <p className="mt-1.5 text-sm font-medium wrap-break-word">{headline(a)}</p>
                  {a.flag && (
                    <p className="mt-1 text-[0.8125rem] text-ink-muted">
                      For: <span className={cx(ui.badge, "mr-1 normal-case", SEVERITY[a.flag.severity].className)}>{SEVERITY[a.flag.severity].label}</span>
                      {a.flag.title}
                    </p>
                  )}
                  {a.status === "failed" && a.lastError && <p className="mt-1.5 text-[0.8125rem] text-danger">{a.lastError}</p>}
                  {tab === "history" && a.decidedBy && (
                    <p className="mt-1.5 text-[0.8125rem] text-ink-muted">
                      {a.status === "rejected" ? "Rejected" : "Approved"} by {a.decidedBy}
                      {a.decisionNote && <>: “{a.decisionNote}”</>}
                    </p>
                  )}
                </div>
                {(a.status === "pending" || a.status === "failed") && (
                  <button className={ui.button.ghostSm} onClick={() => setReviewing(a)}>
                    {a.status === "failed" ? "Review again" : "Review"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {reviewing && (
        <ReviewDialog
          action={reviewing}
          onClose={() => setReviewing(null)}
          onDone={async () => {
            setReviewing(null);
            await load();
          }}
        />
      )}
    </Page>
  );
}

function ReviewDialog({ action, onClose, onDone }: { action: ProposedActionDto; onClose: () => void; onDone: () => Promise<void> }) {
  const api = useApi();
  const { orgId } = useOrg();
  const { pending, error, submit } = useSubmit();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [payload, setPayload] = useState<ActionPayload>(action.payload);
  // Recipients are edited as text and split on approve, so typing a comma doesn't get swallowed.
  const [toText, setToText] = useState(action.type === "send_email" ? (action.payload as SendEmailPayload).to.join(", ") : "");
  const set = (changes: Partial<SendEmailPayload & ReminderPayload & AlertPayload>) => setPayload((p) => ({ ...p, ...changes }) as ActionPayload);

  function approve(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      const final: ActionPayload =
        action.type === "send_email" ? { ...(payload as SendEmailPayload), to: toText.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean) } : payload;
      const changed = JSON.stringify(final) !== JSON.stringify(action.payload);
      await api.decideAction(orgId, action.id, { decision: "approve", payload: changed ? final : undefined });
      await onDone();
    });
  }

  function reject(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      await api.decideAction(orgId, action.id, { decision: "reject", note: note.trim() || undefined });
      await onDone();
    });
  }

  const description = (
    <>
      {action.accountName && <span className="font-medium text-ink">{action.accountName}. </span>}
      {action.rationale}
    </>
  );

  if (rejecting) {
    return (
      <Modal title={`Reject ${TYPE[action.type].label.toLowerCase()}`} description={description} onClose={onClose}>
        <form onSubmit={reject}>
          <Field label="Why not? (optional)" htmlFor="reject-note" hint="Kept learns from this for future suggestions.">
            <textarea id="reject-note" rows={3} className={cx(ui.input, "w-full resize-y")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus />
          </Field>
          <FormError error={error} />
          <ModalActions>
            <button type="button" className={ui.button.ghost} onClick={() => setRejecting(false)} disabled={pending}>
              Back
            </button>
            <button type="submit" className={ui.button.danger} disabled={pending}>
              {pending ? "Rejecting…" : "Reject"}
            </button>
          </ModalActions>
        </form>
      </Modal>
    );
  }

  return (
    <Modal title={`Review ${TYPE[action.type].label.toLowerCase()}`} description={description} onClose={onClose} wide={action.type === "send_email"}>
      <form onSubmit={approve} className="space-y-4">
        {action.type === "send_email" && (
          <>
            <Field label="To" htmlFor="email-to" hint="Separate addresses with commas.">
              <input
                id="email-to"
                className={cx(ui.input, "w-full")}
                value={toText}
                onChange={(e) => setToText(e.target.value)}
                required
              />
            </Field>
            <Field label="Subject" htmlFor="email-subject">
              <input id="email-subject" className={cx(ui.input, "w-full")} value={(payload as SendEmailPayload).subject} onChange={(e) => set({ subject: e.target.value })} maxLength={300} required />
            </Field>
            <Field label="Message" htmlFor="email-body" hint="Sent as plain text from your own Gmail or Outlook.">
              <textarea id="email-body" rows={10} className={cx(ui.input, "w-full resize-y leading-relaxed")} value={(payload as SendEmailPayload).body} onChange={(e) => set({ body: e.target.value })} required />
            </Field>
          </>
        )}
        {action.type === "schedule_reminder" && (
          <>
            <Field label="Remind about" htmlFor="reminder-title">
              <input id="reminder-title" className={cx(ui.input, "w-full")} value={(payload as ReminderPayload).title} onChange={(e) => set({ title: e.target.value })} maxLength={300} required />
            </Field>
            <Field label="On" htmlFor="reminder-date" hint="The account owner gets an email that morning.">
              <input id="reminder-date" type="date" className={ui.input} min={today()} value={(payload as ReminderPayload).remindOn} onChange={(e) => set({ remindOn: e.target.value })} required />
            </Field>
          </>
        )}
        {action.type === "internal_alert" && (
          <Field label="Message" htmlFor="alert-message" hint="Emailed to the account owner.">
            <textarea id="alert-message" rows={4} className={cx(ui.input, "w-full resize-y")} value={(payload as AlertPayload).message} onChange={(e) => set({ message: e.target.value })} maxLength={2000} required />
          </Field>
        )}

        {action.status === "failed" && action.lastError && <p className="text-sm text-danger">Last attempt failed: {action.lastError}</p>}
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={cx(ui.button.ghost, "mr-auto")} onClick={() => setRejecting(true)} disabled={pending}>
            Reject
          </button>
          <button type="button" className={ui.button.ghost} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending}>
            {pending ? "Approving…" : TYPE[action.type].approve}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

import { BellRing, Building2, CircleCheck, CircleDot, ExternalLink, ListTodo, Mail, Megaphone, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  AccountUpdatePayload, ActionPayload, ActionsDto, AlertPayload, CrmTaskPayload, ProposedActionDto, ReminderPayload, SendEmailPayload, TicketPayload,
} from "@kept/shared";
import { useApi } from "../../api";
import { CompanyFilter, companyParam } from "../../components/CompanyFilter";
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
  update_account: { label: "Company update", icon: Building2, approve: "Approve and update" },
  create_ticket: { label: "Linear issue", icon: CircleDot, approve: "Approve and create" },
  update_crm: { label: "HubSpot task", icon: ListTodo, approve: "Approve and add" },
};

function money(value: string | null, currency: string | null) {
  if (!value) return null;
  try {
    return Number(value).toLocaleString(undefined, { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 });
  } catch {
    return `${value} ${currency ?? ""}`.trim();
  }
}

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
  if (a.type === "update_account") {
    const p = a.payload as AccountUpdatePayload;
    const changes = [
      p.renewalDate && `renewal date ${formatDue(p.renewalDate)}`,
      p.annualValue && `contract value ${money(p.annualValue, p.currency)}/yr`,
    ].filter(Boolean);
    return <>Set {changes.join(" and ")}: <span className="text-ink-muted">from “{p.documentTitle}”</span></>;
  }
  if (a.type === "create_ticket") {
    const p = a.payload as TicketPayload;
    return <>Create a Linear issue in {p.teamKey}: <span className="text-ink-muted">“{p.title}”</span></>;
  }
  if (a.type === "update_crm") {
    const p = a.payload as CrmTaskPayload;
    return <>Add a HubSpot task due {formatDue(p.dueDate)}: <span className="text-ink-muted">“{p.subject}”</span></>;
  }
  return <>Alert the account team: <span className="text-ink-muted">{(a.payload as AlertPayload).message}</span></>;
}

/** A link to what the action created in another tool, once it ran. */
function created(a: ProposedActionDto) {
  if (a.status !== "done" || !a.result) return null;
  if (a.type === "create_ticket" && typeof a.result.url === "string") {
    return (
      <a href={a.result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
        {String(a.result.issue ?? "Open issue")} <ExternalLink className="size-3" aria-hidden />
      </a>
    );
  }
  if (a.type === "update_crm") return <>Added in HubSpot{a.result.ownerAssigned ? ", assigned to the account owner" : " (no HubSpot user matched the owner's email, so it's unassigned)"}</>;
  return null;
}

export function ApprovalsPage() {
  const api = useApi();
  const { orgId } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") === "history" ? "history" : "pending";
  const [company, setCompany] = companyParam(params, setParams);
  const [data, setData] = useState<ActionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<ProposedActionDto | null>(null);

  const load = useCallback(
    () => api.actions(orgId, tab, company).then(setData, (err: Error) => setError(err.message)),
    [api, orgId, tab, company],
  );
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const needsMailbox = !!data && !data.canSendEmail && data.actions.some((a) => a.type === "send_email" && (a.status === "pending" || a.status === "failed"));

  return (
    <Page title="Approvals" description="Follow-ups Kept proposes. Nothing happens until someone approves it.">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1" role="tablist" aria-label="View">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (t.id === "pending") next.delete("view");
              else next.set("view", t.id);
              setParams(next, { replace: true });
            }}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              tab === t.id ? "bg-selected text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
        <CompanyFilter value={company} onChange={setCompany} />
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
            For each flag, Kept drafts the next step: an email to the customer, a reminder, an alert for the team, a
            Linear issue or a HubSpot task. You can edit, approve or reject each one here.
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
                  {created(a) && <p className="mt-1.5 text-[0.8125rem] text-ink-muted">{created(a)}</p>}
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
          linearTeams={data?.linearTeams ?? []}
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

function ReviewDialog({
  action,
  linearTeams,
  onClose,
  onDone,
}: {
  action: ProposedActionDto;
  linearTeams: ActionsDto["linearTeams"];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const api = useApi();
  const { orgId } = useOrg();
  const { pending, error, submit } = useSubmit();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [payload, setPayload] = useState<ActionPayload>(action.payload);
  // Recipients are edited as text and split on approve, so typing a comma doesn't get swallowed.
  const [toText, setToText] = useState(action.type === "send_email" ? (action.payload as SendEmailPayload).to.join(", ") : "");
  const set = (changes: Partial<SendEmailPayload & ReminderPayload & AlertPayload & AccountUpdatePayload & TicketPayload & CrmTaskPayload>) => setPayload((p) => ({ ...p, ...changes }) as ActionPayload);

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
    <Modal
      title={`Review ${action.type === "create_ticket" ? "Linear issue" : action.type === "update_crm" ? "HubSpot task" : TYPE[action.type].label.toLowerCase()}`}
      description={description}
      onClose={onClose}
      wide={action.type === "send_email" || action.type === "create_ticket"}
    >
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
        {action.type === "update_account" && (
          <>
            <blockquote className="rounded-md bg-sidebar px-3.5 py-2.5 text-sm leading-relaxed">
              “{(payload as AccountUpdatePayload).excerpt}”
              <span className="mt-1 block text-xs text-ink-muted">{(payload as AccountUpdatePayload).documentTitle}</span>
            </blockquote>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Renewal date" htmlFor="upd-renewal">
                <input id="upd-renewal" type="date" className={cx(ui.input, "w-full")} value={(payload as AccountUpdatePayload).renewalDate ?? ""} onChange={(e) => set({ renewalDate: e.target.value || null })} />
              </Field>
              <Field label="Contract value per year" htmlFor="upd-value">
                <div className="flex gap-2">
                  <input id="upd-value" inputMode="decimal" className={cx(ui.input, "w-full")} value={(payload as AccountUpdatePayload).annualValue ?? ""} onChange={(e) => set({ annualValue: e.target.value || null })} />
                  <input aria-label="Currency" className={cx(ui.input, "w-20 uppercase")} maxLength={3} value={(payload as AccountUpdatePayload).currency ?? ""} onChange={(e) => set({ currency: e.target.value.toUpperCase() || null })} />
                </div>
              </Field>
            </div>
            {(payload as AccountUpdatePayload).noticeDays && (
              <p className={ui.hint}>The contract requires {(payload as AccountUpdatePayload).noticeDays} days&apos; notice to cancel.</p>
            )}
          </>
        )}
        {action.type === "create_ticket" && (
          <>
            <Field label="Team" htmlFor="ticket-team">
              <select id="ticket-team" className={cx(ui.input, "w-full")} value={(payload as TicketPayload).teamKey} onChange={(e) => set({ teamKey: e.target.value })} required>
                {!linearTeams.some((t) => t.key === (payload as TicketPayload).teamKey) && <option value={(payload as TicketPayload).teamKey}>{(payload as TicketPayload).teamKey}</option>}
                {linearTeams.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name} ({t.key})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Title" htmlFor="ticket-title">
              <input id="ticket-title" className={cx(ui.input, "w-full")} value={(payload as TicketPayload).title} onChange={(e) => set({ title: e.target.value })} maxLength={250} required />
            </Field>
            <Field label="Description" htmlFor="ticket-description" hint="Markdown. Created in Linear as the person who connected it.">
              <textarea id="ticket-description" rows={8} className={cx(ui.input, "w-full resize-y leading-relaxed")} value={(payload as TicketPayload).description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </>
        )}
        {action.type === "update_crm" && (
          <>
            <Field label="Task" htmlFor="crm-subject">
              <input id="crm-subject" className={cx(ui.input, "w-full")} value={(payload as CrmTaskPayload).subject} onChange={(e) => set({ subject: e.target.value })} maxLength={250} required />
            </Field>
            <Field label="Notes" htmlFor="crm-body">
              <textarea id="crm-body" rows={4} className={cx(ui.input, "w-full resize-y")} value={(payload as CrmTaskPayload).body} onChange={(e) => set({ body: e.target.value })} />
            </Field>
            <Field label="Due" htmlFor="crm-due" hint="Added to the company in HubSpot, assigned to the account owner when they have a HubSpot user.">
              <input id="crm-due" type="date" className={ui.input} min={today()} value={(payload as CrmTaskPayload).dueDate} onChange={(e) => set({ dueDate: e.target.value })} required />
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

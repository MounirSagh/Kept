import { ExternalLink, ListChecks } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { toCommitmentRows, type AccountDto, type CommitmentDto } from "@kept/shared";
import { useApi } from "../../api";
import { memberName, useOrg } from "../../app/org-context";
import { ImportDialog } from "../../components/ImportDialog";
import { ConfirmDialog, Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { EmptyAction, EmptyState, Loading, Page } from "../../components/Page";
import { cx, ui } from "../../ui";
import { RiskBadge } from "./Flags";

const FILTERS = [
  { id: "open", label: "Open" },
  { id: "fulfilled", label: "Fulfilled" },
  { id: "broken", label: "Broken" },
  { id: "all", label: "All" },
] as const;

const COMMITMENTS_TEMPLATE = `Account,Commitment,Due date,Owner email,Made by,Status
Northwind Traders,Deliver SSO integration,2026-11-01,sara@yourcompany.com,Sara,open
initech.io,Send the QBR deck,2026-10-20,,Omar,fulfilled
`;

/** Today as YYYY-MM-DD in the viewer's timezone, comparable with due dates. */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDue(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** Overdue in red, due within a week in amber; only for open commitments. */
export function DueDate({ commitment: c }: { commitment: CommitmentDto }) {
  if (!c.dueDate) return <span className="text-ink-faint">No date</span>;
  const now = today();
  const open = c.status === "open";
  if (open && c.dueDate < now) return <span className="font-medium text-danger">Overdue · {formatDue(c.dueDate)}</span>;
  if (open && c.dueDate <= addDays(now, 7)) return <span className="font-medium text-warn">{formatDue(c.dueDate)}</span>;
  return <span className="tabular-nums">{formatDue(c.dueDate)}</span>;
}

const STATUS_STYLE: Record<CommitmentDto["status"], string> = {
  open: "",
  fulfilled: "border-brand/30 bg-brand-soft text-brand",
  broken: "border-danger/30 bg-danger-soft text-danger",
  unknown: "",
  superseded: "",
};

const ORIGIN_LABEL: Record<CommitmentDto["origin"], string> = {
  extracted: "Found by Kept",
  manual: "Added by hand",
  import: "Imported",
};

type Dialog = { kind: "create" } | { kind: "import" } | { kind: "edit"; commitment: CommitmentDto } | { kind: "delete"; commitment: CommitmentDto };

export function CommitmentsPage() {
  const api = useApi();
  const { orgId, members } = useOrg();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((f) => f.id === params.get("status"))?.id ?? "open") as (typeof FILTERS)[number]["id"];
  const [commitments, setCommitments] = useState<CommitmentDto[] | null>(null);
  const [accounts, setAccounts] = useState<AccountDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const load = useCallback(
    () =>
      Promise.all([api.commitments(orgId, filter === "all" ? {} : { status: filter }), api.accounts(orgId)]).then(
        ([c, a]) => {
          setCommitments(c);
          setAccounts(a);
        },
        (err: Error) => setError(err.message),
      ),
    [api, orgId, filter],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function markFulfilled(c: CommitmentDto) {
    setError(null);
    try {
      await api.updateCommitment(orgId, c.id, { status: "fulfilled" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const hasAccounts = (accounts?.length ?? 0) > 0;
  const actions = hasAccounts && (
    <>
      <button className={ui.button.ghost} onClick={() => setDialog({ kind: "import" })}>
        Import CSV
      </button>
      <button className={ui.button.primary} onClick={() => setDialog({ kind: "create" })}>
        Add commitment
      </button>
    </>
  );

  return (
    <Page
      title="Commitments"
      description="Promises your team made to customers: what, to whom, by whom and by when."
      actions={actions}
    >
      <div className="mb-5 flex gap-1" role="tablist" aria-label="Status">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setParams(f.id === "open" ? {} : { status: f.id }, { replace: true })}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              filter === f.id ? "bg-selected text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className={ui.errorBlock}>{error}</p>}
      {!commitments && !error && <Loading />}

      {commitments && accounts && !hasAccounts && (
        <EmptyState icon={ListChecks} title="Add your clients first" action={<EmptyAction to="../companies">Go to Companies</EmptyAction>}>
          Every commitment belongs to a client account. Create or import accounts, then add commitments here.
        </EmptyState>
      )}
      {commitments && hasAccounts && commitments.length === 0 && (
        <EmptyState icon={ListChecks} title={filter === "open" ? "No open commitments" : `No ${filter === "all" ? "" : `${filter} `}commitments`}>
          Add commitments by hand, import a spreadsheet, or connect your email and chat so Kept finds them. Each one cites
          where it came from.
        </EmptyState>
      )}

      {commitments && commitments.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Commitment</th>
                <th className={ui.th}>Owner</th>
                <th className={ui.th}>Due</th>
                <th className={ui.th}>Status</th>
                <th className={ui.th} aria-label="Actions" />
              </tr>
            </thead>
            <tbody className={ui.tbody}>
              {commitments.map((c) => (
                <tr key={c.id}>
                  <td className={`${ui.td} max-w-[28rem]`}>
                    <div className="font-medium">{c.summary}</div>
                    <div className={`${ui.hint} flex flex-wrap items-center gap-x-1.5`}>
                      <span>{c.accountName ?? "No account"}</span>
                      {c.madeBy && <span>· promised by {c.madeBy}</span>}
                      <span className="text-ink-faint">· {ORIGIN_LABEL[c.origin]}</span>
                      {c.sourceUrl && (
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                          source <ExternalLink className="size-3" aria-hidden />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className={cx(ui.td, "whitespace-nowrap")}>{c.ownerUserId ? memberName(members, c.ownerUserId) : <span className="text-ink-faint">Unassigned</span>}</td>
                  <td className={`${ui.td} whitespace-nowrap`}>
                    <DueDate commitment={c} />
                  </td>
                  <td className={ui.td}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cx(ui.badge, STATUS_STYLE[c.status])}>{c.status}</span>
                      {c.risk && c.status === "open" && <RiskBadge risk={c.risk} to="../flags" />}
                    </div>
                  </td>
                  <td className={ui.tdActions}>
                    {c.status === "open" && (
                      <button className={ui.button.ghostSm} onClick={() => void markFulfilled(c)}>
                        Mark fulfilled
                      </button>
                    )}
                    <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "edit", commitment: c })}>
                      Edit
                    </button>
                    <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "delete", commitment: c })}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(dialog?.kind === "create" || dialog?.kind === "edit") && accounts && (
        <CommitmentDialog
          commitment={dialog.kind === "edit" ? dialog.commitment : undefined}
          accounts={accounts}
          onClose={() => setDialog(null)}
          onSaved={load}
        />
      )}
      {dialog?.kind === "import" && (
        <ImportDialog
          title="Import commitments"
          description="One row per commitment. Account can be the account's name or email domain. Account and Commitment are required; status can be open, fulfilled or broken."
          template={COMMITMENTS_TEMPLATE}
          templateName="kept-commitments.csv"
          convert={toCommitmentRows}
          columns={[
            { label: "Account", render: (r) => r.account },
            { label: "Commitment", render: (r) => r.summary },
            { label: "Due", render: (r) => r.dueDate },
            { label: "Owner", render: (r) => r.ownerEmail },
            { label: "Status", render: (r) => r.status },
          ]}
          onImport={(rows) => api.importCommitments(orgId, rows)}
          onClose={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="Delete this commitment?"
          confirmLabel="Delete"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.deleteCommitment(orgId, dialog.commitment.id);
            await load();
          }}
        >
          "{dialog.commitment.summary}" will no longer be tracked. To record that it slipped, mark it broken instead.
        </ConfirmDialog>
      )}
    </Page>
  );
}

function CommitmentDialog({
  commitment,
  accounts,
  onClose,
  onSaved,
}: {
  commitment?: CommitmentDto;
  accounts: AccountDto[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useApi();
  const { orgId, members, actor } = useOrg();
  const [accountId, setAccountId] = useState(commitment?.accountId ?? (accounts.length === 1 ? accounts[0]!.id : ""));
  const [summary, setSummary] = useState(commitment?.summary ?? "");
  const [dueDate, setDueDate] = useState(commitment?.dueDate ?? "");
  const [ownerUserId, setOwnerUserId] = useState(commitment ? (commitment.ownerUserId ?? "") : actor.userId);
  const [madeBy, setMadeBy] = useState(commitment?.madeBy ?? "");
  const [status, setStatus] = useState<"open" | "fulfilled" | "broken">(
    commitment && (commitment.status === "fulfilled" || commitment.status === "broken") ? commitment.status : "open",
  );
  const [notes, setNotes] = useState(commitment?.notes ?? "");
  const { pending, error, submit } = useSubmit();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      const input = {
        accountId,
        summary,
        dueDate: dueDate || null,
        ownerUserId: ownerUserId || null,
        madeBy: madeBy || null,
        status,
        notes: notes || null,
      };
      if (commitment) await api.updateCommitment(orgId, commitment.id, input);
      else await api.createCommitment(orgId, input);
      await onSaved();
      onClose();
    });
  }

  return (
    <Modal title={commitment ? "Edit commitment" : "Add commitment"} onClose={onClose}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <Field label="Account" htmlFor="c-account">
          <select id="c-account" className={`${ui.select} w-full`} value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            <option value="" disabled>Choose a client…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="What was promised" htmlFor="c-summary">
          <textarea
            id="c-summary"
            className={`${ui.input} min-h-20 w-full`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Deliver SSO integration"
            maxLength={2000}
            autoFocus
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date" htmlFor="c-due">
            <input id="c-due" type="date" className={`${ui.input} w-full`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Owner" htmlFor="c-owner">
            <select id="c-owner" className={`${ui.select} w-full`} value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.fullName ?? m.email}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Promised by" htmlFor="c-madeby">
            <input id="c-madeby" className={`${ui.input} w-full`} value={madeBy} onChange={(e) => setMadeBy(e.target.value)} placeholder="Who said it" maxLength={200} />
          </Field>
          <Field label="Status" htmlFor="c-status">
            <select id="c-status" className={`${ui.select} w-full`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="open">Open</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="broken">Broken</option>
            </select>
          </Field>
        </div>
        <Field label="Notes" htmlFor="c-notes">
          <textarea id="c-notes" className={`${ui.input} min-h-16 w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10000} />
        </Field>
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending || !accountId}>
            {pending ? "Saving…" : commitment ? "Save changes" : "Add commitment"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

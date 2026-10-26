import { ExternalLink, Flag } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import type { CommitmentDto, FlagDto, FlagKindValue, SeverityValue } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { EmptyState, Loading, Page } from "../../components/Page";
import { cx, ui } from "../../ui";

const TABS = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
] as const;

export const SEVERITY: Record<SeverityValue, { label: string; className: string }> = {
  critical: { label: "Critical", className: "border-danger/30 bg-danger-soft text-danger" },
  high: { label: "High", className: "border-danger/30 bg-danger-soft text-danger" },
  medium: { label: "Medium", className: "border-warn/30 bg-warn-soft text-warn" },
  low: { label: "Low", className: "" },
};

/** On a commitment Kept has flagged: "At risk", colored by severity, linking to the flag's evidence. */
export function RiskBadge({ risk, to }: { risk: NonNullable<CommitmentDto["risk"]>; to: string }) {
  return (
    <Link to={`${to}#flag-${risk.flagId}`} title={risk.title} className={cx(ui.badge, "normal-case hover:underline", SEVERITY[risk.severity].className || "border-warn/30 bg-warn-soft text-warn")}>
      At risk
    </Link>
  );
}

function formatMoney(cents: string | null, currency: string | null) {
  if (cents === null) return null;
  try {
    return (Number(cents) / 100).toLocaleString(undefined, { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 });
  } catch {
    return null;
  }
}

/** "renews in 28 days · CA$48,000/yr": what's at stake on the account. */
function stakes(f: FlagDto): string | null {
  const parts: string[] = [];
  if (f.accountRenewalDate) {
    const days = Math.round((Date.parse(`${f.accountRenewalDate}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);
    parts.push(days < 0 ? `renewal passed ${-days} days ago` : days === 0 ? "renews today" : `renews in ${days} day${days === 1 ? "" : "s"}`);
  }
  const value = formatMoney(f.accountValueCents, f.accountCurrency);
  if (value) parts.push(`${value}/yr`);
  return parts.length ? parts.join(" · ") : null;
}

const KIND: Record<FlagKindValue, string> = {
  unkept_promise: "Unkept promise",
  mismatch: "Mismatch",
  deadline_risk: "Deadline at risk",
  churn_signal: "Churn signal",
};

const PROVIDER: Record<string, string> = {
  zetaris: "Zetaris",
  google: "Gmail",
  microsoft: "Outlook",
  slack: "Slack",
  linear: "Linear",
  notion: "Notion",
  hubspot: "HubSpot",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Decision = { flag: FlagDto; status: "resolved" | "dismissed" };

export function FlagsPage() {
  const api = useApi();
  const { orgId } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = params.get("status") === "closed" ? "closed" : "open";
  const [flags, setFlags] = useState<FlagDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  const load = useCallback(
    () => api.flags(orgId, tab).then(setFlags, (err: Error) => setError(err.message)),
    [api, orgId, tab],
  );
  useEffect(() => {
    setFlags(null);
    void load();
  }, [load]);

  return (
    <Page title="Flags" description="Promises that may slip, contradictions, and early churn signals, with the evidence behind each.">
      <div className="mb-5 flex gap-1" role="tablist" aria-label="Status">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === "open" ? {} : { status: t.id }, { replace: true })}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              tab === t.id ? "bg-selected text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className={ui.errorBlock}>{error}</p>}
      {!flags && !error && <Loading />}

      {flags?.length === 0 &&
        (tab === "open" ? (
          <EmptyState icon={Flag} title="Nothing flagged">
            When a promise comes due with no sign of delivery, or later messages contradict it, Kept flags it here with
            the evidence. Flags appear as connected tools sync new activity.
          </EmptyState>
        ) : (
          <EmptyState icon={Flag} title="No closed flags yet">
            Flags you resolve or dismiss move here, with your note.
          </EmptyState>
        ))}

      {flags && flags.length > 0 && (
        <div className="space-y-8">
          {[
            { title: "Promises at risk", items: flags.filter((f) => f.commitment) },
            { title: "Other signals", items: flags.filter((f) => !f.commitment) },
          ]
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section key={group.title}>
                <h2 className="mb-3 text-sm font-semibold">
                  {group.title} <span className="font-normal text-ink-muted">{group.items.length}</span>
                </h2>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {group.items.map((f) => (
                    <FlagRow key={f.id} flag={f} onDecide={(status) => setDecision({ flag: f, status })} />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      {decision && (
        <DecisionDialog
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={async () => {
            setDecision(null);
            await load();
          }}
        />
      )}
    </Page>
  );
}

function FlagRow({ flag: f, onDecide }: { flag: FlagDto; onDecide: (status: "resolved" | "dismissed") => void }) {
  const { hash } = useLocation();
  const linked = hash === `#flag-${f.id}`;
  // Arriving from a commitment's "At risk" badge: show this flag with its evidence.
  const [showEvidence, setShowEvidence] = useState(linked);
  const open = f.status === "open" || f.status === "confirmed";
  const atStake = stakes(f);

  return (
    <li
      id={`flag-${f.id}`}
      ref={(el) => {
        if (el && linked) el.scrollIntoView({ block: "center" });
      }}
      className={cx("scroll-mt-6 px-5 py-4", linked && "bg-brand-soft/60")}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span className={cx(ui.badge, SEVERITY[f.severity].className)}>{SEVERITY[f.severity].label}</span>
            <span>{KIND[f.kind]}</span>
            <span aria-hidden>·</span>
            <Link to={`../companies/${f.accountId}`} className="font-medium text-ink hover:underline">
              {f.accountName}
            </Link>
            {atStake && (
              <>
                <span aria-hidden>·</span>
                <span>{atStake}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatDate(f.createdAt)}</span>
          </div>
          <p className="mt-2 font-medium">{f.title}</p>
          {f.commitment && (
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              Promise: <span className="text-ink">{f.commitment.summary}</span>
              {f.commitment.dueDate && <> · due {new Date(`${f.commitment.dueDate}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric" })}</>}
            </p>
          )}
          <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-ink-muted">{f.explanation}</p>

          {!open && (
            <p className="mt-2 text-[0.8125rem] text-ink-muted">
              <span className="font-medium text-ink capitalize">{f.status}</span>
              {f.resolvedBy && <> by {f.resolvedBy}</>}
              {f.resolvedAt && <> on {formatDate(f.resolvedAt)}</>}
              {f.resolutionNote && <>: “{f.resolutionNote}”</>}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.8125rem]">
            {f.evidence.length > 0 && (
              <button
                type="button"
                className="font-medium text-ink-muted hover:text-ink"
                aria-expanded={showEvidence}
                onClick={() => setShowEvidence((v) => !v)}
              >
                {showEvidence ? "Hide evidence" : `Evidence (${f.evidence.length})`}
              </button>
            )}
            {open && f.pendingActions > 0 && (
              <Link to="../approvals" className="font-medium text-brand hover:text-brand-hover">
                {f.pendingActions} suggested {f.pendingActions === 1 ? "action" : "actions"} to review
              </Link>
            )}
          </div>

          {showEvidence && (
            <ul className="mt-3 space-y-2.5">
              {f.evidence.map((e, i) => (
                <li key={i} className="rounded-md bg-sidebar px-3.5 py-2.5 text-sm">
                  {e.excerpt && <p className="leading-relaxed">“{e.excerpt}”</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                    <span className={e.stance === "contradicts" ? "font-medium text-danger" : undefined}>
                      {e.stance === "supports" ? "Supports" : e.stance === "contradicts" ? "Contradicts" : "Context"}
                    </span>
                    {e.source && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{PROVIDER[e.source.provider] ?? e.source.provider}</span>
                        <span aria-hidden>·</span>
                        <span>{formatDate(e.source.occurredAt)}</span>
                        {e.source.title && (
                          <>
                            <span aria-hidden>·</span>
                            {e.source.url ? (
                              <a href={e.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
                                {e.source.title}
                                <ExternalLink className="size-3" aria-hidden />
                              </a>
                            ) : (
                              <span>{e.source.title}</span>
                            )}
                          </>
                        )}
                      </>
                    )}
                    {!e.source && e.commitment && (
                      <>
                        <span aria-hidden>·</span>
                        <span>Commitment: {e.commitment.summary}</span>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {open && (
          <div className="flex shrink-0 gap-2">
            <button className={ui.button.ghostSm} onClick={() => onDecide("dismissed")}>
              Dismiss
            </button>
            <button className={ui.button.primarySm} onClick={() => onDecide("resolved")}>
              Resolve
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function DecisionDialog({ decision, onClose, onDone }: { decision: Decision; onClose: () => void; onDone: () => Promise<void> }) {
  const api = useApi();
  const { orgId } = useOrg();
  const { pending, error, submit } = useSubmit();
  const [note, setNote] = useState("");
  const dismissing = decision.status === "dismissed";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      await api.decideFlag(orgId, decision.flag.id, { status: decision.status, note: note.trim() || undefined });
      await onDone();
    });
  }

  return (
    <Modal
      title={dismissing ? "Dismiss flag" : "Resolve flag"}
      description={
        <>
          <span className="font-medium text-ink">{decision.flag.title}</span>
          <br />
          {dismissing
            ? "Kept won't raise this again unless something new happens, and its suggested actions are withdrawn."
            : "Mark it handled. Its remaining suggested actions are withdrawn."}
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <Field
          label={dismissing ? "Why isn't this an issue?" : "What was done? (optional)"}
          htmlFor="flag-note"
          hint="Kept learns from this for future flags on this account."
        >
          <textarea
            id="flag-note"
            rows={3}
            className={cx(ui.input, "w-full resize-y")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            autoFocus
          />
        </Field>
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending}>
            {pending ? "Saving…" : dismissing ? "Dismiss" : "Resolve"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

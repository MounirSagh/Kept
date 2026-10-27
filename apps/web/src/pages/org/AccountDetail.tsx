import { ExternalLink, FileText, ListChecks } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { can, type AccountDto, type CommitmentDto, type ContactDto, type DocumentDto } from "@kept/shared";
import { useApi } from "../../api";
import { memberName, useOrg } from "../../app/org-context";
import { EmptyState, Loading, Page } from "../../components/Page";
import { cx, ui } from "../../ui";
import { AccountDialog, SOURCE_NAMES } from "./AccountDialog";
import { formatDate } from "./Accounts";
import { DueDate } from "./Commitments";
import { RiskBadge } from "./Flags";
import { ContactDialog } from "./ContactDialog";

/** What happened when Kept tried to read a file, in words; "read" needs no label. */
const DOCUMENT_STATUS: Record<string, { label: string; tone?: "warn" }> = {
  pending: { label: "Waiting to be read" },
  ocr: { label: "Read from a scan" },
  unsupported: { label: "Format Kept can't read" },
  too_large: { label: "Too large to read", tone: "warn" },
  no_access: { label: "No access: reconnect the tool with file access", tone: "warn" },
  needs_ocr: { label: "Scanned, too long to read", tone: "warn" },
  empty: { label: "No text" },
  failed: { label: "Couldn't be read", tone: "warn" },
};

/** Contacts listed on the company page; the rest are a click away on Contacts. */
const CONTACTS_SHOWN = 5;

function money(cents: string | null, currency: string | null) {
  if (cents === null) return null;
  const amount = Number(cents) / 100;
  try {
    return amount.toLocaleString(undefined, { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 });
  } catch {
    return amount.toLocaleString();
  }
}

/** The client's local time, so you know whether it's a good moment to call. */
function localTime(timezone: string) {
  try {
    return new Date().toLocaleTimeString(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? <span className="text-ink-faint">—</span>}</dd>
    </div>
  );
}

function SideSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

type Dialog = { kind: "edit" } | { kind: "contact" };

export function AccountDetailPage() {
  const api = useApi();
  const { orgId, members, actor } = useOrg();
  const { accountId } = useParams();
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [contacts, setContacts] = useState<ContactDto[] | null>(null);
  const [commitments, setCommitments] = useState<CommitmentDto[] | null>(null);
  const [theirs, setTheirs] = useState<CommitmentDto[]>([]);
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [review, setReview] = useState<"idle" | "starting" | "started" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const manage = can(actor, { action: "account.manage" });

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const [a, c, k, t, d] = await Promise.all([
        api.account(orgId, accountId),
        api.contacts(orgId, accountId),
        api.commitments(orgId, { accountId, status: "open" }),
        api.commitments(orgId, { accountId, status: "open", type: "obligation" }),
        api.accountDocuments(orgId, accountId),
      ]);
      setAccount(a);
      setContacts(c);
      setCommitments(k);
      setTheirs(t);
      setDocuments(d);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, orgId, accountId]);
  useEffect(() => {
    void load();
  }, [load]);

  const back = { to: "..", label: "Companies" };

  if (error) return <Page title="Company" back={back}><p className={ui.errorBlock}>{error}</p></Page>;
  if (!account || !contacts || !commitments) return <Page title="Company" back={back}><Loading /></Page>;

  const crm = account.source ? (SOURCE_NAMES[account.source] ?? account.source) : null;
  const place = [account.city, account.region, account.country].filter(Boolean).join(", ");
  const subtitle = [account.domain, account.industry, place].filter(Boolean).join(" · ");
  const contactsLink = `../../contacts?accountId=${account.id}`;

  return (
    <Page
      title={
        <span className="flex flex-wrap items-center gap-2">
          {account.name}
          {crm && <span className={cx(ui.badge, "normal-case")}>{crm}</span>}
        </span>
      }
      description={subtitle || undefined}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {review === "started" && <span className={ui.hint} role="status">Reviewing: flags and suggestions appear in a minute or two.</span>}
          {review === "failed" && <span className="text-[0.8125rem] text-danger" role="status">The review couldn't start. Try again.</span>}
          <button
            className={ui.button.ghost}
            disabled={review === "starting" || review === "started"}
            onClick={() => {
              setReview("starting");
              api.reviewAccount(orgId, accountId!).then(() => setReview("started"), () => setReview("failed"));
            }}
          >
            {review === "starting" ? "Starting…" : "Review now"}
          </button>
          {manage && <button className={ui.button.ghost} onClick={() => setDialog({ kind: "edit" })}>Edit company</button>}
        </div>
      }
      back={back}
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {account.description && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">About</h2>
              <p className="max-w-[65ch] text-sm leading-relaxed whitespace-pre-line text-ink-muted">{account.description}</p>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-semibold">
                Open commitments <span className="font-normal text-ink-muted">{commitments.length}</span>
              </h2>
              {/* The org-wide lists, narrowed to this company. */}
              <span className="flex gap-3 text-[0.8125rem]">
                <Link to={`../../flags?company=${account.id}`} relative="path" className="text-ink-muted hover:text-ink">
                  Flags
                </Link>
                <Link to={`../../approvals?company=${account.id}`} relative="path" className="text-ink-muted hover:text-ink">
                  Approvals
                </Link>
                <Link to={`../../commitments?company=${account.id}`} relative="path" className="text-ink-muted hover:text-ink">
                  All commitments
                </Link>
              </span>
            </div>
            {commitments.length === 0 ? (
              <EmptyState icon={ListChecks} title="Nothing open">
                Promises made to {account.name} in email, chat, tickets and notes appear here once Kept finds them, along
                with any you add by hand.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {commitments.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{c.summary}</p>
                      <p className={ui.hint}>
                        {c.ownerUserId ? memberName(members, c.ownerUserId) : "No owner"}
                        {c.madeBy && <> · promised by {c.madeBy}</>}
                      </p>
                    </div>
                    <span className="flex items-center gap-2 text-[0.8125rem] whitespace-nowrap">
                      {c.risk && <RiskBadge risk={c.risk} to={`../flags?company=${account.id}`} />}
                      <DueDate commitment={c} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold">
              Documents <span className="font-normal text-ink-muted">{documents.length}</span>
            </h2>
            {documents.length === 0 ? (
              <EmptyState icon={FileText} title="No documents yet">
                Contracts, order forms and plans appear here when they're attached to emails with {account.name}, shared in
                its Slack channels, shared with its people in Drive or OneDrive, or linked from its conversations. Kept reads
                them for commitments and contract terms.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {documents.map((d) => {
                  const status = DOCUMENT_STATUS[d.status];
                  return (
                    <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-brand">
                            {d.title ?? "Untitled file"} <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : (
                          <span className="font-medium">{d.title ?? "Untitled file"}</span>
                        )}
                        <p className={ui.hint}>
                          {d.origin}
                          {d.pages ? ` · ${d.pages} pages` : ""}
                          {d.reason ? ` · ${d.reason}` : ""}
                        </p>
                      </div>
                      <span className="flex items-center gap-2 text-[0.8125rem] whitespace-nowrap text-ink-muted">
                        {status && <span className={status.tone === "warn" ? "text-warn" : undefined}>{status.label}</span>}
                        {new Date(d.occurredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          {theirs.length > 0 && (
            <SideSection
              title={<>Their promises <span className="font-normal normal-case">{theirs.length}</span></>}
              aside={<Link to={`../commitments?side=theirs&company=${account.id}`} className="text-[0.8125rem] text-ink-muted hover:text-ink">All</Link>}
            >
              <ul className="divide-y divide-line">
                {theirs.map((c) => (
                  <li key={c.id} className="py-2 text-sm">
                    <p className="font-medium">{c.summary}</p>
                    <p className={cx(ui.hint, "flex flex-wrap gap-x-1.5")}>
                      {c.madeBy && <span>{c.madeBy}</span>}
                      {c.dueDate && (
                        <span>
                          · <DueDate commitment={c} />
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </SideSection>
          )}
          <SideSection
            title={<>Contacts <span className="font-normal normal-case">{contacts.length}</span></>}
            aside={manage && <button className="text-[0.8125rem] font-medium text-brand hover:text-brand-hover" onClick={() => setDialog({ kind: "contact" })}>Add</button>}
          >
            {contacts.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">
                No contacts yet.{crm && ` Contacts from ${crm} appear after its next sync.`}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {contacts.slice(0, CONTACTS_SHOWN).map((c) => (
                  <li key={c.id} className="py-2 text-sm">
                    <p className="font-medium">{c.fullName ?? c.email}</p>
                    <p className={cx(ui.hint, "truncate")}>{[c.title, c.fullName ? c.email : null].filter(Boolean).join(" · ") || "—"}</p>
                  </li>
                ))}
              </ul>
            )}
            {contacts.length > 0 && (
              <Link to={contactsLink} relative="path" className="mt-1 inline-block text-[0.8125rem] font-medium text-brand hover:text-brand-hover">
                {contacts.length > CONTACTS_SHOWN ? `View all ${contacts.length} contacts` : "Open in Contacts"}
              </Link>
            )}
          </SideSection>

          <SideSection title="Relationship">
            <dl className="divide-y divide-line">
              <Detail label="Owner">{account.ownerUserId ? memberName(members, account.ownerUserId) : null}</Detail>
              <Detail label="Renewal">{account.renewalDate ? formatDate(account.renewalDate) : null}</Detail>
              <Detail label="Contract value">
                {money(account.annualValueCents, account.currency) && <>{money(account.annualValueCents, account.currency)} <span className="text-ink-muted">/ year</span></>}
              </Detail>
            </dl>
          </SideSection>

          <SideSection title="Company">
            <dl className="divide-y divide-line">
              <Detail label="Type">{account.companyType}</Detail>
              <Detail label="Industry">{account.industry}</Detail>
              <Detail label="Employees">{account.employeeCount?.toLocaleString()}</Detail>
              <Detail label="Annual revenue">{money(account.annualRevenueCents, account.currency)}</Detail>
              <Detail label="LinkedIn">
                {account.linkedinUrl && (
                  <a href={account.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand">
                    Company page <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </Detail>
            </dl>
          </SideSection>

          <SideSection title="Location">
            <dl className="divide-y divide-line">
              <Detail label="Address">
                {[account.city, account.region, account.postalCode].filter(Boolean).join(", ") || account.country ? (
                  <>
                    {[account.city, account.region, account.postalCode].filter(Boolean).join(", ")}
                    {account.country && <div>{account.country}</div>}
                  </>
                ) : null}
              </Detail>
              <Detail label="Time zone">
                {account.timezone && (
                  <>
                    {account.timezone.replace(/_/g, " ")}
                    {localTime(account.timezone) && <div className="text-ink-muted">{localTime(account.timezone)} there now</div>}
                  </>
                )}
              </Detail>
            </dl>
          </SideSection>
        </aside>
      </div>

      {dialog?.kind === "edit" && <AccountDialog account={account} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog?.kind === "contact" && <ContactDialog accountId={account.id} onClose={() => setDialog(null)} onSaved={load} />}
    </Page>
  );
}

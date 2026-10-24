import { Building2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { COMPANY_TYPES, can, toAccountRows, type AccountDto, type PageDto } from "@kept/shared";
import { useApi } from "../../api";
import { memberName, teamName, useOrg } from "../../app/org-context";
import { FilterSelect, Pagination, SearchBox, SortTh, Toolbar, toApiQuery, useTableQuery } from "../../components/DataTable";
import { ImportDialog } from "../../components/ImportDialog";
import { ConfirmDialog } from "../../components/Modal";
import { EmptyAction, EmptyState, Loading, Page } from "../../components/Page";
import { cx, ui } from "../../ui";
import { AccountDialog, SOURCE_NAMES } from "./AccountDialog";

export function formatValue(a: AccountDto) {
  if (a.annualValueCents === null) return "—";
  const amount = Number(a.annualValueCents) / 100;
  return a.currency
    ? amount.toLocaleString(undefined, { style: "currency", currency: a.currency, maximumFractionDigits: 0 })
    : amount.toLocaleString();
}

/** Renewal dates are calendar dates (stored at UTC midnight); format them in UTC so they don't shift a day. */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

function describeScope({ actor, teams }: ReturnType<typeof useOrg>) {
  if (actor.isPlatformAdmin || actor.role === "owner") return "Every client company in the organization.";
  if (actor.role === "manager" && actor.teamId) {
    return `Companies owned by people on ${teamName(teams, actor.teamId)}, plus any shared with you.`;
  }
  return "Companies you own or that were shared with you.";
}

type Dialog = { kind: "create" } | { kind: "import" } | { kind: "edit"; account: AccountDto } | { kind: "delete"; account: AccountDto };

const ACCOUNTS_TEMPLATE = `Name,Domain,Owner email,Renewal date,Annual value,Currency
Northwind Traders,northwind.com,sara@yourcompany.com,2026-12-01,48000,USD
Initech,initech.io,,2027-02-15,12500,USD
`;

const FILTERS = ["owner", "source", "renewal", "type"];
const NO_FILTERS = Object.fromEntries(FILTERS.map((f) => [f, ""]));

export function AccountsPage() {
  const api = useApi();
  const ctx = useOrg();
  const { query, update, toggleSort, filtered } = useTableQuery({ sort: "name", dir: "asc", filters: FILTERS });
  const [data, setData] = useState<PageDto<AccountDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const manage = can(ctx.actor, { action: "account.manage" });

  const apiQuery = JSON.stringify(toApiQuery(query));
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.companiesPage(ctx.orgId, JSON.parse(apiQuery)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, ctx.orgId, apiQuery]);
  useEffect(() => {
    void load();
  }, [load]);

  const actions = manage && (
    <>
      <button className={ui.button.ghost} onClick={() => setDialog({ kind: "import" })}>
        Import CSV
      </button>
      <button className={ui.button.primary} onClick={() => setDialog({ kind: "create" })}>
        New company
      </button>
    </>
  );
  // No companies at all (not just none matching the filters): teach what goes here instead of an empty table.
  const empty = data?.total === 0 && !filtered;
  const clear = () => update({ q: "", filters: NO_FILTERS });

  return (
    <Page title="Companies" description={describeScope(ctx)} actions={!empty && actions}>
      {error && <p className={ui.errorBlock}>{error}</p>}
      {!data && !error && <Loading />}

      {empty && (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          action={actions ? <div className="flex gap-2">{actions}</div> : <EmptyAction to="../integrations">See integrations</EmptyAction>}
        >
          Companies are your clients. Connecting HubSpot imports them automatically; you can also add them by hand. Give
          each one its email domain so Kept can route emails and meetings to it.
        </EmptyState>
      )}

      {data && !empty && (
        <>
          <Toolbar onClear={filtered ? clear : undefined}>
            <SearchBox value={query.q} onChange={(q) => update({ q })} placeholder="Search name, domain, industry, city" />
            <FilterSelect
              label="Owner"
              value={query.filters.owner ?? ""}
              onChange={(owner) => update({ filters: { owner } })}
              options={[...ctx.members.map((m) => ({ value: m.userId, label: m.fullName ?? m.email })), { value: "none", label: "No owner" }]}
            />
            <FilterSelect
              label="Source"
              value={query.filters.source ?? ""}
              onChange={(source) => update({ filters: { source } })}
              options={[{ value: "crm", label: "HubSpot" }, { value: "kept", label: "Added in Kept" }]}
            />
            <FilterSelect
              label="Renewal"
              value={query.filters.renewal ?? ""}
              onChange={(renewal) => update({ filters: { renewal } })}
              options={[{ value: "30d", label: "next 30 days" }, { value: "90d", label: "next 90 days" }, { value: "passed", label: "passed" }]}
            />
            <FilterSelect
              label="Type"
              value={query.filters.type ?? ""}
              onChange={(type) => update({ filters: { type } })}
              options={COMPANY_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Toolbar>

          <div className={cx(ui.tableWrap, loading && "opacity-60 transition-opacity")} aria-busy={loading}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <SortTh label="Company" sortKey="name" query={query} onSort={toggleSort} />
                  <th className={ui.th}>Industry</th>
                  <th className={ui.th}>Owner</th>
                  <SortTh label="Contacts" sortKey="contactCount" query={query} onSort={toggleSort} align="right" />
                  <SortTh label="Contract value" sortKey="annualValue" query={query} onSort={toggleSort} align="right" />
                  <SortTh label="Renewal" sortKey="renewalDate" query={query} onSort={toggleSort} />
                  {manage && <th className={ui.th} aria-label="Actions" />}
                </tr>
              </thead>
              <tbody className={ui.tbody}>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={manage ? 7 : 6} className="px-4 py-10 text-center text-sm text-ink-muted">
                      No companies match.{" "}
                      <button className="font-medium text-brand hover:text-brand-hover" onClick={clear}>
                        Clear filters
                      </button>
                    </td>
                  </tr>
                )}
                {data.items.map((a) => (
                  <tr key={a.id} className="hover:bg-hover/50">
                    <td className={cx(ui.td, "min-w-56")}>
                      <div className="flex items-center gap-2 font-medium">
                        <Link to={a.id} className="hover:text-brand hover:underline">
                          {a.name}
                        </Link>
                        {a.source && <span className={ui.badge}>{SOURCE_NAMES[a.source] ?? a.source}</span>}
                      </div>
                      <div className={ui.hint}>{a.domain ?? <span className="text-warn">No domain</span>}</div>
                    </td>
                    <td className={cx(ui.td, "text-ink-muted")}>{a.industry ?? "—"}</td>
                    <td className={cx(ui.td, "whitespace-nowrap")}>{a.ownerUserId ? memberName(ctx.members, a.ownerUserId) : <span className="text-ink-faint">—</span>}</td>
                    <td className={cx(ui.td, "text-right tabular-nums")}>
                      <Link to={`../contacts?accountId=${a.id}`} className="hover:text-brand hover:underline">
                        {a.contactCount}
                      </Link>
                    </td>
                    <td className={cx(ui.td, "whitespace-nowrap text-right tabular-nums")}>{formatValue(a)}</td>
                    <td className={cx(ui.td, "whitespace-nowrap tabular-nums")}>{a.renewalDate ? formatDate(a.renewalDate) : "—"}</td>
                    {manage && (
                      <td className={ui.tdActions}>
                        <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "edit", account: a })}>
                          Edit
                        </button>
                        <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "delete", account: a })}>
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={query.page}
            pageSize={query.pageSize}
            total={data.total}
            onPage={(page) => update({ page })}
            onPageSize={(pageSize) => update({ pageSize })}
          />
        </>
      )}

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <AccountDialog account={dialog.kind === "edit" ? dialog.account : undefined} onClose={() => setDialog(null)} onSaved={load} />
      )}
      {dialog?.kind === "import" && (
        <ImportDialog
          title="Import companies"
          description="One row per client. Rows update a company with the same domain (or the same name) instead of duplicating it. Only Name is required."
          template={ACCOUNTS_TEMPLATE}
          templateName="kept-companies.csv"
          convert={toAccountRows}
          columns={[
            { label: "Name", render: (r) => r.name },
            { label: "Domain", render: (r) => r.domain },
            { label: "Owner", render: (r) => r.ownerEmail },
            { label: "Renewal", render: (r) => r.renewalDate },
            { label: "Value", render: (r) => (r.annualValue === null ? null : `${r.annualValue.toLocaleString()} ${r.currency ?? ""}`) },
          ]}
          onImport={(rows) => api.importAccounts(ctx.orgId, rows)}
          onClose={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.account.name}?`}
          confirmLabel="Delete company"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.deleteAccount(ctx.orgId, dialog.account.id);
            await load();
          }}
        >
          Items routed to it become unmatched, and any channel or team mapped to it is unmapped.
          {dialog.account.source && " It comes back on the next HubSpot sync if the company still exists there."}
        </ConfirmDialog>
      )}
    </Page>
  );
}

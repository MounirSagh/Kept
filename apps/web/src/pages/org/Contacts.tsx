import { UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { can, type AccountDto, type ContactRowDto, type PageDto } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { FilterSelect, Pagination, SearchBox, SortTh, Toolbar, toApiQuery, useTableQuery } from "../../components/DataTable";
import { ConfirmDialog } from "../../components/Modal";
import { EmptyAction, EmptyState, Loading, Page } from "../../components/Page";
import { cx, ui } from "../../ui";
import { SOURCE_NAMES } from "./AccountDialog";
import { ContactDialog } from "./ContactDialog";

const FILTERS = ["accountId", "source"];
const NO_FILTERS = Object.fromEntries(FILTERS.map((f) => [f, ""]));

type Dialog = { kind: "create" } | { kind: "edit"; contact: ContactRowDto } | { kind: "remove"; contact: ContactRowDto };

/** The people at every client, across companies. */
export function ContactsPage() {
  const api = useApi();
  const { orgId, actor } = useOrg();
  const { query, update, toggleSort, filtered } = useTableQuery({ sort: "name", dir: "asc", filters: FILTERS });
  const [data, setData] = useState<PageDto<ContactRowDto> | null>(null);
  const [companies, setCompanies] = useState<AccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const manage = can(actor, { action: "account.manage" });

  const apiQuery = JSON.stringify(toApiQuery(query));
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.contactsPage(orgId, JSON.parse(apiQuery)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, orgId, apiQuery]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void api.accounts(orgId).then(setCompanies, () => undefined);
  }, [api, orgId]);

  const empty = data?.total === 0 && !filtered;
  const clear = () => update({ q: "", filters: NO_FILTERS });
  const add = manage && companies.length > 0 && (
    <button className={ui.button.primary} onClick={() => setDialog({ kind: "create" })}>
      Add contact
    </button>
  );

  return (
    <Page title="Contacts" description="The people you work with at your clients. Their emails are routed to their company, and Kept drafts follow-ups to them." actions={!empty && add}>
      {error && <p className={ui.errorBlock}>{error}</p>}
      {!data && !error && <Loading />}

      {empty && (
        <EmptyState
          icon={UsersRound}
          title="No contacts yet"
          action={add || <EmptyAction to="../companies">Go to Companies</EmptyAction>}
        >
          {companies.length === 0
            ? "Add your client companies first; contacts belong to a company. Connecting HubSpot imports both."
            : "Add the people you work with at each company, or connect HubSpot to import them with their companies."}
        </EmptyState>
      )}

      {data && !empty && (
        <>
          <Toolbar onClear={filtered ? clear : undefined}>
            <SearchBox value={query.q} onChange={(q) => update({ q })} placeholder="Search name, email, title, company" />
            <FilterSelect
              label="Company"
              value={query.filters.accountId ?? ""}
              onChange={(accountId) => update({ filters: { accountId } })}
              options={[...companies.map((a) => ({ value: a.id, label: a.name })), { value: "none", label: "No company" }]}
            />
            <FilterSelect
              label="Source"
              value={query.filters.source ?? ""}
              onChange={(source) => update({ filters: { source } })}
              options={[{ value: "crm", label: "HubSpot" }, { value: "kept", label: "Added in Kept" }]}
            />
          </Toolbar>

          <div className={cx(ui.tableWrap, loading && "opacity-60 transition-opacity")} aria-busy={loading}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <SortTh label="Name" sortKey="name" query={query} onSort={toggleSort} />
                  <SortTh label="Company" sortKey="company" query={query} onSort={toggleSort} />
                  <SortTh label="Email" sortKey="email" query={query} onSort={toggleSort} />
                  <th className={ui.th}>Phone</th>
                  <th className={ui.th} aria-label="Actions" />
                </tr>
              </thead>
              <tbody className={ui.tbody}>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-muted">
                      No contacts match.{" "}
                      <button className="font-medium text-brand hover:text-brand-hover" onClick={clear}>
                        Clear filters
                      </button>
                    </td>
                  </tr>
                )}
                {data.items.map((c) => (
                  <tr key={c.id} className="hover:bg-hover/50">
                    <td className={cx(ui.td, "min-w-44")}>
                      <div className="font-medium">{c.fullName ?? <span className="text-ink-muted">No name</span>}</div>
                      {c.title && <div className={ui.hint}>{c.title}</div>}
                    </td>
                    <td className={ui.td}>
                      {c.accountId && c.accountName ? (
                        <Link to={`../companies/${c.accountId}`} className="hover:text-brand hover:underline">
                          {c.accountName}
                        </Link>
                      ) : (
                        <span className="text-ink-faint">No company</span>
                      )}
                    </td>
                    <td className={ui.td}>
                      {c.email ? <a href={`mailto:${c.email}`} className="hover:text-brand hover:underline">{c.email}</a> : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className={cx(ui.td, "whitespace-nowrap")}>
                      {c.phone ? <a href={`tel:${c.phone}`} className="hover:text-brand hover:underline">{c.phone}</a> : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className={ui.tdActions}>
                      {c.source ? (
                        <span className={ui.badge}>{SOURCE_NAMES[c.source] ?? c.source}</span>
                      ) : (
                        manage && (
                          <>
                            <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "edit", contact: c })}>Edit</button>
                            <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "remove", contact: c })}>Remove</button>
                          </>
                        )
                      )}
                    </td>
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

      {dialog?.kind === "create" && (
        <ContactDialog accountId={query.filters.accountId && query.filters.accountId !== "none" ? query.filters.accountId : undefined} onClose={() => setDialog(null)} onSaved={load} />
      )}
      {dialog?.kind === "edit" && <ContactDialog contact={dialog.contact} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog?.kind === "remove" && (
        <ConfirmDialog
          title={`Remove ${dialog.contact.fullName ?? dialog.contact.email}?`}
          confirmLabel="Remove contact"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.deleteContact(orgId, dialog.contact.id);
            await load();
          }}
        >
          Their emails stop being routed to {dialog.contact.accountName ?? "their company"} unless its domain still matches.
        </ConfirmDialog>
      )}
    </Page>
  );
}

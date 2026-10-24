import { Route } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { can, type AccountDto, type RoutingContainerDto, type RoutingDto } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { EmptyState, Loading, Page, Section } from "../../components/Page";
import { cx, ui } from "../../ui";

const PROVIDER_NAMES: Record<string, string> = {
  slack: "Slack", linear: "Linear", notion: "Notion", microsoft: "Microsoft 365", google: "Google", hubspot: "HubSpot",
};

/**
 * Owners decide which client each Slack channel, Linear team and Notion space belongs to.
 * Email, calendar and HubSpot are routed automatically by contacts and domains.
 */
export function RoutingPage() {
  const api = useApi();
  const { orgId, actor } = useOrg();
  const [routing, setRouting] = useState<RoutingDto | null>(null);
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RoutingContainerDto | null>(null);

  const load = useCallback(
    () =>
      Promise.all([api.routing(orgId), api.accounts(orgId)]).then(
        ([r, a]) => {
          setRouting(r);
          setAccounts(a);
        },
        (err: Error) => setError(err.message),
      ),
    [api, orgId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (!can(actor, { action: "org.manage" })) {
    return (
      <Page title="Routing">
        <EmptyState icon={Route} title="Only owners manage routing">
          Owners decide which client each Slack channel, Linear team and Notion space belongs to.
        </EmptyState>
      </Page>
    );
  }
  if (!routing) {
    return <Page title="Routing">{error ? <p className={ui.errorBlock}>{error}</p> : <Loading />}</Page>;
  }

  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "Deleted account";
  const unmapped = routing.containers.filter((c) => !c.mapping);
  const mapped = routing.containers.filter((c) => c.mapping);
  const counts = routing.counts;
  const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);

  const table = (rows: RoutingContainerDto[]) => (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Channel, team or space</th>
            <th className={`${ui.th} text-right`}>Items</th>
            <th className={ui.th}>Last activity</th>
            <th className={ui.th}>Routed to</th>
            <th className={ui.th} aria-label="Actions" />
          </tr>
        </thead>
        <tbody className={ui.tbody}>
          {rows.map((c) => (
            <tr key={`${c.connectionId}:${c.containerId}`}>
              <td className={ui.td}>
                <div className="font-medium">{c.containerLabel}</div>
                <div className={ui.hint}>
                  {PROVIDER_NAMES[c.provider] ?? c.provider}
                  {c.connectionLabel && ` · ${c.connectionLabel}`}
                </div>
              </td>
              <td className={`${ui.td} text-right tabular-nums`}>{c.itemCount.toLocaleString()}</td>
              <td className={`${ui.td} tabular-nums text-ink-muted`}>
                {new Date(c.lastActivityAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </td>
              <td className={ui.td}>
                {!c.mapping ? (
                  <span className="text-warn">Not routed</span>
                ) : c.mapping.ignored ? (
                  <span className="text-ink-muted">Ignored</span>
                ) : (
                  <span className="font-medium">{accountName(c.mapping.accountId)}</span>
                )}
              </td>
              <td className={ui.tdActions}>
                <button className={c.mapping ? ui.button.ghostSm : ui.button.primarySm} onClick={() => setEditing(c)}>
                  {c.mapping ? "Change" : "Route"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Page
      title="Routing"
      description="Every synced item is routed to one client account, and only people who can see that account can see it. Emails and meetings route themselves by contact and email domain; channels, teams and spaces are routed here."
    >
      {error && <p className={ui.errorBlock}>{error}</p>}

      <p className="mb-8 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        <span><span className="font-medium text-ink tabular-nums">{(counts.matched ?? 0).toLocaleString()}</span> routed</span>
        <span><span className={cx("font-medium tabular-nums", counts.unmatched ? "text-warn" : "text-ink")}>{(counts.unmatched ?? 0).toLocaleString()}</span> unrouted</span>
        <span><span className={cx("font-medium tabular-nums", counts.ambiguous ? "text-warn" : "text-ink")}>{(counts.ambiguous ?? 0).toLocaleString()}</span> match several accounts</span>
        <span><span className="font-medium text-ink tabular-nums">{(counts.ignored ?? 0).toLocaleString()}</span> ignored</span>
        {!!counts.pending && <span><span className="font-medium text-ink tabular-nums">{counts.pending.toLocaleString()}</span> waiting to be routed</span>}
        <span className="text-ink-faint">of {total.toLocaleString()} synced items</span>
      </p>

      {routing.containers.length === 0 ? (
        <EmptyState icon={Route} title="Nothing to route by hand yet">
          Slack channels, Linear teams and Notion spaces appear here once they've synced. Emails, meetings and HubSpot
          records are routed automatically.
        </EmptyState>
      ) : (
        <>
          {unmapped.length > 0 && <Section title="Needs routing" aside={`${unmapped.length}`}>{table(unmapped)}</Section>}
          {mapped.length > 0 && <Section title="Routed">{table(mapped)}</Section>}
        </>
      )}

      {editing && <RouteDialog container={editing} accounts={accounts} onClose={() => setEditing(null)} onSaved={load} />}
    </Page>
  );
}

function RouteDialog({
  container,
  accounts,
  onClose,
  onSaved,
}: {
  container: RoutingContainerDto;
  accounts: AccountDto[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useApi();
  const { orgId } = useOrg();
  const initial = !container.mapping ? "" : container.mapping.ignored ? "ignore" : (container.mapping.accountId ?? "");
  const [choice, setChoice] = useState(initial);
  const { pending, error, submit } = useSubmit();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      const input = choice === "ignore" ? { accountId: null, ignored: true } : { accountId: choice || null, ignored: false };
      await api.setRouting(orgId, container.connectionId, container.containerId, input);
      await onSaved();
      onClose();
    });
  }

  return (
    <Modal
      title={`Route ${container.containerLabel}`}
      description={`Its ${container.itemCount.toLocaleString()} items, and everything posted there later, follow this choice.`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <Field label="Client account" htmlFor="route-account">
          <select id="route-account" className={`${ui.select} w-full`} value={choice} onChange={(e) => setChoice(e.target.value)} autoFocus>
            <option value="">Not routed yet</option>
            <option value="ignore">Not about a client (ignore)</option>
            <optgroup label="Accounts">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          </select>
        </Field>
        {accounts.length === 0 && <p className={`${ui.hint} mt-2`}>Create accounts first, on the Accounts page.</p>}
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending || choice === initial}>
            {pending ? "Saving…" : "Save"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

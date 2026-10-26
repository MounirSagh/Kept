import { Route, Sparkles } from "lucide-react";
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
 * Which client each Slack channel, Linear team, Notion space and folder belongs to. Kept routes
 * the ones whose name or people point to one client; owners confirm, change or route the rest.
 * Email, calendar and HubSpot are routed item by item, by contacts and domains.
 */
export function RoutingPage() {
  const api = useApi();
  const { orgId, actor } = useOrg();
  const [routing, setRouting] = useState<RoutingDto | null>(null);
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RoutingContainerDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
  const auto = routing.containers.filter((c) => c.mapping?.auto);
  const mapped = routing.containers.filter((c) => c.mapping && !c.mapping.auto);

  // Confirming makes Kept's choice the owner's: it then stays even if the evidence changes.
  const confirm = async (c: RoutingContainerDto) => {
    setBusy(`${c.connectionId}:${c.containerId}`);
    try {
      await api.setRouting(orgId, c.connectionId, c.containerId, { accountId: c.mapping!.accountId, ignored: false });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const toggleAuto = async () => {
    setBusy("auto");
    try {
      await api.setRoutingSettings(orgId, { auto: !routing.auto });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
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
                {c.mapping?.auto && c.mapping.reason && <div className={cx(ui.hint, "max-w-sm")}>{c.mapping.reason}</div>}
              </td>
              <td className={ui.tdActions}>
                <div className="flex justify-end gap-2">
                  {c.mapping?.auto && (
                    <button className={ui.button.primarySm} onClick={() => void confirm(c)} disabled={busy !== null}>
                      {busy === `${c.connectionId}:${c.containerId}` ? "Confirming…" : "Confirm"}
                    </button>
                  )}
                  <button className={c.mapping ? ui.button.ghostSm : ui.button.primarySm} onClick={() => setEditing(c)}>
                    {c.mapping ? "Change" : "Route"}
                  </button>
                </div>
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
      description="Every synced item is routed to one client account, and only people who can see that account can see it. Emails and meetings route themselves by contact and email domain; channels, teams, spaces and folders are routed here."
    >
      {error && <p className={ui.errorBlock}>{error}</p>}

      <div className="mb-8 flex items-start justify-between gap-6 rounded-lg border border-line p-4">
        <div>
          <p id="auto-routing-label" className="text-sm font-medium">Route automatically</p>
          <p id="auto-routing-hint" className={cx(ui.hint, "mt-1 max-w-2xl")}>
            Kept routes a channel, team, space or folder to a client when its name names exactly one client (#ext-northwind,
            "Drive › Northwind"), or when nearly all of its messages from clients come from one client's people. Nothing is
            routed against an owner's choice. Check what it did below.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={routing.auto}
          aria-labelledby="auto-routing-label"
          aria-describedby="auto-routing-hint"
          onClick={() => void toggleAuto()}
          disabled={busy !== null}
          className={cx(
            "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-60",
            routing.auto ? "bg-brand" : "bg-line-strong",
          )}
        >
          <span
            aria-hidden
            className={cx(
              "inline-block size-4 rounded-full bg-canvas shadow-sm transition-transform duration-150",
              routing.auto ? "translate-x-4.5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

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
          Slack channels, Linear teams, Notion spaces and Drive or OneDrive folders appear here once they've synced. Emails,
          meetings and HubSpot records are routed item by item.
        </EmptyState>
      ) : (
        <>
          {unmapped.length > 0 && <Section title="Needs routing" aside={`${unmapped.length}`}>{table(unmapped)}</Section>}
          {auto.length > 0 && (
            <Section title="Routed automatically" aside={`${auto.length} to check`}>
              <p className={cx(ui.hint, "mb-3 flex items-center gap-1.5")}>
                <Sparkles className="size-3.5" aria-hidden /> Confirm the ones that are right; change the rest. Confirmed routes stay
                as they are.
              </p>
              {table(auto)}
            </Section>
          )}
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
            <option value="">Not routed (item by item only)</option>
            <option value="ignore">Not about a client (ignore)</option>
            <optgroup label="Accounts">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          </select>
        </Field>
        {accounts.length === 0 && <p className={`${ui.hint} mt-2`}>Create accounts first, on the Accounts page.</p>}
        {container.mapping?.auto && container.mapping.reason && (
          <p className={`${ui.hint} mt-2`}>Kept routed it automatically: {container.mapping.reason}.</p>
        )}
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

import { Briefcase, Cloud, Database, Table2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AccountDto, ZetarisDatasetDto, ZetarisDto, ZetarisTestDto } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { ConfirmDialog, Field, FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { Section } from "../../components/Page";
import { cx, ui } from "../../ui";

/** What an org typically reaches through Zetaris: registered there, then queried here as datasets. */
const REACHABLE: { name: string; icon: LucideIcon }[] = [
  { name: "Salesforce, Dynamics 365", icon: Briefcase },
  { name: "Snowflake, BigQuery, Redshift, Postgres", icon: Database },
  { name: "Amazon S3, Azure Blob", icon: Cloud },
];

const EXAMPLE_SQL = `SELECT month, active_vehicles, active_users, sso_logins
FROM orbit_wh.usage_monthly
WHERE customer_domain = {{domain}}
ORDER BY month DESC
LIMIT 6`;

/**
 * Zetaris, the org's data harness: connected once by an owner with an API key. Owners define
 * datasets (read-only SQL filtered to one company) that the agents query live during reviews.
 */
export function ZetarisSection({ canManage }: { canManage: boolean }) {
  const api = useApi();
  const { orgId } = useOrg();
  const [data, setData] = useState<ZetarisDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "connect" } | { kind: "disconnect" } | { kind: "dataset"; dataset: ZetarisDatasetDto | null } | { kind: "delete"; dataset: ZetarisDatasetDto } | null
  >(null);

  const load = useCallback(() => api.zetaris(orgId).then(setData, (err: Error) => setError(err.message)), [api, orgId]);
  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  const reachable = (
    <p className={cx(ui.hint, "mt-3 flex flex-wrap gap-x-4 gap-y-1")}>
      <span>Reach through Zetaris:</span>
      {REACHABLE.map(({ name, icon: Icon }) => (
        <span key={name} className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5" aria-hidden /> {name}
        </span>
      ))}
    </p>
  );

  return (
    <Section title="Zetaris">
      <p className={`${ui.hint} -mt-1 mb-3 max-w-3xl`}>
        Zetaris reaches your warehouse, billing and CRM data where it lives. Kept's agents query it live while reviewing a
        client (usage, invoices, support tickets) and quote the rows they rely on.
      </p>
      <div className="rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-4 px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-sidebar text-ink-muted">
            <Database className="size-4.5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Zetaris</p>
            <p className={ui.hint}>
              {!canManage
                ? "An owner connects Zetaris."
                : !data
                  ? "Loading…"
                  : data.connected
                    ? <>Connected to {data.restUrl} · organization {data.zetarisOrgId}</>
                    : "Not connected"}
            </p>
            {data?.lastError && <p className="mt-0.5 text-xs text-warn">{data.lastError}</p>}
          </div>
          {canManage && data && (
            <div className="flex gap-2">
              <button className={data.connected ? ui.button.ghostSm : ui.button.primarySm} onClick={() => setDialog({ kind: "connect" })}>
                {data.connected ? "Edit" : "Connect"}
              </button>
              {data.connected && (
                <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "disconnect" })}>
                  Disconnect
                </button>
              )}
            </div>
          )}
        </div>

        {canManage && data?.connected && (
          <div className="border-t border-line px-4 py-3.5">
            <div className="mb-2 flex items-center justify-between gap-4">
              <p className="text-sm font-medium">
                Datasets <span className="font-normal text-ink-muted">{data.datasets.length}</span>
              </p>
              <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "dataset", dataset: null })}>
                Add dataset
              </button>
            </div>
            {data.datasets.length === 0 ? (
              <p className={ui.hint}>
                A dataset is a read-only query filtered to one company, like product usage by month or open invoices. The agents
                decide when to check each one.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.datasets.map((d) => (
                  <li key={d.id} className="flex items-start gap-3 py-2.5">
                    <Table2 className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{d.name}</p>
                      <p className={ui.hint}>{d.description}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "dataset", dataset: d })}>
                        Edit
                      </button>
                      <button className={ui.button.ghostSm} onClick={() => setDialog({ kind: "delete", dataset: d })}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {reachable}
      {error && <p className={cx(ui.errorBlock, "mt-3")}>{error}</p>}

      {dialog?.kind === "connect" && data && <ConnectDialog current={data} onClose={() => setDialog(null)} onSaved={setData} />}
      {dialog?.kind === "dataset" && data && (
        <DatasetDialog dataset={dialog.dataset} params={data.params} onClose={() => setDialog(null)} onSaved={setData} />
      )}
      {dialog?.kind === "disconnect" && (
        <ConfirmDialog
          title="Disconnect Zetaris?"
          confirmLabel="Disconnect"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.disconnectZetaris(orgId);
            await load();
          }}
        >
          The agents stop querying live data, and the data tables kept as evidence are deleted. Your datasets are deleted too.
        </ConfirmDialog>
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete "${dialog.dataset.name}"?`}
          confirmLabel="Delete"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async () => setData(await api.deleteZetarisDataset(orgId, dialog.dataset.id))}
        >
          The agents stop checking it, and its saved results are deleted.
        </ConfirmDialog>
      )}
    </Section>
  );
}

function ConnectDialog({ current, onClose, onSaved }: { current: ZetarisDto; onClose: () => void; onSaved: (d: ZetarisDto) => void }) {
  const api = useApi();
  const { orgId } = useOrg();
  const { pending, error, submit } = useSubmit();
  const [restUrl, setRestUrl] = useState(current.restUrl ?? "");
  const [zetarisOrgId, setZetarisOrgId] = useState(current.zetarisOrgId ?? "");
  const [apiKey, setApiKey] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      onSaved(await api.connectZetaris(orgId, { restUrl, zetarisOrgId, apiKey: apiKey || undefined }));
      onClose();
    });
  }

  return (
    <Modal title={current.connected ? "Zetaris connection" : "Connect Zetaris"} description="Kept checks the connection with SELECT 1 before saving it." onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Address" htmlFor="z-url" hint={<>The engine's REST API, ending in /api/v1.0 (locally http://localhost:8888/api/v1.0), or your Zetaris web address.</>}>
          <input id="z-url" className={cx(ui.input, "w-full")} value={restUrl} onChange={(e) => setRestUrl(e.target.value)} placeholder="http://localhost:8888/api/v1.0" required autoFocus />
        </Field>
        <Field label="Organization id" htmlFor="z-org" hint="The number under Management → Organisation in Zetaris.">
          <input id="z-org" inputMode="numeric" className={cx(ui.input, "w-32")} value={zetarisOrgId} onChange={(e) => setZetarisOrgId(e.target.value)} required />
        </Field>
        <Field label="API key" htmlFor="z-key" hint={current.connected ? "Leave empty to keep the current key." : "Create one in Zetaris. It's stored encrypted."}>
          <input id="z-key" type="password" autoComplete="off" className={cx(ui.input, "w-full")} value={apiKey} onChange={(e) => setApiKey(e.target.value)} required={!current.connected} />
        </Field>
        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending}>
            {pending ? "Checking…" : current.connected ? "Save" : "Connect"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function DatasetDialog({
  dataset,
  params,
  onClose,
  onSaved,
}: {
  dataset: ZetarisDatasetDto | null;
  params: string[];
  onClose: () => void;
  onSaved: (d: ZetarisDto) => void;
}) {
  const api = useApi();
  const { orgId } = useOrg();
  const { pending, error, submit } = useSubmit();
  const [name, setName] = useState(dataset?.name ?? "");
  const [description, setDescription] = useState(dataset?.description ?? "");
  const [sql, setSql] = useState(dataset?.sql ?? "");
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [accountId, setAccountId] = useState("");
  const [test, setTest] = useState<{ result: ZetarisTestDto | null; error: string | null; running: boolean }>({ result: null, error: null, running: false });

  useEffect(() => {
    api.accounts(orgId).then((a) => {
      setAccounts(a);
      setAccountId((id) => id || a[0]?.id || "");
    }, () => {});
  }, [api, orgId]);

  async function runTest() {
    setTest({ result: null, error: null, running: true });
    try {
      setTest({ result: await api.testZetarisDataset(orgId, { sql, accountId }), error: null, running: false });
    } catch (err) {
      setTest({ result: null, error: (err as Error).message, running: false });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(async () => {
      const input = { name, description, sql };
      onSaved(dataset ? await api.updateZetarisDataset(orgId, dataset.id, input) : await api.addZetarisDataset(orgId, input));
      onClose();
    });
  }

  const r = test.result;
  return (
    <Modal title={dataset ? "Edit dataset" : "Add dataset"} description="A read-only query the agents run live for the company they're reviewing." onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="ds-name">
          <input id="ds-name" className={cx(ui.input, "w-full")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Product usage by month" maxLength={80} required autoFocus />
        </Field>
        <Field label="What it shows" htmlFor="ds-desc" hint="The agents read this to decide when to check it. Say what a worrying result looks like.">
          <textarea
            id="ds-desc"
            rows={2}
            className={cx(ui.input, "w-full resize-y")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Active vehicles, users and SSO logins per month. A drop before a renewal is a churn signal."
            maxLength={500}
            required
          />
        </Field>
        <Field
          label="SQL"
          htmlFor="ds-sql"
          hint={<>One SELECT. Filter it to the company with {params.map((p) => `{{${p}}}`).join(", ")}; Kept fills them in for each company.</>}
        >
          <textarea
            id="ds-sql"
            rows={6}
            spellCheck={false}
            className={cx(ui.input, "w-full resize-y font-mono text-[0.8125rem] leading-relaxed")}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder={EXAMPLE_SQL}
            required
          />
        </Field>

        <div className="rounded-md border border-line p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Try it for" htmlFor="ds-account">
              <select id="ds-account" className={ui.select} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" className={ui.button.ghost} onClick={() => void runTest()} disabled={!sql.trim() || !accountId || test.running}>
              {test.running ? "Running…" : "Run"}
            </button>
          </div>
          {test.error && <p className="mt-2 text-sm text-danger">{test.error}</p>}
          {r && (
            <div className="mt-3 space-y-2">
              {r.sql && <pre className="overflow-x-auto rounded bg-sidebar px-2.5 py-2 text-xs text-ink-muted">{r.sql}</pre>}
              {r.note && <p className={ui.hint}>{r.note}</p>}
              {r.rows.length > 0 && (
                <div className="max-h-64 overflow-auto rounded border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-sidebar">
                      <tr>
                        {r.columns.map((c) => (
                          <th key={c} className="px-2.5 py-1.5 font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {r.rows.map((row, i) => (
                        <tr key={i}>
                          {row.map((v, j) => (
                            <td key={j} className="px-2.5 py-1.5 tabular-nums">
                              {v === null || v === undefined ? "" : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending}>
            {pending ? "Saving…" : dataset ? "Save" : "Add dataset"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

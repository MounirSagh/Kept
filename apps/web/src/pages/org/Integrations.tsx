import {
  Briefcase, CircleDot, Cloud, Database, FileText, Inbox, Mail, MessageSquare, RefreshCw, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { can, type ConnectionDto, type ConnectionsDto, type ProviderId, type ProviderInfoDto } from "@kept/shared";
import { useApi } from "../../api";
import { memberName, useOrg } from "../../app/org-context";
import { ConfirmDialog } from "../../components/Modal";
import { Loading, Page, Section } from "../../components/Page";
import { cx, ui } from "../../ui";

const ICONS: Record<ProviderId, LucideIcon> = {
  microsoft: Mail,
  google: Inbox,
  slack: MessageSquare,
  linear: CircleDot,
  notion: FileText,
  hubspot: Briefcase,
};

const VIA_ZETARIS: { name: string; reads: string; icon: LucideIcon }[] = [
  { name: "Salesforce", reads: "Accounts, owners, opportunities and renewal dates.", icon: Briefcase },
  { name: "Microsoft Dynamics 365", reads: "Accounts, contacts and opportunities.", icon: Briefcase },
  { name: "Amazon S3 and Azure Blob", reads: "Contracts and SOWs stored as files.", icon: Cloud },
  { name: "Data warehouses", reads: "Snowflake, BigQuery, Redshift and others, for usage and revenue data.", icon: Database },
];

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function IntegrationsPage() {
  const api = useApi();
  const { orgId, actor, members } = useOrg();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<ConnectionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ConnectionDto | null>(null);
  const connected = params.get("connected");

  const load = useCallback(() => api.connections(orgId).then(setData, (err: Error) => setError(err.message)), [api, orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  // While anything is syncing, keep the status fresh.
  const syncing = data?.connections.some((c) => c.syncing) ?? false;
  useEffect(() => {
    if (!syncing) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [syncing, load]);

  async function connect(provider: ProviderId) {
    setError(null);
    setBusy(provider);
    try {
      const { url } = await api.authorizeConnection(orgId, provider);
      window.location.assign(url);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function syncNow(c: ConnectionDto) {
    setError(null);
    try {
      await api.syncConnection(orgId, c.id);
      setData((d) => d && { ...d, connections: d.connections.map((x) => (x.id === c.id ? { ...x, syncing: true } : x)) });
      setTimeout(() => void load(), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!data) {
    return (
      <Page title="Integrations">
        {error ? <p className={ui.errorBlock}>{error}</p> : <Loading />}
      </Page>
    );
  }

  const personal = data.providers.filter((p) => p.scope === "personal");
  const workspace = data.providers.filter((p) => p.scope === "org");
  const mine = (p: ProviderInfoDto) => data.connections.filter((c) => c.provider === p.id && c.ownerUserId === actor.userId);
  const orgWide = (p: ProviderInfoDto) => data.connections.filter((c) => c.provider === p.id && c.ownerUserId === null);
  const others = data.connections.filter((c) => c.ownerUserId !== null && c.ownerUserId !== actor.userId);
  const canConnectWorkspace = can(actor, { action: "connection.create", scope: "org" });
  const connectedName = data.providers.find((p) => p.id === connected)?.name;

  const row = (p: ProviderInfoDto, conns: ConnectionDto[], allowed: boolean, notAllowedHint: string) => (
    <ProviderRow
      key={p.id}
      provider={p}
      connections={conns}
      action={
        conns.length > 0 ? null : !p.configured ? (
          <span className="text-xs text-ink-faint">Not set up on the server</span>
        ) : allowed ? (
          <button className={ui.button.ghostSm} onClick={() => void connect(p.id)} disabled={busy === p.id}>
            {busy === p.id ? "Opening…" : "Connect"}
          </button>
        ) : (
          <span className="text-xs text-ink-faint">{notAllowedHint}</span>
        )
      }
      onReconnect={() => void connect(p.id)}
      onSync={(c) => void syncNow(c)}
      onRemove={setRemoving}
    />
  );

  return (
    <Page
      title="Integrations"
      description="Kept reads from the tools you connect, never writes to them, and only sends anything after someone approves it."
    >
      {connectedName && (
        <div className={`${ui.notice} flex items-center justify-between gap-4`} role="status">
          <p className="text-sm">
            {connectedName} is connected. The first sync reads the last 90 days and runs in the background.
          </p>
          <button className={ui.button.ghostSm} onClick={() => setParams({}, { replace: true })}>
            Dismiss
          </button>
        </div>
      )}
      {error && <p className={ui.errorBlock}>{error}</p>}

      <Section title="Your accounts">
        <p className={`${ui.hint} -mt-1 mb-3`}>Only you see what's synced from your own accounts until it's matched to a client.</p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {personal.map((p) => row(p, mine(p), true, ""))}
        </ul>
      </Section>

      <Section title="Workspace tools">
        <ul className="divide-y divide-line rounded-lg border border-line">
          {workspace.map((p) => row(p, orgWide(p), canConnectWorkspace, "An owner connects this"))}
        </ul>
      </Section>

      {others.length > 0 && (
        <Section title="Members' accounts">
          <ul className="divide-y divide-line rounded-lg border border-line">
            {others.map((c) => {
              const p = data.providers.find((x) => x.id === c.provider)!;
              const Icon = ICONS[c.provider];
              return (
                <li key={c.id} className="flex items-center gap-4 px-4 py-3">
                  <IconBox icon={Icon} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {c.label} <span className="font-normal text-ink-muted">· {p.name}</span>
                    </p>
                    <p className={ui.hint}>
                      {memberName(members, c.ownerUserId)} · <Status connection={c} />
                    </p>
                  </div>
                  <button className={ui.button.ghostSm} onClick={() => setRemoving(c)}>
                    Disconnect
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Through Zetaris">
        <ul className="divide-y divide-line rounded-lg border border-line">
          {VIA_ZETARIS.map(({ name, reads, icon }) => (
            <li key={name} className="flex items-center gap-4 px-4 py-3.5">
              <IconBox icon={icon} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{name}</p>
                <p className={ui.hint}>{reads}</p>
              </div>
              <span className="text-xs text-ink-faint">Coming soon</span>
            </li>
          ))}
        </ul>
      </Section>

      {removing && (
        <ConfirmDialog
          title={`Disconnect ${removing.label ?? "this account"}?`}
          confirmLabel="Disconnect"
          tone="danger"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.removeConnection(orgId, removing.id);
            await load();
          }}
        >
          Kept stops syncing it and deletes the {removing.itemCount.toLocaleString()} items it read from this account. You can
          connect it again later.
        </ConfirmDialog>
      )}
    </Page>
  );
}

function IconBox({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-sidebar text-ink-muted">
      <Icon className="size-4.5" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

function Status({ connection: c }: { connection: ConnectionDto }) {
  if (c.status !== "active") return <span className="text-danger">Needs reconnecting</span>;
  if (c.syncing) return <span>Syncing…</span>;
  if (c.lastError) return <span className="text-warn">Last sync failed</span>;
  if (!c.lastSyncedAt) return <span>Waiting for first sync</span>;
  return (
    <span>
      Synced {timeAgo(c.lastSyncedAt)} · {c.itemCount.toLocaleString()} items
    </span>
  );
}

function ProviderRow({
  provider: p,
  connections,
  action,
  onReconnect,
  onSync,
  onRemove,
}: {
  provider: ProviderInfoDto;
  connections: ConnectionDto[];
  action: ReactNode;
  onReconnect(): void;
  onSync(c: ConnectionDto): void;
  onRemove(c: ConnectionDto): void;
}) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center gap-4">
        <IconBox icon={ICONS[p.id]} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{p.name}</p>
          <p className={ui.hint}>{p.reads}</p>
        </div>
        {action}
      </div>
      {connections.map((c) => (
        <div key={c.id} className="mt-3 ml-13 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-sidebar px-3 py-2">
          <div className="min-w-0 flex-1 text-[0.8125rem]">
            <span className="font-medium">{c.label}</span>
            <span className="text-ink-muted"> · <Status connection={c} /></span>
            {c.lastError && c.status === "active" && (
              <p className="mt-0.5 truncate text-xs text-ink-muted" title={c.lastError}>
                {c.lastError}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {c.status === "active" ? (
              <button className={ui.button.ghostSm} onClick={() => onSync(c)} disabled={c.syncing}>
                <RefreshCw className={cx("size-3.5", c.syncing && "animate-spin")} aria-hidden />
                Sync now
              </button>
            ) : (
              <button className={ui.button.primarySm} onClick={onReconnect}>
                Reconnect
              </button>
            )}
            <button className={ui.button.ghostSm} onClick={() => onRemove(c)}>
              Disconnect
            </button>
          </div>
        </div>
      ))}
    </li>
  );
}

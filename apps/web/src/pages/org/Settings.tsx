import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { can } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { EmptyState, Page, Section } from "../../components/Page";
import { ui } from "../../ui";

export function SettingsPage() {
  const { actor, org } = useOrg();
  if (!can(actor, { action: "org.manage" })) {
    return (
      <Page title="Organization">
        <EmptyState icon={Lock} title="Only owners can change organization settings">
          Ask an owner of {org.name} if something here needs to change.
        </EmptyState>
      </Page>
    );
  }
  return <OrgSettingsForm />;
}

function OrgSettingsForm() {
  const api = useApi();
  const { org, orgId, onSelfChanged } = useOrg();
  const [name, setName] = useState(org.name);
  const [status, setStatus] = useState<{ kind: "saved" } | { kind: "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await api.renameOrg(orgId, name);
      setStatus({ kind: "saved" });
      onSelfChanged();
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="Organization">
      <Section title="General">
        <form className="max-w-md space-y-5" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="org-name" className={ui.label}>Name</label>
            <input
              id="org-name"
              className={`${ui.input} w-full`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="org-slug" className={ui.label}>URL</label>
            <input id="org-slug" className={`${ui.input} w-full bg-sidebar text-ink-muted`} value={`/o/${org.slug}`} readOnly />
            <p className={ui.hint}>The URL can't be changed yet.</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className={ui.button.primary} disabled={saving || name.trim() === org.name}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            {status?.kind === "saved" && <span className={ui.hint} role="status">Saved</span>}
            {status?.kind === "error" && <span className={ui.error} role="alert">{status.message}</span>}
          </div>
        </form>
      </Section>
    </Page>
  );
}

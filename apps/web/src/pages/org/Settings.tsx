import { Lock } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { can, type OrgProfile } from "@kept/shared";
import { useApi } from "../../api";
import { useOrg } from "../../app/org-context";
import { EmptyState, Loading, Page, Section } from "../../components/Page";
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

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY", "MAD", "AED", "SGD", "INR", "BRL"];

/** One text field; `wide` spans both columns. */
function Input({
  id,
  label,
  value,
  onChange,
  wide,
  hint,
  ...rest
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange(v: string): void;
  wide?: boolean;
  hint?: ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id">) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <label htmlFor={id} className={ui.label}>{label}</label>
      <input id={id} className={`${ui.input} w-full`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...rest} />
      {hint && <p className={ui.hint}>{hint}</p>}
    </div>
  );
}

function OrgSettingsForm() {
  const api = useApi();
  const { org, orgId, onSelfChanged } = useOrg();
  const [name, setName] = useState(org.name);
  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "saved" } | { kind: "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timeZones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);

  useEffect(() => {
    api.org(orgId).then(
      (o) => {
        setProfile(o.profile);
        setSaved(JSON.stringify({ name: o.name, profile: o.profile }));
      },
      (err: Error) => setLoadError(err.message),
    );
  }, [api, orgId]);

  if (!profile) return <Page title="Organization">{loadError ? <p className={ui.errorBlock}>{loadError}</p> : <Loading />}</Page>;

  const set = (patch: Partial<OrgProfile>) => {
    setStatus(null);
    setProfile((p) => ({ ...p, ...patch }));
  };
  const setAddress = (patch: NonNullable<OrgProfile["address"]>) => set({ address: { ...profile.address, ...patch } });
  const dirty = JSON.stringify({ name, profile }) !== saved;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const updated = await api.updateOrg(orgId, { name, profile: profile! });
      setProfile(updated.profile);
      setSaved(JSON.stringify({ name: updated.name, profile: updated.profile }));
      setStatus({ kind: "saved" });
      if (updated.name !== org.name) onSelfChanged();
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Page
      title="Organization"
      description="Kept uses these details when it drafts emails and messages on your behalf: your signature, contact details, and the time zone for dates."
    >
      <form onSubmit={onSubmit} className="max-w-2xl">
        <Section title="Company">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="o-name" label="Name" value={name} onChange={(v) => { setStatus(null); setName(v); }} required maxLength={100} />
            <Input id="o-legal" label="Legal name" value={profile.legalName} onChange={(v) => set({ legalName: v })} placeholder="Acme Success Inc." maxLength={200} />
            <Input id="o-website" label="Website" value={profile.website} onChange={(v) => set({ website: v })} placeholder="https://acme.com" maxLength={300} />
            <Input id="o-industry" label="Industry" value={profile.industry} onChange={(v) => set({ industry: v })} placeholder="B2B software" maxLength={100} />
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="o-desc" className={ui.label}>What the company does</label>
              <textarea
                id="o-desc"
                className={`${ui.input} min-h-20 w-full`}
                value={profile.description ?? ""}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="We help mid-market finance teams close their books faster."
                maxLength={2000}
              />
              <p className={ui.hint}>A few sentences. Gives drafted messages the right context about who you are.</p>
            </div>
            <Input id="o-url" label="URL" value={`/o/${org.slug}`} onChange={() => {}} readOnly className={`${ui.input} w-full bg-sidebar text-ink-muted`} hint="The URL can't be changed yet." />
          </div>
        </Section>

        <Section title="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="o-email" label="Email" type="email" value={profile.email} onChange={(v) => set({ email: v })} placeholder="hello@acme.com" />
            <Input id="o-phone" label="Phone" type="tel" value={profile.phone} onChange={(v) => set({ phone: v })} placeholder="+1 555 010 2030" maxLength={50} />
          </div>
        </Section>

        <Section title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="o-line1" label="Street address" wide value={profile.address?.line1} onChange={(v) => setAddress({ line1: v })} maxLength={200} />
            <Input id="o-line2" label="Apartment, suite, floor" wide value={profile.address?.line2} onChange={(v) => setAddress({ line2: v })} maxLength={200} />
            <Input id="o-city" label="City" value={profile.address?.city} onChange={(v) => setAddress({ city: v })} maxLength={100} />
            <Input id="o-region" label="State or region" value={profile.address?.region} onChange={(v) => setAddress({ region: v })} maxLength={100} />
            <Input id="o-postal" label="Postal code" value={profile.address?.postalCode} onChange={(v) => setAddress({ postalCode: v })} maxLength={20} />
            <Input id="o-country" label="Country" value={profile.address?.country} onChange={(v) => setAddress({ country: v })} maxLength={100} />
          </div>
        </Section>

        <Section title="Defaults">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="o-tz" className={ui.label}>Time zone</label>
              <select id="o-tz" className={`${ui.select} w-full`} value={profile.timezone ?? ""} onChange={(e) => set({ timezone: e.target.value })}>
                <option value="">Not set</option>
                {timeZones.map((tz) => (
                  <option key={tz} value={tz}>{tz.replaceAll("_", " ")}</option>
                ))}
              </select>
              {!profile.timezone && (
                <button type="button" className="text-[0.8125rem] font-medium text-brand hover:underline" onClick={() => set({ timezone: browserZone })}>
                  Use {browserZone.replaceAll("_", " ")}
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="o-currency" className={ui.label}>Currency</label>
              <input
                id="o-currency"
                className={`${ui.input} w-full uppercase`}
                list="o-currencies"
                value={profile.currency ?? ""}
                onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
                placeholder="USD"
                maxLength={3}
              />
              <datalist id="o-currencies">
                {COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}
              </datalist>
              <p className={ui.hint}>For amounts in drafts and reports. Accounts can override it.</p>
            </div>
          </div>
        </Section>

        <Section title="Email signature">
          <textarea
            id="o-signature"
            aria-label="Email signature"
            className={`${ui.input} min-h-28 w-full font-mono text-[0.8125rem]`}
            value={profile.emailSignature ?? ""}
            onChange={(e) => set({ emailSignature: e.target.value })}
            placeholder={"Best,\n{sender name}\nAcme Success · acme.com · +1 555 010 2030"}
            maxLength={2000}
          />
          <p className={`${ui.hint} mt-1.5`}>Added to emails Kept drafts. {"{sender name}"} becomes the name of the person sending.</p>
        </Section>

        <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-line bg-canvas px-1 py-4">
          <button type="submit" className={ui.button.primary} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {status?.kind === "saved" && <span className={ui.hint} role="status">Saved</span>}
          {status?.kind === "error" && <span className={ui.error} role="alert">{status.message}</span>}
          {dirty && !status && <span className={ui.hint}>Unsaved changes</span>}
        </div>
      </form>
    </Page>
  );
}

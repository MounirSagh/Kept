import { useState, type FormEvent, type ReactNode } from "react";
import { COMPANY_TYPES, type AccountDto } from "@kept/shared";
import { useApi, type AccountBody } from "../../api";
import { useOrg } from "../../app/org-context";
import { FormError, Modal, ModalActions, useSubmit } from "../../components/Modal";
import { cx, ui } from "../../ui";

export const SOURCE_NAMES: Record<string, string> = { hubspot: "HubSpot" };

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "CHF", "JPY", "MAD", "AED", "INR", "BRL", "MXN"];

/** Every IANA zone the browser knows, for the time zone picker. */
const TIME_ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

/** Cents as an editable amount: "4800000" → "48000". */
const toAmount = (cents: string | null) => (cents === null ? "" : String(Number(cents) / 100));

function Labeled({ id, label, hint, wide, children }: { id: string; label: string; hint?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx("space-y-1.5", wide && "sm:col-span-2")}>
      <label htmlFor={id} className={ui.label}>
        {label}
      </label>
      {children}
      {hint && <p className={ui.hint}>{hint}</p>}
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 flex w-full items-baseline justify-between gap-3 border-b border-line pb-2">
        <span className="text-[0.8125rem] font-semibold">{title}</span>
        {note && <span className="text-xs text-ink-muted">{note}</span>}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/**
 * Create or edit a client: its company profile, where it is, and its relationship with you.
 * For accounts a CRM imported, the profile is read-only here (it's synced); the relationship isn't.
 */
export function AccountDialog({ account, onClose, onSaved }: { account?: AccountDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const api = useApi();
  const { orgId, members } = useOrg();
  const { pending, error, submit } = useSubmit();
  const crm = account?.source ? (SOURCE_NAMES[account.source] ?? account.source) : null;
  const synced = !!crm;

  const [f, setF] = useState({
    name: account?.name ?? "",
    domain: account?.domain ?? "",
    industry: account?.industry ?? "",
    companyType: account?.companyType ?? "",
    employeeCount: account?.employeeCount?.toString() ?? "",
    annualRevenue: toAmount(account?.annualRevenueCents ?? null),
    linkedinUrl: account?.linkedinUrl ?? "",
    description: account?.description ?? "",
    city: account?.city ?? "",
    region: account?.region ?? "",
    postalCode: account?.postalCode ?? "",
    country: account?.country ?? "",
    timezone: account?.timezone ?? "",
    ownerUserId: account?.ownerUserId ?? "",
    renewalDate: account?.renewalDate ?? "",
    annualValue: toAmount(account?.annualValueCents ?? null),
    currency: account?.currency ?? "USD",
  });
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF((prev) => ({ ...prev, [key]: e.target.value }));
  const input = (key: keyof typeof f, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`acct-${key}`} className={cx(ui.input, "w-full", props.disabled && "bg-sidebar text-ink-muted")} value={f[key]} onChange={set(key)} {...props} />
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const blank = (v: string) => v.trim() || null;
    const body: AccountBody = {
      name: f.name.trim(),
      domain: blank(f.domain),
      ownerUserId: f.ownerUserId || null,
      industry: blank(f.industry),
      companyType: blank(f.companyType),
      employeeCount: f.employeeCount.trim() ? Number(f.employeeCount) : null,
      annualRevenue: blank(f.annualRevenue.replace(/[,\s]/g, "")),
      linkedinUrl: blank(f.linkedinUrl),
      description: blank(f.description),
      city: blank(f.city),
      region: blank(f.region),
      postalCode: blank(f.postalCode),
      country: blank(f.country),
      timezone: blank(f.timezone),
      renewalDate: blank(f.renewalDate),
      annualValue: blank(f.annualValue.replace(/[,\s]/g, "")),
      currency: blank(f.currency),
    };
    void submit(async () => {
      if (account) await api.updateAccount(orgId, account.id, body);
      else await api.createAccount(orgId, body);
      await onSaved();
      onClose();
    });
  }

  const syncedNote = synced ? `Synced from ${crm}: edit it there` : undefined;

  return (
    <Modal title={account ? `Edit ${account.name}` : "New account"} onClose={onClose} wide>
      <form className="space-y-7" onSubmit={onSubmit}>
        <Group title="Company" note={syncedNote}>
          <Labeled id="acct-name" label="Company name">
            {input("name", { required: true, maxLength: 200, autoFocus: !account, disabled: synced })}
          </Labeled>
          <Labeled id="acct-domain" label="Email domain" hint={synced ? undefined : "People at this domain are routed to this account."}>
            {input("domain", { placeholder: "northwind.com", maxLength: 253, disabled: synced })}
          </Labeled>
          <Labeled id="acct-industry" label="Industry">
            {input("industry", { placeholder: "Logistics", maxLength: 100, disabled: synced })}
          </Labeled>
          <Labeled id="acct-companyType" label="Type">
            <select id="acct-companyType" className={cx(ui.select, "w-full", synced && "bg-sidebar text-ink-muted")} value={f.companyType} onChange={set("companyType")} disabled={synced}>
              <option value="">Not set</option>
              {/* Keep a CRM value the list doesn't have. */}
              {f.companyType && !(COMPANY_TYPES as readonly string[]).includes(f.companyType) && <option value={f.companyType}>{f.companyType}</option>}
              {COMPANY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Labeled>
          <Labeled id="acct-employeeCount" label="Number of employees">
            {input("employeeCount", { type: "number", min: 0, step: 1, disabled: synced })}
          </Labeled>
          <Labeled id="acct-annualRevenue" label="Annual revenue" hint={synced ? undefined : "The client's own revenue, in the currency below."}>
            {input("annualRevenue", { inputMode: "decimal", placeholder: "10000000", disabled: synced })}
          </Labeled>
          <Labeled id="acct-linkedinUrl" label="LinkedIn company page" wide>
            {input("linkedinUrl", { type: "url", placeholder: "https://www.linkedin.com/company/…", maxLength: 300, disabled: synced })}
          </Labeled>
          <Labeled id="acct-description" label="Description" wide>
            <textarea
              id="acct-description"
              rows={3}
              className={cx(ui.input, "w-full resize-y", synced && "bg-sidebar text-ink-muted")}
              value={f.description}
              onChange={set("description")}
              maxLength={5000}
              disabled={synced}
              placeholder="What they do, and what they use you for."
            />
          </Labeled>
        </Group>

        <Group title="Location" note={syncedNote}>
          <Labeled id="acct-city" label="City">{input("city", { maxLength: 100, disabled: synced })}</Labeled>
          <Labeled id="acct-region" label="State or region">{input("region", { maxLength: 100, disabled: synced })}</Labeled>
          <Labeled id="acct-postalCode" label="Postal code">{input("postalCode", { maxLength: 20, disabled: synced })}</Labeled>
          <Labeled id="acct-country" label="Country">{input("country", { maxLength: 100, disabled: synced })}</Labeled>
          <Labeled id="acct-timezone" label="Time zone" wide>
            <select id="acct-timezone" className={cx(ui.select, "w-full", synced && "bg-sidebar text-ink-muted")} value={f.timezone} onChange={set("timezone")} disabled={synced}>
              <option value="">Not set</option>
              {f.timezone && !TIME_ZONES.includes(f.timezone) && <option value={f.timezone}>{f.timezone}</option>}
              {TIME_ZONES.map((z) => (
                <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
              ))}
            </select>
          </Labeled>
        </Group>

        <Group title="Relationship with you">
          <Labeled id="acct-owner" label="Account owner" hint="Managers see the accounts owned by people on their team.">
            <select id="acct-owner" className={cx(ui.select, "w-full")} value={f.ownerUserId} onChange={set("ownerUserId")}>
              <option value="">No owner</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.fullName ?? m.email}</option>
              ))}
            </select>
          </Labeled>
          <Labeled id="acct-renewalDate" label="Renewal date" hint="Kept watches promises due before it.">
            {input("renewalDate", { type: "date" })}
          </Labeled>
          <Labeled id="acct-annualValue" label="Contract value per year">
            {input("annualValue", { inputMode: "decimal", placeholder: "48000" })}
          </Labeled>
          <Labeled id="acct-currency" label="Currency">
            <select id="acct-currency" className={cx(ui.select, "w-full")} value={f.currency} onChange={set("currency")}>
              {f.currency && !CURRENCIES.includes(f.currency) && <option value={f.currency}>{f.currency}</option>}
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Labeled>
        </Group>

        <FormError error={error} />
        <ModalActions>
          <button type="button" className={ui.button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={ui.button.primary} disabled={pending}>
            {pending ? "Saving…" : account ? "Save changes" : "Create account"}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}

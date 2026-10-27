import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AccountDto } from "@kept/shared";
import { useApi } from "../api";
import { useOrg } from "../app/org-context";
import { cx, ui } from "../ui";

/** Narrows a list to one company; the choice lives in the URL (?company=…) so it can be linked to. */
export function CompanyFilter({ value, onChange }: { value: string | null; onChange: (accountId: string | null) => void }) {
  const api = useApi();
  const { orgId } = useOrg();
  const [accounts, setAccounts] = useState<AccountDto[]>([]);

  useEffect(() => {
    api.accounts(orgId).then(
      (a) => setAccounts([...a].sort((x, y) => x.name.localeCompare(y.name))),
      () => {},
    );
  }, [api, orgId]);

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Company</span>
      <Building2 className="pointer-events-none absolute left-2.5 size-3.5 text-ink-muted" aria-hidden />
      <select
        className={cx(ui.select, "min-w-44 pl-8", value && "border-brand/40 text-ink")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">All companies</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Reads and writes ?company= while keeping the page's other parameters. */
export function companyParam(params: URLSearchParams, setParams: (p: URLSearchParams, o: { replace: boolean }) => void) {
  const company = params.get("company");
  const setCompany = (accountId: string | null) => {
    const next = new URLSearchParams(params);
    if (accountId) next.set("company", accountId);
    else next.delete("company");
    setParams(next, { replace: true });
  };
  return [company, setCompany] as const;
}

import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AccountDto } from "@kept/shared";
import { useApi } from "../../api";
import { memberName, teamName, useOrg } from "../../app/org-context";
import { EmptyAction, EmptyState, Loading, Page } from "../../components/Page";
import { ui } from "../../ui";

function formatValue(a: AccountDto) {
  if (a.annualValueCents === null) return "—";
  const amount = Number(a.annualValueCents) / 100;
  return a.currency
    ? amount.toLocaleString(undefined, { style: "currency", currency: a.currency, maximumFractionDigits: 0 })
    : amount.toLocaleString();
}

/** Renewal dates are calendar dates (stored at UTC midnight); format them in UTC so they don't shift a day. */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

function describeScope({ actor, teams }: ReturnType<typeof useOrg>) {
  if (actor.isPlatformAdmin || actor.role === "owner") return "Every customer account in the organization.";
  if (actor.role === "manager" && actor.teamId) {
    return `Accounts owned by people on ${teamName(teams, actor.teamId)}, plus any shared with you.`;
  }
  return "Accounts you own or that were shared with you.";
}

export function AccountsPage() {
  const api = useApi();
  const ctx = useOrg();
  const [accounts, setAccounts] = useState<AccountDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.accounts(ctx.orgId).then(setAccounts, (err: Error) => setError(err.message));
  }, [api, ctx.orgId]);

  return (
    <Page title="Accounts" description={describeScope(ctx)}>
      {error && <p className={ui.errorBlock}>{error}</p>}
      {!accounts && !error && <Loading />}
      {accounts?.length === 0 && (
        <EmptyState icon={Building2} title="No accounts yet" action={<EmptyAction to="../integrations">Connect a source</EmptyAction>}>
          Kept creates accounts from the customers it finds in your connected email and CRM, and assigns each one an
          owner.
        </EmptyState>
      )}
      {accounts && accounts.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Account</th>
                <th className={ui.th}>Owner</th>
                <th className={`${ui.th} text-right`}>Annual value</th>
                <th className={ui.th}>Renewal</th>
                <th className={`${ui.th} text-right`}>Health</th>
              </tr>
            </thead>
            <tbody className={ui.tbody}>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className={ui.td}>
                    <div className="font-medium">{a.name}</div>
                    {a.domain && <div className={ui.hint}>{a.domain}</div>}
                  </td>
                  <td className={ui.td}>{memberName(ctx.members, a.ownerUserId)}</td>
                  <td className={`${ui.td} text-right tabular-nums`}>{formatValue(a)}</td>
                  <td className={`${ui.td} tabular-nums`}>
                    {a.renewalDate ? formatDate(a.renewalDate) : "—"}
                  </td>
                  <td className={`${ui.td} text-right tabular-nums`}>{a.healthScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

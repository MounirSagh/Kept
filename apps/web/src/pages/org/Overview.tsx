import { Check, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { can, type CommitmentDto } from "@kept/shared";
import { useApi } from "../../api";
import { teamName, useOrg } from "../../app/org-context";
import { EmptyState, Page, Section } from "../../components/Page";
import { cx, ui } from "../../ui";
import { addDays, DueDate, today as todayIso } from "./Commitments";
import { useTeamInvitations } from "./MyTeam";

function greeting(date: Date) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function OverviewPage() {
  const { me, org, members, teams, actor } = useOrg();
  const firstName = me.user.fullName?.split(" ")[0] ?? me.user.email.split("@")[0];
  const today = new Date();
  const isManager = actor.role === "manager" && !actor.isPlatformAdmin;
  const isMember = actor.role === "member" && !actor.isPlatformAdmin;
  const scope = isManager ? "your team's accounts" : "your accounts";

  return (
    <Page
      title={`${greeting(today)}, ${firstName}`}
      description={today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
    >
      {can(actor, { action: "org.manage" }) && <SetupChecklist orgId={org.id} memberCount={members.length} teamCount={teams.length} />}
      {isManager && <TeamSummary />}
      {isMember && <MemberTeamLine />}

      <CommitmentsGlance scope={scope} />
    </Page>
  );
}

function Quiet({ children }: { children: string }) {
  return <p className="rounded-lg border border-line px-4 py-5 text-sm text-ink-muted">{children}</p>;
}

function SetupChecklist({ orgId, memberCount, teamCount }: { orgId: string; memberCount: number; teamCount: number }) {
  const api = useApi();
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    api.invitations(orgId).then((list) => setPending(list.length), () => setPending(0));
  }, [api, orgId]);

  const steps = [
    {
      title: "Create a team",
      body: "Group people under a manager. Managers see their team's accounts.",
      to: "../teams?new=1",
      cta: "Create team",
      done: teamCount > 0,
    },
    {
      title: "Invite your team",
      body: "Add the managers and CSMs who own customer relationships.",
      to: "../members?new=1",
      cta: "Invite people",
      done: memberCount > 1 || (pending ?? 0) > 0,
    },
    {
      title: "Connect a source",
      body: "Connect email, chat or your CRM so Kept can start finding commitments.",
      to: "../integrations",
      cta: "See integrations",
      done: false,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  if (pending === null) return null;

  return (
    <Section title="Set up your workspace" aside={`${doneCount} of ${steps.length} done`}>
      <ol className="divide-y divide-line rounded-lg border border-line">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-4 px-4 py-4">
            <span
              className={cx(
                "mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                step.done ? "bg-brand text-on-brand" : "border border-line-strong text-ink-muted",
              )}
            >
              {step.done ? <Check className="size-3.5" strokeWidth={2.5} aria-label="Done" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cx("text-sm font-medium", step.done && "text-ink-muted line-through decoration-line-strong")}>
                {step.title}
              </p>
              {!step.done && <p className="mt-0.5 text-[0.8125rem] text-ink-muted">{step.body}</p>}
            </div>
            {!step.done && (
              <Link
                to={step.to}
                className="shrink-0 rounded-md px-2 py-1 text-[0.8125rem] font-medium text-brand hover:bg-brand-soft"
              >
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** A manager's team at a glance, with a nudge to invite people while the team is empty. */
function TeamSummary() {
  const { actor, members, teams, org } = useOrg();
  const { invitations } = useTeamInvitations();

  if (actor.teamId === null) {
    return (
      <Section title="Your team">
        <EmptyState icon={UsersRound} title="You're not on a team yet">
          Ask an owner of {org.name} to add you to a team. You'll then see your team's accounts and can invite people into it.
        </EmptyState>
      </Section>
    );
  }
  if (invitations === null) return null;

  const people = members.filter((m) => m.teamId === actor.teamId);
  const others = people.length - 1;
  const name = teamName(teams, actor.teamId);

  return (
    <Section title="Your team" aside={<Link to="../team" className="font-medium text-brand hover:underline">View team</Link>}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-line px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{name}</p>
          <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
            {others === 0
              ? "It's just you so far. Invite the CSMs on your team so their accounts show up here."
              : `You and ${others} ${others === 1 ? "other" : "others"}${
                  invitations.length > 0 ? `, ${invitations.length} invitation${invitations.length === 1 ? "" : "s"} pending` : ""
                }.`}
          </p>
        </div>
        <Link to="../team?new=1" className={others === 0 ? ui.button.primary : ui.button.ghost}>
          Invite to {name}
        </Link>
      </div>
    </Section>
  );
}

/** For members: who they work with, kept to one line since there's nothing to manage. */
function MemberTeamLine() {
  const { actor, members, teams } = useOrg();
  if (actor.teamId === null) return null;
  const leaders = members
    .filter((m) => m.teamId === actor.teamId && m.role === "manager")
    .map((m) => m.fullName ?? m.email);

  return (
    <p className="-mt-4 mb-8 text-sm text-ink-muted">
      You're on <span className="font-medium text-ink">{teamName(teams, actor.teamId)}</span>
      {leaders.length > 0 && <>, led by {leaders.join(" and ")}</>}.{" "}
      <Link to="../team" className="font-medium text-brand hover:underline">
        View team
      </Link>
    </p>
  );
}

/** Overdue and upcoming open commitments, the two lists people check first. */
function CommitmentsGlance({ scope }: { scope: string }) {
  const api = useApi();
  const { orgId, members } = useOrg();
  const [open, setOpen] = useState<CommitmentDto[] | null>(null);

  useEffect(() => {
    api.commitments(orgId, { status: "open" }).then(setOpen, () => setOpen([]));
  }, [api, orgId]);

  const now = todayIso();
  const overdue = (open ?? []).filter((c) => c.dueDate && c.dueDate < now);
  const upcoming = (open ?? []).filter((c) => c.dueDate && c.dueDate >= now && c.dueDate <= addDays(now, 7));

  const list = (items: CommitmentDto[]) => (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {items.slice(0, 5).map((c) => (
        <li key={c.id} className="px-4 py-3">
          <p className="truncate text-sm font-medium" title={c.summary}>{c.summary}</p>
          <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
            {c.accountName} · <DueDate commitment={c} />
            {c.ownerUserId && <> · {members.find((m) => m.userId === c.ownerUserId)?.fullName ?? "Owner"}</>}
          </p>
        </li>
      ))}
    </ul>
  );
  const more = (items: CommitmentDto[], status = "") =>
    items.length > 5 ? (
      <Link to={`../commitments${status}`} className="font-medium text-brand hover:underline">
        View all {items.length}
      </Link>
    ) : undefined;

  return (
    <div className="grid gap-x-10 lg:grid-cols-2">
      <Section title="Needs attention" aside={more(overdue)}>
        {open === null ? null : overdue.length > 0 ? (
          list(overdue)
        ) : (
          <Quiet>Nothing overdue. Overdue commitments and, later, flagged risks show up here first.</Quiet>
        )}
      </Section>
      <Section title="Due in the next 7 days" aside={more(upcoming)}>
        {open === null ? null : upcoming.length > 0 ? (
          list(upcoming)
        ) : (
          <Quiet>{`Nothing due. Upcoming commitments across ${scope} are listed here by date.`}</Quiet>
        )}
      </Section>
    </div>
  );
}

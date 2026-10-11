import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ui } from "../ui";

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1040px] px-5 pt-8 pb-16 lg:px-10 lg:pt-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] leading-tight font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 max-w-[65ch] text-sm text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <div className="text-[0.8125rem] text-ink-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Teaches what will appear here and how to get it there. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  /** A link or button for the next step, e.g. <EmptyAction to="…"> or a button that opens a modal. */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong px-6 py-8 sm:flex-row sm:gap-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar text-ink-muted">
        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1 max-w-[60ch] text-sm leading-relaxed text-ink-muted">{children}</div>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyAction({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={ui.button.ghostSm}>
      {children}
    </Link>
  );
}

export function Loading() {
  return (
    <div className="space-y-3 p-10" aria-busy="true" aria-label="Loading">
      <div className="h-5 w-48 animate-pulse rounded bg-hover" />
      <div className="h-4 w-80 animate-pulse rounded bg-hover" />
    </div>
  );
}

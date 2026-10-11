import { UserButton } from "@clerk/react";
import { Check, ChevronsUpDown, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { cx } from "../ui";
import { NAV } from "./nav";
import { OrgProvider, useOrg } from "./org-context";
import { Loading } from "../components/Page";

export function AppShell() {
  return (
    <OrgProvider fallback={<Loading />}>
      <Shell />
    </OrgProvider>
  );
}

function Shell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { org } = useOrg();

  // Close the mobile drawer after navigating.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-line bg-sidebar lg:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/20" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-sidebar shadow-xl" aria-label="Navigation">
            <button
              className="absolute top-3 right-3 rounded-md p-1.5 text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas px-4 py-2.5 lg:hidden">
          <button
            className="rounded-md p-1.5 text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
          >
            <Menu className="size-5" />
          </button>
          <span className="truncate text-sm font-semibold">{org.name}</span>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  const { actor, me } = useOrg();

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <OrgSwitcher />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV.map((group, i) => {
          const items = group.items.filter((item) => !item.visible || item.visible(actor));
          if (items.length === 0) return null;
          return (
            <div key={group.label ?? i} className={i > 0 ? "mt-6" : undefined}>
              {group.label && (
                <p className="mb-1 px-2 text-[0.6875rem] font-medium tracking-wide text-ink-faint uppercase">
                  {group.label}
                </p>
              )}
              <ul className="space-y-px">
                {items.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      className={({ isActive }) =>
                        cx(
                          "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150",
                          isActive ? "bg-selected font-medium text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={cx("size-4 shrink-0", isActive ? "text-accent" : "text-ink-faint group-hover:text-ink-muted")}
                            strokeWidth={isActive ? 2 : 1.75}
                            aria-hidden
                          />
                          {label}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
        <UserButton />
        <div className="min-w-0 text-[0.8125rem] leading-tight">
          <p className="truncate font-medium">{me.user.fullName ?? me.user.email}</p>
          {me.user.fullName && <p className="truncate text-ink-muted">{me.user.email}</p>}
        </div>
      </div>
    </div>
  );
}

function OrgSwitcher() {
  const { me, org } = useOrg();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const multiple = me.orgs.length > 1;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-[0.8125rem] font-semibold text-on-accent">
        {org.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold">{org.name}</span>
        <span className="block text-xs text-ink-muted capitalize">{org.role}</span>
      </span>
    </>
  );

  if (!multiple) return <div className="flex items-center gap-2.5 px-1 py-1">{label}</div>;

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 transition-colors duration-150 hover:bg-hover"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
        <ChevronsUpDown className="size-4 shrink-0 text-ink-faint" aria-hidden />
      </button>
      {open && (
        <ul
          className="absolute inset-x-0 top-full z-50 mt-1 rounded-lg border border-line bg-canvas p-1 shadow-lg"
          role="listbox"
          aria-label="Organizations"
        >
          {me.orgs.map((o) => (
            <li key={o.id} role="option" aria-selected={o.id === org.id}>
              <Link
                to={`/o/${o.slug}/overview`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.id === org.id && <Check className="size-4 text-accent" aria-hidden />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

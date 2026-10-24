import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { PAGE_SIZES, type SortDir } from "@kept/shared";
import { cx, ui } from "../ui";

export interface TableQuery {
  q: string;
  page: number;
  pageSize: number;
  sort: string;
  dir: SortDir;
  /** Filter values by name; "" means not filtered. */
  filters: Record<string, string>;
}

/**
 * Table state kept in the URL (search, filters, sort, page), so refresh, back and shared links
 * show the same rows. Defaults are left out of the URL.
 */
export function useTableQuery(defaults: { sort: string; dir: SortDir; filters: string[] }) {
  const [params, setParams] = useSearchParams();
  const filterNames = defaults.filters.join(",");

  const query: TableQuery = useMemo(() => {
    const size = Number(params.get("size"));
    return {
      q: params.get("q") ?? "",
      page: Math.max(1, Number(params.get("page")) || 1),
      pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : PAGE_SIZES[0],
      sort: params.get("sort") ?? defaults.sort,
      dir: params.get("dir") === "asc" || params.get("dir") === "desc" ? (params.get("dir") as SortDir) : defaults.dir,
      filters: Object.fromEntries(filterNames.split(",").filter(Boolean).map((f) => [f, params.get(f) ?? ""])),
    };
  }, [params, defaults.sort, defaults.dir, filterNames]);

  /** Changes anything but the page sends you back to page 1: the old page may not exist anymore. */
  function update(patch: Partial<Omit<TableQuery, "filters">> & { filters?: Record<string, string> }) {
    const next = { ...query, ...patch, filters: { ...query.filters, ...patch.filters } };
    if (!("page" in patch)) next.page = 1;
    const out = new URLSearchParams();
    if (next.q) out.set("q", next.q);
    if (next.page > 1) out.set("page", String(next.page));
    if (next.pageSize !== PAGE_SIZES[0]) out.set("size", String(next.pageSize));
    if (next.sort !== defaults.sort || next.dir !== defaults.dir) {
      out.set("sort", next.sort);
      out.set("dir", next.dir);
    }
    for (const [k, v] of Object.entries(next.filters)) if (v) out.set(k, v);
    setParams(out, { replace: true });
  }

  /** Clicking the sorted column flips its direction; another column starts ascending. */
  function toggleSort(key: string) {
    update({ sort: key, dir: query.sort === key && query.dir === "asc" ? "desc" : "asc" });
  }

  const filtered = !!query.q || Object.values(query.filters).some(Boolean);
  return { query, update, toggleSort, filtered };
}

/** The query as API parameters: empty values are left out. */
export function toApiQuery(query: TableQuery) {
  return {
    ...(query.q ? { q: query.q } : {}),
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    dir: query.dir,
    ...Object.fromEntries(Object.entries(query.filters).filter(([, v]) => v)),
  };
}

/** A search box that waits for a pause in typing before searching. */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (q: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);

  return (
    <label className="relative block w-full sm:w-64">
      <span className="sr-only">Search</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <input type="search" className={cx(ui.input, "w-full pl-8")} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      {/* Fixed width: a select otherwise grows to its longest option and wraps the toolbar. */}
      <select className={cx(ui.select, "w-40", value ? "border-brand/50 text-ink" : "text-ink-muted")} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label}: any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toolbar({ children, onClear }: { children: ReactNode; onClear?: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {children}
      {onClear && (
        <button type="button" className="px-2 text-sm text-ink-muted hover:text-ink" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
}

/** A column header that sorts the table. */
export function SortTh({
  label,
  sortKey,
  query,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: string;
  query: TableQuery;
  onSort: (key: string) => void;
  align?: "left" | "right";
}) {
  const active = query.sort === sortKey;
  const Arrow = query.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cx(ui.th, align === "right" && "text-right")} aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cx("inline-flex items-center gap-1 rounded hover:text-ink", active && "text-ink", align === "right" && "flex-row-reverse")}
      >
        {label}
        <Arrow className={cx("size-3.5", !active && "invisible")} aria-hidden />
      </button>
    </th>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
      <span className="tabular-nums">
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          Rows
          <select className={ui.selectSm} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className="tabular-nums">
          Page {Math.min(page, pages)} of {pages}
        </span>
        <div className="flex gap-1">
          <button type="button" className={ui.button.ghostSm} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button type="button" className={ui.button.ghostSm} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

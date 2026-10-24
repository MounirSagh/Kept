// Class strings for the few patterns repeated across pages. Colors come from the tokens in index.css.

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium no-underline cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";
const fieldBase =
  "min-w-0 rounded-md border border-line-strong bg-canvas text-ink placeholder:text-ink-faint transition-colors duration-150 hover:border-ink-faint";

export const ui = {
  page: "mx-auto max-w-[1080px] px-4",
  nav: "mx-auto flex max-w-[1080px] items-center justify-between px-4 py-5",

  button: {
    primary: cx(buttonBase, "border-transparent bg-brand px-3.5 py-2 text-sm text-on-brand hover:bg-brand-hover"),
    ghost: cx(buttonBase, "border-line-strong bg-canvas px-3.5 py-2 text-sm text-ink hover:bg-hover"),
    primarySm: cx(buttonBase, "border-transparent bg-brand px-2.5 py-1 text-[0.8125rem] text-on-brand hover:bg-brand-hover"),
    danger: cx(buttonBase, "border-transparent bg-danger px-3.5 py-2 text-sm text-on-brand hover:opacity-90"),
    ghostSm: cx(buttonBase, "border-line-strong bg-canvas px-2.5 py-1 text-[0.8125rem] text-ink hover:bg-hover"),
  },

  input: cx(fieldBase, "px-3 py-2 text-sm"),
  inputSm: cx(fieldBase, "px-2.5 py-1 text-[0.8125rem]"),
  select: cx(fieldBase, "px-2.5 py-2 text-sm"),
  selectSm: cx(fieldBase, "px-2 py-1 text-[0.8125rem]"),
  label: "text-[0.8125rem] font-medium text-ink",

  badge: "inline-flex items-center rounded-full border border-line px-2 py-px text-xs font-medium text-ink-muted capitalize",
  inlineForm: "flex flex-wrap items-center gap-2",
  error: "text-sm text-danger",
  errorBlock: "mb-4 text-sm text-danger",
  muted: "text-ink-muted",
  hint: "text-[0.8125rem] text-ink-muted",

  tableWrap: "overflow-x-auto rounded-lg border border-line",
  table: "w-full border-collapse text-sm",
  th: "border-b border-line bg-sidebar px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-ink-muted",
  tbody: "divide-y divide-line",
  td: "px-4 py-3 align-middle",
  tdActions: "space-x-2 px-4 py-3 align-middle text-right whitespace-nowrap",

  empty: "space-y-1 rounded-lg border border-dashed border-line-strong px-4 py-10 text-center",
  notice: "mb-6 rounded-lg border border-line bg-sidebar p-4",
};

export function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

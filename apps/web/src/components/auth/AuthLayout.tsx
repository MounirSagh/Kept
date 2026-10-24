import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CloudShader } from "@/components/ui/cloud-shader";
import { Wordmark } from "@/components/Wordmark";

/** Sign-in and sign-up: a rounded panel of still sky on the left, the form on the right. Phones get the form only. */
export function AuthLayout({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-canvas p-3 lg:p-4">
      <aside
        aria-hidden
        className="relative isolate hidden w-1/2 flex-col justify-between overflow-hidden rounded-[1.25rem] p-10 lg:flex"
      >
        <CloudShader className="absolute inset-0 -z-10" speed={0} stillTime={18} count={5} />
        <div className="flex items-center gap-4 text-xs font-semibold tracking-[0.25em] text-white uppercase drop-shadow-sm">
          
        </div>
        <div>
          <p className="max-w-md text-6xl leading-[1.02] font-semibold tracking-tight text-white drop-shadow-md xl:text-7xl">
            Every promise, in view
          </p>
          <p className="mt-6 max-w-sm text-[0.9375rem] leading-relaxed text-white/90 drop-shadow-sm">
            Kept rises above your email, chats, tickets and CRM, so the commitments at risk are flagged before
            anyone notices.
          </p>
        </div>
      </aside>

      <main className="flex flex-1 flex-col items-center px-6 py-8 sm:px-10">
        <Link to="/" aria-label="Kept home">
            <Wordmark className="text-3xl text-ink" markClassName="text-brand" />
          </Link>

        <div className="flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-center text-4xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-3 text-center text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-10">{children}</div>
        </div>

        {footer && <p className="text-sm text-ink-muted">{footer}</p>}
      </main>
    </div>
  );
}

const fieldClass =
  "w-full min-w-0 rounded-lg border border-transparent bg-hover px-4 py-3 text-sm text-ink transition-colors duration-150 placeholder:text-ink-faint hover:border-line-strong focus:border-brand focus:bg-canvas aria-invalid:border-danger";

/** A labelled input with its field error underneath. */
export function AuthField({
  id,
  label,
  error,
  aside,
  trailing,
  ...input
}: {
  id: string;
  label: string;
  error?: string | null;
  aside?: ReactNode;
  trailing?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={trailing ? `${fieldClass} pr-11` : fieldClass}
          {...input}
        />
        {trailing && <div className="absolute inset-y-0 right-0 flex items-center pr-2">{trailing}</div>}
      </div>
      {error && <p id={`${id}-error`} className="text-[0.8125rem] text-danger">{error}</p>}
    </div>
  );
}

/** A password input with a show/hide toggle. */
export function PasswordField(props: Omit<Parameters<typeof AuthField>[0], "type" | "trailing">) {
  const [visible, setVisible] = useState(false);
  return (
    <AuthField
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-selected hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="M3 3l18 18" />}
          </svg>
        </button>
      }
    />
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      {children}
    </p>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function TextButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="text-sm font-medium text-ink-muted hover:text-ink disabled:opacity-60" {...props}>
      {children}
    </button>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-ink-faint">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

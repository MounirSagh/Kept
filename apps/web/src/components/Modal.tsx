import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ui } from "../ui";

/**
 * A modal built on <dialog>: the browser handles focus trapping, Esc and the backdrop.
 * Mount it to open it and unmount it to close it, so its form state starts fresh every time.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** For content that needs room, like an import preview table. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the dialog element itself (not its content) is a click on the backdrop.
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl border border-line bg-canvas p-0 text-ink shadow-2xl backdrop:bg-ink/25`}
    >
      <div className="p-6">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  );
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap justify-end gap-2">{children}</div>;
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={ui.label}>
        {label}
      </label>
      {children}
      {hint && <p className={ui.hint}>{hint}</p>}
    </div>
  );
}

/** Runs an async submit with pending and error state shared by every form modal. */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return { pending, error, submit };
}

export function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className={`${ui.error} mt-4`} role="alert">
      {error}
    </p>
  ) : null;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  tone = "default",
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { pending, error, submit } = useSubmit();

  return (
    <Modal title={title} description={children} onClose={onClose}>
      <FormError error={error} />
      <ModalActions>
        <button type="button" className={ui.button.ghost} onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className={tone === "danger" ? ui.button.danger : ui.button.primary}
          disabled={pending}
          onClick={() =>
            void submit(async () => {
              await onConfirm();
              onClose();
            })
          }
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </ModalActions>
    </Modal>
  );
}

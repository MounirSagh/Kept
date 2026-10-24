import { FileUp } from "lucide-react";
import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import { parseCsv, type CsvTable, type ImportError, type ImportResultDto } from "@kept/shared";
import { ui } from "../ui";
import { FormError, Modal, ModalActions, useSubmit } from "./Modal";

interface Column<R> {
  label: string;
  render(row: R): ReactNode;
}

/**
 * Pick a CSV, preview what will be imported (with per-row problems), import, see the result.
 * Parsing happens here so nothing is sent until the preview looks right.
 */
export function ImportDialog<R extends { row: number }>({
  title,
  description,
  template,
  templateName,
  convert,
  columns,
  onImport,
  onClose,
}: {
  title: string;
  description: ReactNode;
  /** CSV text offered as a downloadable example. */
  template: string;
  templateName: string;
  convert(table: CsvTable): { rows: R[]; errors: ImportError[] };
  columns: Column<R>[];
  onImport(rows: R[]): Promise<ImportResultDto>;
  onClose(): void;
}) {
  const inputId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ rows: R[]; errors: ImportError[] } | null>(null);
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const { pending, error, submit } = useSubmit();
  const templateUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(template)}`;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setParsed(convert(parseCsv(await file.text())));
  }

  if (result) {
    return (
      <Modal title="Import finished" onClose={onClose} wide>
        <p className="text-sm">
          <span className="font-medium">{result.created}</span> created
          {result.updated > 0 && <>, <span className="font-medium">{result.updated}</span> updated</>}
          {!!result.unchanged && <>, <span className="font-medium">{result.unchanged}</span> already existed</>}
          {result.errors.length > 0 && <>, <span className="font-medium text-warn">{result.errors.length}</span> skipped</>}.
        </p>
        {result.errors.length > 0 && <ErrorList errors={result.errors} />}
        <ModalActions>
          <button type="button" className={ui.button.primary} onClick={onClose}>
            Done
          </button>
        </ModalActions>
      </Modal>
    );
  }

  const rows = parsed?.rows ?? [];
  return (
    <Modal title={title} description={description} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className={`${ui.button.ghost} cursor-pointer`}>
          <FileUp className="size-4" aria-hidden />
          {fileName ? "Choose another file" : "Choose CSV file"}
        </label>
        <input id={inputId} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e)} />
        {fileName && <span className="truncate text-sm text-ink-muted">{fileName}</span>}
        <a href={templateUrl} download={templateName} className="ml-auto text-[0.8125rem] font-medium text-brand hover:underline">
          Download a template
        </a>
      </div>

      {parsed && (
        <div className="mt-5">
          <p className="text-sm">
            <span className="font-medium">{rows.length}</span> {rows.length === 1 ? "row" : "rows"} ready
            {parsed.errors.length > 0 && (
              <>
                , <span className="font-medium text-warn">{parsed.errors.length}</span> with problems (they'll be skipped)
              </>
            )}
            .
          </p>
          {rows.length > 0 && (
            <div className={`${ui.tableWrap} mt-3 max-h-64 overflow-y-auto`}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th className={ui.th}>Row</th>
                    {columns.map((c) => (
                      <th key={c.label} className={ui.th}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={ui.tbody}>
                  {rows.slice(0, 50).map((r) => (
                    <tr key={r.row}>
                      <td className={`${ui.td} tabular-nums text-ink-muted`}>{r.row}</td>
                      {columns.map((c) => (
                        <td key={c.label} className={ui.td}>{c.render(r) ?? <span className="text-ink-faint">—</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 50 && <p className={`${ui.hint} mt-2`}>Showing the first 50 rows.</p>}
          {parsed.errors.length > 0 && <ErrorList errors={parsed.errors} />}
        </div>
      )}

      <FormError error={error} />
      <ModalActions>
        <button type="button" className={ui.button.ghost} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={ui.button.primary}
          disabled={pending || rows.length === 0}
          onClick={() => void submit(async () => setResult(await onImport(rows)))}
        >
          {pending ? "Importing…" : `Import ${rows.length} ${rows.length === 1 ? "row" : "rows"}`}
        </button>
      </ModalActions>
    </Modal>
  );
}

function ErrorList({ errors }: { errors: ImportError[] }) {
  return (
    <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-warn-soft px-4 py-3 text-[0.8125rem]">
      {errors.slice(0, 100).map((e) => (
        <li key={`${e.row}-${e.message}`}>
          <span className="font-medium tabular-nums">Row {e.row}:</span> {e.message}
        </li>
      ))}
      {errors.length > 100 && <li className="text-ink-muted">…and {errors.length - 100} more</li>}
    </ul>
  );
}

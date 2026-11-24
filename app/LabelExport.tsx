import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { countries, formats, splits, type DocumentFacts } from "../engine/model/groundTruth";

interface LabelExportProps {
  /** The facts given last time, so labelling a run of documents from one source is quick. */
  readonly last: DocumentFacts | undefined;
  readonly onExport: (facts: DocumentFacts) => void;
  readonly onClose: () => void;
}

const field = "h-8 w-full rounded border border-field bg-white px-2";

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

/** Asks for the document facts the ground-truth file needs, then exports it. */
export function LabelExport({ last, onExport, onClose }: LabelExportProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState(last?.source ?? "");
  const [licence, setLicence] = useState(last?.licence ?? "");
  const [country, setCountry] = useState<string>(last?.country ?? "");
  const [format, setFormat] = useState<string>(last?.format ?? "");
  const [split, setSplit] = useState<string>(last?.split ?? "");

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function onSubmit(event: FormEvent) {
    // Never submitted for real: the page's policy allows no form actions.
    event.preventDefault();
    const chosenCountry = countries.find((option) => option === country);
    const chosenFormat = formats.find((option) => option.id === format)?.id;
    const chosenSplit = splits.find((option) => option.id === split)?.id;
    if (chosenCountry === undefined || chosenFormat === undefined || chosenSplit === undefined) return;
    onExport({ source: source.trim(), licence: licence.trim(), country: chosenCountry, format: chosenFormat, split: chosenSplit });
    // Closing the dialog, rather than only unmounting it, returns focus to the button that opened it.
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="label-export-title"
      onClose={onClose}
      className="m-auto w-96 rounded-lg border border-rule bg-paper-raised p-5 text-ink shadow-[0_8px_32px_rgb(31_27_22/0.24)] backdrop:bg-ink/30"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <h2 id="label-export-title" className="font-display font-semibold text-lg">
          Export labels
        </h2>
        <p className="text-ink-muted">Saves this document's marks as a ground-truth file.</p>
        <Field label="Source">
          <input required pattern=".*\S.*" value={source} onChange={(event) => setSource(event.target.value)} className={field} />
        </Field>
        <Field label="Licence">
          <input required pattern=".*\S.*" value={licence} onChange={(event) => setLicence(event.target.value)} className={field} />
        </Field>
        <Field label="Country">
          <select required value={country} onChange={(event) => setCountry(event.target.value)} className={field}>
            <option value="">Choose…</option>
            {countries.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </Field>
        <Field label="Format">
          <select required value={format} onChange={(event) => setFormat(event.target.value)} className={field}>
            <option value="">Choose…</option>
            {formats.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Split">
          <select required value={split} onChange={(event) => setSplit(event.target.value)} className={field}>
            <option value="">Choose…</option>
            {splits.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk">
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-ink px-3.5 py-1.5 text-paper hover:bg-ink/85">
            Download labels
          </button>
        </div>
      </form>
    </dialog>
  );
}

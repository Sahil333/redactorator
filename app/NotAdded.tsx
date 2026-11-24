import { useId } from "react";
import type { Refusal } from "../engine/api/errors";
import { errorText } from "./errors";

interface NotAddedProps {
  readonly refused: readonly Refusal[];
  readonly onDismiss: () => void;
}

/** DOC-4: the files the user chose that were not added, each with the reason. */
export function NotAdded({ refused, onDismiss }: NotAddedProps) {
  const headingId = useId();
  if (refused.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="m-4 mb-0 flex flex-col gap-1.5 rounded-md border border-mark/40 bg-fail-wash px-4 py-3 text-ink"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="font-semibold text-mark">
          {refused.length === 1 ? "1 file not added" : `${refused.length} files not added`}
        </h2>
        <button type="button" onClick={onDismiss} className="min-h-6 rounded px-2 text-ink-muted hover:bg-paper-raised hover:text-ink">
          Dismiss
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {refused.map(({ file, error }, index) => (
          <li key={index}>
            <span className="font-medium">{file}</span>: {errorText(error)}
          </li>
        ))}
      </ul>
    </section>
  );
}

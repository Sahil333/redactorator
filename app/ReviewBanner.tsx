import { useState } from "react";
import { firstPage, type Mark } from "./marks";

interface ReviewBannerProps {
  /** The open document's new marks, in page order. */
  readonly marks: readonly Mark[];
  /** The documents whose approval brought them. */
  readonly from: readonly string[];
  readonly onShow: (mark: Mark) => void;
}

function fromText(from: readonly string[]): string {
  if (from.length === 0) return "";
  if (from.length > 2) return ` from ${from.length} other documents`;
  return ` from ${from.join(" and ")}`;
}

/** The marks other documents' approval brought here, to step through before approving this one. */
export function ReviewBanner({ marks, from, onShow }: ReviewBannerProps) {
  const [at, setAt] = useState<number | undefined>(undefined);
  const count = marks.length;
  if (count === 0) return undefined;
  const step = (by: number) => {
    const next = at === undefined ? (by > 0 ? 0 : count - 1) : (at + by + count) % count;
    const mark = marks[next];
    if (mark === undefined) return;
    setAt(next);
    onShow(mark);
  };
  const shown = at === undefined ? undefined : marks[Math.min(at, count - 1)];
  return (
    <div role="region" aria-label="New marks" className="sticky top-0 z-20 m-4 mb-0 flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent-wash px-4 py-2.5">
      <p className="flex-1">
        <strong className="font-semibold">{count === 1 ? "1 new mark" : `${count} new marks`}</strong>
        {fromText(from)}. Check each one, then approve this document.
      </p>
      <p aria-live="polite" className="text-ink-muted">
        {shown && `${marks.indexOf(shown) + 1} of ${count}, page ${firstPage(shown.target) + 1}`}
      </p>
      <button type="button" onClick={() => step(-1)} className="rounded-md border border-rule bg-paper-raised px-3 py-1.5 hover:bg-paper-sunk">
        Previous
      </button>
      <button type="button" onClick={() => step(1)} className="rounded-md border border-rule bg-paper-raised px-3 py-1.5 hover:bg-paper-sunk">
        Next
      </button>
    </div>
  );
}

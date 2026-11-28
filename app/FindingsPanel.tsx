import { useEffect, useRef, useState } from "react";
import { CloseFindingsDialog } from "./CloseFindingsDialog";
import { ConfirmFindingsDialog, confirmLabel } from "./ConfirmFindingsDialog";
import { FindingRow } from "./FindingRow";
import { plural } from "./marks";
import { NotSearched } from "./RunNotices";
import type { OpenReview } from "./useFindings";

interface FindingsPanelProps {
  readonly id: string;
  readonly width: number;
  readonly review: OpenReview;
}

/**
 * A document's open findings review, in the marks panel's place: every found value, strongest
 * evidence first, to tick or untick, then confirm or close, each after a dialog.
 */
export function FindingsPanel({ id, width, review }: FindingsPanelProps) {
  const { findings } = review;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [asking, setAsking] = useState<"confirm" | "close" | undefined>(undefined);
  const ticked = findings.filter((finding) => finding.ticked).length;

  useEffect(() => {
    // The run's Stop button is gone: focus that had nowhere to go comes here, and no other is taken.
    if (document.activeElement === document.body) headingRef.current?.focus();
  }, []);

  return (
    <aside id={id} aria-label="Found values" className="flex min-h-0 shrink-0 flex-col bg-paper-raised" style={{ width }}>
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <h2 ref={headingRef} tabIndex={-1} className="font-display font-semibold text-lg">
          Found values
        </h2>
        <span className="text-xs text-ink-muted">{plural(findings.length, "value")}</span>
      </div>
      <p className="mx-4 mb-2 text-ink-muted">Found values are removed only once you confirm.</p>
      <NotSearched run={review} />
      <ul className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
        {findings.map((finding) => (
          <FindingRow key={finding.key} finding={finding} onTicked={(on) => review.setTicked(finding.key, on)} />
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-4 py-3">
        <button
          type="button"
          disabled={!review.canClose}
          onClick={() => setAsking("close")}
          className="rounded-md border border-rule px-3 py-1.5 enabled:hover:bg-paper-sunk disabled:opacity-40"
        >
          Close
        </button>
        <button
          type="button"
          disabled={!review.canConfirm}
          onClick={() => setAsking("confirm")}
          className="rounded-md bg-ink px-3.5 py-1.5 text-paper enabled:hover:bg-ink/85 disabled:opacity-40"
        >
          {confirmLabel(ticked, findings.length)}
        </button>
      </div>
      {asking === "confirm" && (
        <ConfirmFindingsDialog
          ticked={ticked}
          all={findings.length}
          onConfirm={() => {
            setAsking(undefined);
            review.confirm();
          }}
          onCancel={() => setAsking(undefined)}
        />
      )}
      {asking === "close" && (
        <CloseFindingsDialog
          values={findings.length}
          onClose={() => {
            setAsking(undefined);
            review.close();
          }}
          onCancel={() => setAsking(undefined)}
        />
      )}
    </aside>
  );
}

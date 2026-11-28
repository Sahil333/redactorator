import type { DroppedNotice } from "./useFindings";

const sentences: Readonly<Record<DroppedNotice["reason"], string>> = {
  "reader-changed":
    "The found values of this document were dropped, because an update changed how the app reads PDFs. Your unticks and edits were not kept. Run Auto mode to find them again.",
  "text-changed": "The found values of this document were dropped, because its text changed. Run Auto mode to find them again.",
};

/** Why the document's findings review was dropped, over its pages, with Run to find the values again and Dismiss; nothing while it has no such notice. */
export function FindingsDroppedNotice({ notice }: { readonly notice: DroppedNotice | undefined }) {
  if (notice === undefined) return undefined;
  return (
    <div role="region" aria-label="Found values dropped" className="m-4 mb-0 flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent-wash px-4 py-2.5">
      <p className="flex-1">{sentences[notice.reason]}</p>
      <button
        type="button"
        disabled={!notice.canRun}
        onClick={notice.onRun}
        className="rounded-md border border-rule bg-paper-raised px-3 py-1.5 enabled:hover:bg-paper-sunk disabled:opacity-40"
      >
        Run Auto mode
      </button>
      <button
        type="button"
        disabled={!notice.canDismiss}
        onClick={notice.onDismiss}
        className="rounded-md border border-rule bg-paper-raised px-3 py-1.5 enabled:hover:bg-paper-sunk disabled:opacity-40"
      >
        Dismiss
      </button>
    </div>
  );
}

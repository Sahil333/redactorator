import { useEffect, useId, useRef } from "react";
import type { Session } from "../engine/api/facade";
import type { ApprovalPlan } from "../engine/api/state";
import { removalKinds, type RemovalKind } from "../engine/model/document";
import type { DocumentId, ProjectDocument } from "../engine/model/project";

/** One line per kind of content preparing a document removes, as the design's Appendix A.3 words it. */
const removalLines: Record<RemovalKind, string> = {
  metadata: "Document information and metadata: removed",
  "image-metadata": "Image camera data: removed",
  annotations: "Comments and annotations: visible ones made part of the page, the rest removed",
  "form-data": "Form data: made part of the page",
  signatures: "Digital signature: removed; the cleaned file is not signed",
  "pending-redactions": "Unapplied redaction marks from another app: removed (their text is not redacted unless you mark it)",
  attachments: "Attachments: removed",
  "scripts-actions": "Scripts and actions: removed",
  links: "Links: removed",
  bookmarks: "Bookmarks: removed",
  "page-labels": "Page labels and article threads: removed",
  "accessibility-tags": "Accessibility tags: removed",
  "marked-content": "Hidden alternative text: removed",
  "hidden-layers": "Hidden layer content: removed",
  "outside-page": "Content outside the page: removed",
  "unshown-image-pixels": "Hidden parts of images: blanked",
  thumbnails: "Page thumbnails: removed",
  "app-data": "Private application data: removed",
  "old-revisions": "Earlier versions of the file: removed",
};

const places = (count: number) => (count === 1 ? "1 place" : `${count} places`);

/** "a.pdf", "a.pdf and b.pdf", or "a.pdf, b.pdf and c.pdf". */
function names(files: readonly string[]): string {
  const last = files.at(-1) ?? "";
  return files.length < 2 ? last : `${files.slice(0, -1).join(", ")} and ${last}`;
}

/** What approving will do beyond this document, said in a sentence or two. */
function consequences(approval: ApprovalPlan, documents: readonly ProjectDocument[]): string[] {
  const files = new Map(documents.map((document) => [document.id, document.file]));
  const file = (id: DocumentId) => files.get(id) ?? "";
  const total = (field: "hidden" | "shown" | "retyped") => approval.changes.reduce((sum, change) => sum + change[field], 0);
  const others = approval.changes.map((change) => file(change.document));
  const lines: string[] = [];
  if (others.length > 0) {
    const what = [
      total("hidden") > 0 && `hides ${places(total("hidden"))}`,
      total("shown") > 0 && `stops hiding ${places(total("shown"))}`,
      total("retyped") > 0 && `changes the type of ${places(total("retyped"))}`,
    ].filter((part) => part !== false);
    lines.push(
      `It ${names(what)} in ${names(others)}. ${others.length === 1 ? "That document goes" : "Those documents go"} back to In review, with the changes shown as new.`,
    );
  }
  if (approval.here.hidden > 0) lines.push(`It also hides ${places(approval.here.hidden)} more in this document, where the same values or images appear.`);
  return lines;
}

interface ApproveDialogProps {
  readonly session: Session;
  /** The approval waiting for its heads-up, from the state. */
  readonly approval: ApprovalPlan;
  readonly documents: readonly ProjectDocument[];
}

/**
 * The heads-up before an approval, while one waits: where it spreads to, and what preparing the
 * document removed that no earlier approval of it listed. Approving can't be undone.
 */
export function ApproveDialog({ approval, ...props }: Omit<ApproveDialogProps, "approval"> & { readonly approval: ApprovalPlan | undefined }) {
  return approval && <HeadsUp approval={approval} {...props} />;
}

/** The kinds of content preparing the document removed, in the design's order, one line each. */
function Removed({ removed }: { readonly removed: readonly RemovalKind[] }) {
  const headingId = useId();
  const listed = new Set(removed);
  return (
    removed.length > 0 && (
      <section aria-labelledby={headingId} className="flex flex-col gap-1">
        <h3 id={headingId} className="font-semibold">
          Removed from this file
        </h3>
        <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
          {removalKinds
            .filter((kind) => listed.has(kind))
            .map((kind) => (
              <li key={kind}>{removalLines[kind]}</li>
            ))}
        </ul>
      </section>
    )
  );
}

function HeadsUp({ session, approval, documents }: ApproveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const name = documents.find((document) => document.id === approval.document)?.file ?? "";
  const onApprove = () => void session.approval.confirm(approval.planId);
  const onCancel = () => session.approval.cancel(approval.planId);
  useEffect(() => {
    dialogRef.current?.showModal();
    // Opening a modal dialog focuses its first control, Cancel; approving is what the user came to do.
    approveRef.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={onCancel}
      className="m-auto w-[28rem] rounded-lg border border-rule bg-paper-raised p-5 text-ink shadow-[0_8px_32px_rgb(31_27_22/0.24)] backdrop:bg-ink/30"
    >
      <div className="flex flex-col gap-3">
        <h2 id={titleId} className="font-display font-semibold text-lg wrap-anywhere">
          Approve “{name}”?
        </h2>
        {consequences(approval, documents).map((line) => (
          <p key={line} className="wrap-anywhere">
            {line}
          </p>
        ))}
        <Removed removed={approval.removed} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk">
            Cancel
          </button>
          <button ref={approveRef} type="button" onClick={onApprove} className="rounded-md bg-ink px-3.5 py-1.5 text-paper hover:bg-ink/85">
            Approve
          </button>
        </div>
      </div>
    </dialog>
  );
}

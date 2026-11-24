import { useEffect, useId, useRef } from "react";
import type { DocumentId, ProjectDocument } from "../engine/model/project";
import type { PendingApproval } from "./useApproval";

const places = (count: number) => (count === 1 ? "1 place" : `${count} places`);

/** "a.pdf", "a.pdf and b.pdf", or "a.pdf, b.pdf and c.pdf". */
function names(files: readonly string[]): string {
  const last = files.at(-1) ?? "";
  return files.length < 2 ? last : `${files.slice(0, -1).join(", ")} and ${last}`;
}

/** What approving will do beyond this document, said in a sentence or two. */
function consequences(approval: PendingApproval, documents: readonly ProjectDocument[]): string[] {
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
  readonly approval: PendingApproval;
  readonly documents: readonly ProjectDocument[];
  readonly onApprove: () => void;
  readonly onCancel: () => void;
}

/** The heads-up before an approval spreads to other documents, while one waits. Approving can't be undone. */
export function ApproveDialog({ approval, ...props }: Omit<ApproveDialogProps, "approval"> & { readonly approval: PendingApproval | undefined }) {
  return approval && <HeadsUp approval={approval} {...props} />;
}

function HeadsUp({ approval, documents, onApprove, onCancel }: ApproveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const name = documents.find((document) => document.id === approval.document)?.file ?? "";
  useEffect(() => {
    dialogRef.current?.showModal();
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
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk">
            Cancel
          </button>
          <button type="button" autoFocus onClick={onApprove} className="rounded-md bg-ink px-3.5 py-1.5 text-paper hover:bg-ink/85">
            Approve
          </button>
        </div>
      </div>
    </dialog>
  );
}

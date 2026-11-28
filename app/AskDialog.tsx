import { useEffect, useId, useRef, type ReactNode } from "react";

interface AskDialogProps {
  /** The question, as the dialog's title. */
  readonly title: string;
  readonly children?: ReactNode;
  /** The label of the button that agrees. */
  readonly action: string;
  readonly onAgree: () => void;
  readonly onCancel: () => void;
}

/** A modal dialog in the centre of the view that asks one question, with Cancel first and focused. */
export function AskDialog({ title, children, action, onAgree, onCancel }: AskDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
          {title}
        </h2>
        {children}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk">
            Cancel
          </button>
          <button type="button" onClick={onAgree} className="rounded-md bg-ink px-3.5 py-1.5 text-paper hover:bg-ink/85">
            {action}
          </button>
        </div>
      </div>
    </dialog>
  );
}

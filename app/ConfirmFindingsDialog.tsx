import { AskDialog } from "./AskDialog";
import { plural } from "./marks";

/** "Mark 3 values for removal", or with nothing ticked "Keep all 3 values in the file": the confirm button's label, and its dialog's question. */
export function confirmLabel(ticked: number, all: number): string {
  return ticked === 0 ? `Keep all ${plural(all, "value")} in the file` : `Mark ${plural(ticked, "value")} for removal`;
}

interface ConfirmFindingsDialogProps {
  readonly ticked: number;
  readonly all: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Asks before a findings review's ticked values are marked and its unticked ones rejected. */
export function ConfirmFindingsDialog({ ticked, all, onConfirm, onCancel }: ConfirmFindingsDialogProps) {
  const unticked = all - ticked;
  return (
    <AskDialog title={`${confirmLabel(ticked, all)}?`} action="Confirm" onAgree={onConfirm} onCancel={onCancel}>
      {unticked > 0 && (
        <p>
          {plural(unticked, "unticked value")} {unticked === 1 ? "stays" : "stay"} in the file and will not be offered again in this document.
        </p>
      )}
    </AskDialog>
  );
}

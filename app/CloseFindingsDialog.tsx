import { AskDialog } from "./AskDialog";
import { plural } from "./marks";

interface CloseFindingsDialogProps {
  /** How many found values the findings review offers. */
  readonly values: number;
  readonly onClose: () => void;
  readonly onCancel: () => void;
}

/** Asks before a findings review is closed without marking or rejecting anything. */
export function CloseFindingsDialog({ values, onClose, onCancel }: CloseFindingsDialogProps) {
  return (
    <AskDialog title="Close without marking?" action="Close" onAgree={onClose} onCancel={onCancel}>
      <p>
        {plural(values, "found value")} {values === 1 ? "stays" : "stay"} in the file. Your unticks and edits will not be kept.
      </p>
    </AskDialog>
  );
}

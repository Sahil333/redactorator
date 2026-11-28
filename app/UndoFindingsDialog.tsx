import { AskDialog } from "./AskDialog";
import { plural } from "./marks";

interface UndoFindingsDialogProps {
  /** How many values the confirmed findings review marked, and in how many marks. */
  readonly values: number;
  readonly marks: number;
  readonly onUndo: () => void;
  readonly onCancel: () => void;
}

/** Asks before one undo removes every mark a confirmed findings review made. */
export function UndoFindingsDialog({ values, marks, onUndo, onCancel }: UndoFindingsDialogProps) {
  return <AskDialog title={`Remove the ${plural(marks, "mark")} Auto mode made for ${plural(values, "value")}?`} action="Remove marks" onAgree={onUndo} onCancel={onCancel} />;
}

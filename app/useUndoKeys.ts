import { useEffect, useEffectEvent } from "react";
import type { History } from "./TopBar";

const isTextField = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** Ctrl or Cmd with Z undoes; with Shift and Z, or with Y, it redoes. A text field keeps its own undo. */
export function useUndoKeys(history: History | undefined) {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (!(event.ctrlKey || event.metaKey) || (key !== "z" && key !== "y") || isTextField(event.target) || history === undefined) return;
    event.preventDefault();
    const redo = key === "y" || event.shiftKey;
    if (redo && history.canRedo) history.onRedo();
    if (!redo && history.canUndo) history.onUndo();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, []);
}

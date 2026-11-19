import { useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { pointBox, type Box, type PageModel } from "../engine/contract";
import { boxStep, newBox } from "./keyboardMarking";
import { MIN_BOX_POINTS, type MarkTarget, type Tool } from "./marks";
import { CSS_PIXELS_PER_POINT } from "./useEngine";
import type { TextSelecting } from "./useTextSelection";

/** The part of `frame` on screen, in points. */
function inView(frame: HTMLElement | null): Box | undefined {
  const bounds = frame?.getBoundingClientRect();
  if (bounds === undefined) return undefined;
  const x0 = Math.max(0, -bounds.left);
  const y0 = Math.max(0, -bounds.top);
  const x1 = Math.max(x0, Math.min(bounds.width, window.innerWidth - bounds.left));
  const y1 = Math.max(y0, Math.min(bounds.height, window.innerHeight - bounds.top));
  const k = CSS_PIXELS_PER_POINT;
  return pointBox(x0 / k, y0 / k, x1 / k, y1 / k);
}

interface KeyboardMarkingOptions {
  readonly page: PageModel;
  /** Undefined while the page takes no marks. */
  readonly tool: Tool | undefined;
  /** The page on screen, to start a selection or a box where the user can see it. */
  readonly frameRef: RefObject<HTMLElement | null>;
  readonly onMark: (target: MarkTarget) => void;
  /** The page's part in the document's text selection, which takes the keys while Select text is in use. */
  readonly text: TextSelecting;
}

/** The keyboard on one page: text keys go to the document's selection; a box is moved and sized here. */
export function useKeyboardMarking({ page, tool, frameRef, onMark, text }: KeyboardMarkingOptions) {
  const [draft, setDraft] = useState<Box | undefined>(undefined);
  const [keyboard, setKeyboard] = useState(false);

  function onBoxKey(event: KeyboardEvent): boolean {
    if (event.key === "Enter") {
      if (draft === undefined) {
        const view = inView(frameRef.current);
        setDraft(view && newBox(page, view));
      } else {
        onMark({ kind: "box", page: page.index, box: draft });
        setDraft(undefined);
      }
      return true;
    }
    if (draft !== undefined && event.key.startsWith("Arrow")) {
      setDraft(boxStep(page, draft, event.key, event.shiftKey, MIN_BOX_POINTS) ?? draft);
      return true;
    }
    if (draft !== undefined && event.key === "Escape") {
      setDraft(undefined);
      return true;
    }
    return false;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (tool === undefined) return;
    const handled = tool === "text" ? text.onKey(event, inView(frameRef.current)) : onBoxKey(event);
    if (handled) {
      event.preventDefault();
      setKeyboard(true);
    }
  }

  const shown = keyboard && tool === "box" && draft !== undefined;
  const at = (value: number) => Math.round(value);
  return {
    draft: shown ? [draft] : [],
    /** What a screen reader hears: the box's place, or the selected text. */
    announcement: shown
      ? `Box at ${at(draft.x0)}, ${at(draft.y0)}, ${at(draft.x1 - draft.x0)} by ${at(draft.y1 - draft.y0)} points`
      : text.announcement,
    /** Where the keyboard is working, to keep in view. */
    focusBox: shown ? draft : keyboard ? text.focusBox : undefined,
    handlers: {
      onKeyDown,
      onFocus: (event: FocusEvent) => setKeyboard(event.currentTarget.matches(":focus-visible")),
      onBlur: () => setKeyboard(false),
    },
  };
}

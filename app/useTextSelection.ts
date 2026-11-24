import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { PageModel } from "../engine/model/document";
import type { Box, PageIndex } from "../engine/model/geometry";
import { charAt } from "../engine/model/pageText";
import { boxesOn } from "../engine/model/marks";
import type { Pending, Tool } from "./marks";
import {
  extend,
  firstWordIn,
  missingPages,
  nextWord,
  selectionTarget,
  sorted,
  wordAround,
  wordOnNextLine,
  type Position,
  type Selection,
  type Texts,
} from "./selection";
import { pageFrameId, pointOnPage } from "./pageGeometry";

const frameOf = (page: PageIndex) => document.getElementById(pageFrameId(page));

// Option, or Ctrl where there is no Option key, makes Shift with an arrow move by a word.
const byWord = (event: KeyboardEvent) => event.altKey || event.ctrlKey;

// While a drag is this close to the top or bottom of the pages pane, the pane scrolls on.
const SCROLL_EDGE = 40;
const SCROLL_STEP = 12;

/** A drag from character `anchor`, made of whole characters, as a selection between caret places. */
function dragged(anchor: Position, focus: Position): Selection {
  const after = (place: Position) => ({ page: place.page, offset: place.offset + 1 });
  return anchor.page < focus.page || (anchor.page === focus.page && anchor.offset <= focus.offset)
    ? { anchor, focus: after(focus) }
    : { anchor: after(anchor), focus };
}

interface TextSelectionOptions {
  readonly pages: readonly PageModel[];
  /** The tool in use: a selection made with Select text goes when the tool changes. */
  readonly tool: Tool | undefined;
  readonly texts: Texts;
  /** A finished selection, to give a type. */
  readonly onMark: (pending: Pending) => void;
  /** A page the selection reached before its text arrived. */
  readonly onNeedText: (page: PageIndex) => void;
}

/** What one page needs to show and take part in the document's text selection. */
export interface TextSelecting {
  readonly boxes: readonly Box[];
  /** On the page that holds the selection's moving end: where that end is, to keep in view. */
  readonly focusBox: Box | undefined;
  readonly announcement: string;
  readonly onPointerDown: (event: PointerEvent) => void;
  /** True while a drag is under way, so the page leaves the pointer to it. */
  readonly onPointerMove: (event: PointerEvent) => boolean;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
  readonly onDoubleClick: (event: MouseEvent) => void;
  /** `view` is the part of the page on screen, in points, where a first selection starts. */
  readonly onKey: (event: KeyboardEvent, view: Box | undefined) => boolean;
}

/**
 * One text selection for the whole document, so it can run from one page onto the next:
 * dragged with the mouse, the pane scrolling near its edges, or moved with the keyboard.
 */
export function useTextSelection({ pages, tool, texts, onMark, onNeedText }: TextSelectionOptions) {
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const [selectedWith, setSelectedWith] = useState(tool);
  if (tool !== selectedWith) {
    setSelectedWith(tool);
    setSelection(undefined);
  }
  const [dragging, setDragging] = useState(false);
  // A finished drag over pages whose text is still on its way: it is marked once the text is here.
  const [waiting, setWaiting] = useState(false);
  // The drag's ends live here, not in `selection`: a pointer-up can come before the last move renders.
  const drag = useRef<{ readonly anchor: Position; focus: Position; x: number; y: number } | undefined>(undefined);

  /** The character under a point on screen, on the page nearest it. */
  function charUnder(x: number, y: number): Position | undefined {
    let nearest: { readonly page: PageModel; readonly rect: DOMRect; readonly distance: number } | undefined;
    for (const page of pages) {
      const rect = frameOf(page.index)?.getBoundingClientRect();
      if (rect === undefined) continue;
      const distance = Math.max(rect.top - y, 0, y - rect.bottom);
      if (nearest === undefined || distance < nearest.distance) nearest = { page, rect, distance };
    }
    if (nearest === undefined) return undefined;
    const { page, rect } = nearest;
    const text = texts.get(page.index);
    if (text === undefined) {
      onNeedText(page.index);
      return undefined;
    }
    const offset = charAt(text, ...pointOnPage(page, rect, x, y));
    return offset === undefined ? undefined : { page: page.index, offset };
  }

  function follow(x: number, y: number) {
    const current = drag.current;
    if (current === undefined) return;
    current.x = x;
    current.y = y;
    const focus = charUnder(x, y);
    if (focus === undefined) return;
    current.focus = focus;
    setSelection(dragged(current.anchor, focus));
  }

  const scrollOn = useEffectEvent(() => {
    const current = drag.current;
    const pane = current && frameOf(current.anchor.page)?.closest("main");
    if (current === undefined || !pane) return;
    const bounds = pane.getBoundingClientRect();
    const step = current.y < bounds.top + SCROLL_EDGE ? -SCROLL_STEP : current.y > bounds.bottom - SCROLL_EDGE ? SCROLL_STEP : 0;
    if (step === 0) return;
    pane.scrollBy(0, step);
    follow(current.x, current.y);
  });

  useEffect(() => {
    if (!dragging) return;
    let frame = requestAnimationFrame(function tick() {
      scrollOn();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  function endDrag() {
    drag.current = undefined;
    setDragging(false);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const anchor = charUnder(event.clientX, event.clientY);
    if (anchor === undefined) return;
    drag.current = { anchor, focus: anchor, x: event.clientX, y: event.clientY };
    setWaiting(false);
    setDragging(true);
    setSelection(dragged(anchor, anchor));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerUp() {
    const current = drag.current;
    endDrag();
    if (current === undefined) return;
    const { anchor, focus } = current;
    // A click without a drag marks nothing: it leaves a caret there, for the keyboard to start from.
    if (anchor.page === focus.page && anchor.offset === focus.offset) {
      setSelection({ anchor, focus: anchor });
      return;
    }
    const final = dragged(anchor, focus);
    const missing = missingPages(final, texts);
    if (missing.length > 0) {
      for (const page of missing) onNeedText(page);
      setSelection(final);
      setWaiting(true);
      return;
    }
    const target = selectionTarget(final, texts);
    setSelection(undefined);
    if (target !== undefined) onMark({ target, selection: final });
  }

  const markWhenReady = useEffectEvent(() => {
    const target = selection && selectionTarget(selection, texts);
    if (selection === undefined || missingPages(selection, texts).length > 0) return;
    setWaiting(false);
    setSelection(undefined);
    if (target !== undefined) onMark({ target, selection });
  });

  useEffect(() => {
    if (waiting) markWhenReady();
  }, [waiting, texts]);

  function onDoubleClick(event: MouseEvent) {
    const chosen = wordAround(texts, charUnder(event.clientX, event.clientY));
    const target = chosen && selectionTarget(chosen, texts);
    if (chosen && target) onMark({ target, selection: chosen });
  }

  function step(event: KeyboardEvent, page: PageIndex, view: Box | undefined): Selection | undefined {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (selection === undefined) return firstWordIn(texts, page, view);
    if (event.shiftKey) return extend(texts, selection, event.key, byWord(event));
    return event.key === "ArrowUp" || event.key === "ArrowDown"
      ? wordOnNextLine(texts, selection, forward)
      : nextWord(texts, selection, forward);
  }

  function onKey(event: KeyboardEvent, page: PageIndex, view: Box | undefined): boolean {
    // The selection may step onto a neighbouring page next.
    for (const neighbour of [page - 1, page + 1]) {
      const near = pages.find((each) => each.index === neighbour);
      if (near !== undefined) onNeedText(near.index);
    }
    if (event.key === "Escape") {
      if (selection === undefined) return false;
      setSelection(undefined);
      return true;
    }
    if (event.key === "Enter") {
      const target = selection && selectionTarget(selection, texts);
      if (selection === undefined || target === undefined) return false;
      onMark({ target, selection });
      setSelection({ anchor: selection.focus, focus: selection.focus });
      return true;
    }
    if (!event.key.startsWith("Arrow")) return false;
    const next = step(event, page, view);
    if (next !== undefined) {
      setSelection(next);
      if (next.focus.page !== page) frameOf(next.focus.page)?.querySelector<HTMLElement>('[role="application"]')?.focus();
    }
    return true;
  }

  // Worked out once per change of selection or text, not on every render of the pages.
  const target = useMemo(() => selection && selectionTarget(selection, texts), [selection, texts]);
  const forwards = selection !== undefined && sorted(selection)[1] === selection.focus;

  /** Shift with an arrow in the type picker: moves the end of the selection a new mark came from. */
  function adjust(pending: Pending, event: KeyboardEvent) {
    const next = pending.selection && extend(texts, pending.selection, event.key, byWord(event));
    const moved = next && selectionTarget(next, texts);
    if (moved !== undefined) onMark({ target: moved, selection: next });
  }

  /** The selection's part on one page, with its handlers. */
  const onPage = (page: PageIndex): TextSelecting => {
    const boxes = target === undefined ? [] : boxesOn(target, page);
    const holdsFocus = selection?.focus.page === page;
    return {
      boxes,
      focusBox: holdsFocus ? (forwards ? boxes.at(-1) : boxes.at(0)) : undefined,
      announcement: holdsFocus && target !== undefined ? `Selected: ${target.text}` : "",
      onPointerDown,
      onPointerMove: (event) => {
        if (drag.current === undefined) return false;
        follow(event.clientX, event.clientY);
        return true;
      },
      onPointerUp,
      onPointerCancel: () => {
        endDrag();
        setSelection(undefined);
      },
      onDoubleClick,
      onKey: (event, view) => onKey(event, page, view),
    };
  };

  return { onPage, adjust };
}

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { PageModel } from "../engine/contract";
import { fittingScale } from "./pageGeometry";
import { PAGE_LIST_PADDING } from "./PageList";
import { CSS_PIXELS_PER_POINT } from "./useEngine";


/** How large pages are shown: fitted to the pane, or a share of their printed size. */
type Zoom = "fit" | number;

// The sizes the buttons and keys step through, as shares of the printed size.
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const MIN_ZOOM = Math.min(...STEPS);
export const MAX_ZOOM = Math.max(...STEPS);
// A pinch or Ctrl with the wheel zooms smoothly: this much per pixel of scroll.
const WHEEL_RATE = 0.01;

const clampZoom = (zoom: number) => Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);

/** The next step above or below `shown`. */
function step(shown: number, direction: 1 | -1): number {
  const beyond = STEPS.filter((each) => (direction === 1 ? each > shown + 0.001 : each < shown - 0.001));
  return clampZoom((direction === 1 ? beyond[0] : beyond.at(-1)) ?? shown);
}

/** Where on the pane a zoom is centred, kept in place as the pages grow or shrink. */
interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly shareX: number;
  readonly shareY: number;
}

/**
 * The pages' scale in the pane `ref` points at: fitted to its width (never above the printed
 * size, so the side panels never cut a page off), or zoomed by the user. Ctrl or Cmd with +, −
 * and 0, and Ctrl with the wheel or a pinch over the pane, zoom too.
 */
export function useZoom(pages: readonly PageModel[]) {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const anchor = useRef<Anchor | undefined>(undefined);
  const fitted = width === undefined ? CSS_PIXELS_PER_POINT : fittingScale(pages, width);
  const scale = zoom === "fit" ? fitted : zoom * CSS_PIXELS_PER_POINT;
  const shown = scale / CSS_PIXELS_PER_POINT;

  function zoomTo(next: Zoom, at?: { readonly x: number; readonly y: number }) {
    const pane = ref.current;
    const nextScale = next === "fit" ? fitted : next * CSS_PIXELS_PER_POINT;
    // An anchor is kept only for a change of scale; otherwise a later resize would use it.
    if (pane !== null && nextScale !== scale) {
      const x = at?.x ?? pane.clientWidth / 2;
      const y = at?.y ?? pane.clientHeight / 2;
      anchor.current = { x, y, shareX: (pane.scrollLeft + x) / pane.scrollWidth, shareY: (pane.scrollTop + y) / pane.scrollHeight };
    }
    setZoom(next);
  }

  useLayoutEffect(() => {
    const pane = ref.current;
    const kept = anchor.current;
    anchor.current = undefined;
    if (pane === null || kept === undefined) return;
    pane.scrollLeft = kept.shareX * pane.scrollWidth - kept.x;
    pane.scrollTop = kept.shareY * pane.scrollHeight - kept.y;
  }, [scale]);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    // In a text field or a dialog the keys keep their usual meaning, such as zooming the browser.
    const inField = event.target instanceof Element && event.target.closest("input, textarea, dialog, [popover]") !== null;
    if (!(event.ctrlKey || event.metaKey) || inField) return;
    const direction = { "=": 1, "+": 1, "-": -1 }[event.key];
    if (direction !== undefined) zoomTo(step(shown, direction === 1 ? 1 : -1));
    else if (event.key === "0") zoomTo("fit");
    else return;
    event.preventDefault();
  });

  const onWheel = useEffectEvent((event: WheelEvent) => {
    const pane = ref.current;
    if (!event.ctrlKey || pane === null) return;
    event.preventDefault();
    const bounds = pane.getBoundingClientRect();
    zoomTo(clampZoom(shown * Math.exp(-event.deltaY * WHEEL_RATE)), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  });

  useEffect(() => {
    const pane = ref.current;
    if (pane === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width - 2 * PAGE_LIST_PADDING);
    });
    observer.observe(pane);
    const key = (event: KeyboardEvent) => onKey(event);
    // Not passive, so a pinch zooms the pages instead of the whole app.
    const wheel = (event: WheelEvent) => onWheel(event);
    addEventListener("keydown", key);
    pane.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      removeEventListener("keydown", key);
      pane.removeEventListener("wheel", wheel);
    };
  }, []);

  return {
    ref,
    scale,
    /** The pages' size as a share of their printed size. */
    shown,
    fitted: zoom === "fit",
    zoomIn: () => zoomTo(step(shown, 1)),
    zoomOut: () => zoomTo(step(shown, -1)),
    fit: () => zoomTo("fit"),
  };
}

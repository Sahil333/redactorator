// Where a page is on screen: its frame's id, its scale, and screen points as points on the page.
import { createContext } from "react";
import type { PageIndex, PageModel } from "../engine/contract";
import { CSS_PIXELS_PER_POINT } from "./useEngine";

/** The id of a page's frame, which the page list and marks panel link to. */
export const pageFrameId = (page: PageIndex) => `page-${page + 1}`;

/** CSS pixels per PDF point that pages are shown at, fitted to the pane or zoomed. */
export const PageScale = createContext(CSS_PIXELS_PER_POINT);

/** The scale that fits `pages` into `width` CSS pixels, never above their printed size. */
export function fittingScale(pages: readonly PageModel[], width: number): number {
  const widest = Math.max(...pages.map((page) => page.width));
  return Math.min(CSS_PIXELS_PER_POINT, width / widest);
}

/** A point on screen as points on `page`, whose frame is at `rect`, kept on the page. */
export function pointOnPage(page: PageModel, rect: DOMRect, x: number, y: number): readonly [number, number] {
  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit);
  const scale = rect.width / page.width;
  return [clamp((x - rect.left) / scale, page.width), clamp((y - rect.top) / scale, page.height)];
}

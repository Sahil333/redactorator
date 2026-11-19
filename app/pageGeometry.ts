// Where a page is on screen: its frame's id, and screen points as points on the page.
import type { PageIndex, PageModel } from "../engine/contract";
import { CSS_PIXELS_PER_POINT } from "./useEngine";

/** The id of a page's frame, which the page list and marks panel link to. */
export const pageFrameId = (page: PageIndex) => `page-${page + 1}`;

/** A point on screen as points on `page`, whose frame is at `rect`, kept on the page. */
export function pointOnPage(page: PageModel, rect: DOMRect, x: number, y: number): readonly [number, number] {
  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit);
  return [
    clamp((x - rect.left) / CSS_PIXELS_PER_POINT, page.width),
    clamp((y - rect.top) / CSS_PIXELS_PER_POINT, page.height),
  ];
}

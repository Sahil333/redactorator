// Drawing a box with the keyboard: one starts in view, and the arrow keys move and size it.
import { pointBox, type Box, type PageModel } from "../engine/contract";

const BOX_STEP = 4;
const NEW_BOX = { width: 120, height: 40 };

/** A box of the default size in the middle of `view`, kept on the page. */
export function newBox(page: PageModel, view: Box): Box | undefined {
  const width = Math.min(NEW_BOX.width, page.width);
  const height = Math.min(NEW_BOX.height, page.height);
  const x0 = Math.min(Math.max((view.x0 + view.x1 - width) / 2, 0), page.width - width);
  const y0 = Math.min(Math.max((view.y0 + view.y1 - height) / 2, 0), page.height - height);
  return pointBox(x0, y0, x0 + width, y0 + height);
}

/**
 * The box after an arrow key: it moves, or with Shift its right or bottom edge moves.
 * It stays on the page and at least `minimum` points on each side.
 */
export function boxStep(page: PageModel, box: Box, key: string, resize: boolean, minimum: number): Box | undefined {
  const dx = key === "ArrowRight" ? BOX_STEP : key === "ArrowLeft" ? -BOX_STEP : 0;
  const dy = key === "ArrowDown" ? BOX_STEP : key === "ArrowUp" ? -BOX_STEP : 0;
  if (resize) {
    const x1 = Math.min(Math.max(box.x1 + dx, box.x0 + minimum), page.width);
    const y1 = Math.min(Math.max(box.y1 + dy, box.y0 + minimum), page.height);
    return pointBox(box.x0, box.y0, x1, y1);
  }
  const x = Math.min(Math.max(dx, -box.x0), page.width - box.x1);
  const y = Math.min(Math.max(dy, -box.y0), page.height - box.y1);
  return pointBox(box.x0 + x, box.y0 + y, box.x1 + x, box.y1 + y);
}

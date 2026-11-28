import { firstPage, type MarkTarget } from "../engine/model/marks";
import type { Selection } from "../engine/model/selection";

export type Tool = "text" | "box";

// A box smaller than this on either side is taken as a stray click, and the keyboard
// cannot shrink one below it.
export const MIN_BOX_POINTS = 3;

/** A mark the user has drawn but not yet given a type, and for text the selection it came from. */
export interface Pending {
  readonly target: MarkTarget;
  readonly selection: Selection | undefined;
}

/** "page 2", or "pages 2–3" for text that runs across pages. */
export function pagesLabel(target: MarkTarget): string {
  const first = firstPage(target) + 1;
  const last = target.kind === "text" ? (target.pieces.at(-1)?.page ?? 0) + 1 : first;
  return last === first ? `page ${first}` : `pages ${first}–${last}`;
}

export const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** "page 4", or "pages 1, 2 and 4", for page numbers in order. */
export function pagesList(pages: readonly number[]): string {
  const last = pages.at(-1);
  return pages.length < 2 ? `page ${last}` : `pages ${pages.slice(0, -1).join(", ")} and ${last}`;
}

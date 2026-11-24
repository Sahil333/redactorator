import type { Brand } from "./brand";
import { isRecord } from "./guards";

/** Zero-based page index. A page number shown to a user is this plus one. */
export type PageIndex = Brand<number, "PageIndex">;

/**
 * A length in PDF points in MuPDF's page space: origin top-left, y grows down,
 * page rotation and crop box already applied. Every box in the engine uses it.
 */
export type Points = Brand<number, "Points">;

export const isPageIndex = (value: unknown): value is PageIndex =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export const isPoints = (value: unknown): value is Points => typeof value === "number" && Number.isFinite(value);

/** A box from four coordinates, or undefined when one is not a finite number. */
export const pointBox = (x0: number, y0: number, x1: number, y1: number): Box | undefined =>
  isPoints(x0) && isPoints(y0) && isPoints(x1) && isPoints(y1) ? { x0, y0, x1, y1 } : undefined;

/** A rectangle in the engine's box convention (see `Points`). */
export interface Box {
  readonly x0: Points;
  readonly y0: Points;
  readonly x1: Points;
  readonly y1: Points;
}

/** [a, b, c, d, e, f]: takes (x, y) to (a x + c y + e, b x + d y + f). */
export type Matrix = readonly [number, number, number, number, number, number];

export const isMatrix = (value: unknown): value is Matrix =>
  Array.isArray(value) && value.length === 6 && value.every((n) => typeof n === "number" && Number.isFinite(n));

export function parseBox(value: unknown): Box | undefined {
  if (!isRecord(value)) return undefined;
  const { x0, y0, x1, y1 } = value;
  if (!isPoints(x0) || !isPoints(y0) || !isPoints(x1) || !isPoints(y1) || x0 > x1 || y0 > y1) return undefined;
  return { x0, y0, x1, y1 };
}

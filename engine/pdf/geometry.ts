import type * as mupdf from "mupdf";
import { pointBox, type Box } from "../model/geometry";

export type Point = readonly [number, number];

function toBox(x0: number, y0: number, x1: number, y1: number): Box {
  const box = pointBox(x0, y0, x1, y1);
  if (box === undefined) throw new Error("A box is not a finite size");
  return box;
}

// MuPDF's quad order: upper left, upper right, lower left, lower right.
export const quadCorners = (quad: mupdf.Quad): [Point, Point, Point, Point] => [
  [quad[0], quad[1]],
  [quad[2], quad[3]],
  [quad[4], quad[5]],
  [quad[6], quad[7]],
];

export const transform = ([a, b, c, d, e, f]: mupdf.Matrix, [x, y]: Point): Point => [a * x + c * y + e, b * x + d * y + f];

export function around(points: readonly Point[]): Box {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return toBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

// The body of a letter, as a share of the font size: from the baseline up to about cap height.
const BODY = 0.7;

/** A letter's ink: its width, from its baseline up to cap height, wherever the quad's lower edge is. */
export function bodyOf(origin: mupdf.Point, size: number, quad: mupdf.Quad): Box {
  const [ul, ur, ll, lr] = quadCorners(quad);
  const up: Point = [ul[0] - ll[0], ul[1] - ll[1]];
  const height = Math.hypot(...up);
  const clamp = (t: number) => Math.min(Math.max(t, 0), 1);
  // How far up the quad the baseline and cap height are, from its lower edge.
  const base = height === 0 ? 0 : clamp(((origin[0] - ll[0]) * up[0] + (origin[1] - ll[1]) * up[1]) / height ** 2);
  const cap = height === 0 ? 1 : clamp(base + (BODY * size) / height);
  const at = (t: number): Point[] => [
    [ll[0] + t * up[0], ll[1] + t * up[1]],
    [lr[0] + t * (ur[0] - lr[0]), lr[1] + t * (ur[1] - lr[1])],
  ];
  return around([...at(base), ...at(cap)]);
}

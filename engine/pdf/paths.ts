// The parts of the paths a page draws, as MuPDF's redaction judges them: one part from each move step.
import * as mupdf from "mupdf";
import { transform, type Point } from "./geometry";

/** One part of a path in page space: its steps, `M`ove, `L`ine, `C`urve and `Z` close, and the points they reach. */
export interface PathPart {
  readonly steps: string;
  readonly points: readonly Point[];
}

/** Each part of `path` drawn through `ctm`, a curve's control points among its points. */
function pathParts(path: mupdf.Path, ctm: mupdf.Matrix): PathPart[] {
  const parts: { steps: string; points: Point[] }[] = [];
  const step = (kind: string, ...points: Point[]) => {
    const part = parts.at(-1);
    if (part === undefined) return;
    part.steps += kind;
    part.points.push(...points.map((point) => transform(ctm, point)));
  };
  path.walk({
    moveTo(x, y) {
      parts.push({ steps: "", points: [] });
      step("M", [x, y]);
    },
    lineTo: (x, y) => step("L", [x, y]),
    curveTo: (x1, y1, x2, y2, x3, y3) => step("C", [x1, y1], [x2, y2], [x3, y3]),
    closePath: () => step("Z"),
  });
  return parts;
}

/**
 * Hands `use` each part of every path the page fills or strokes, with `grow`, how far a stroke
 * reaches past its points: half its width. `use` runs inside MuPDF's device, so it must not throw.
 */
export function drawnParts(page: mupdf.Page, use: (part: PathPart, grow: number) => void): void {
  const each = (path: mupdf.Path, ctm: mupdf.Matrix, grow: number) => {
    for (const part of pathParts(path, ctm)) use(part, grow);
  };
  const device = new mupdf.Device({
    fillPath: (path, _evenOdd, ctm) => each(path, ctm, 0),
    strokePath: (path, stroke, ctm) => each(path, ctm, stroke.getLineWidth() / 2),
  });
  try {
    page.run(device, mupdf.Matrix.identity);
    device.close();
  } finally {
    device.destroy();
  }
}

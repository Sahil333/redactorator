import { describe, expect, test } from "vitest";
import type { PlacedImage } from "./document";
import { isPageIndex, pointBox, type Matrix } from "./geometry";
import { anchorOf, placesOnCopies } from "./images";

const page = 0;
if (!isPageIndex(page)) throw new Error("No page");

const box = (x0: number, y0: number, x1: number, y1: number) => {
  const made = pointBox(x0, y0, x1, y1);
  if (made === undefined) throw new Error("No box");
  return made;
};

const logo = "0f3c5a96e1b27d48";
const placed = (matrix: Matrix, fingerprint = logo, aspect = 1.5): PlacedImage => ({ page, matrix, aspect, fingerprint });

// logo-a.pdf's logo, and logo-b.pdf's half-size and quarter-turned copies, in page space.
const whole = placed([288, 0, 0, 192, 100, 100]);
const half = placed([144, 0, 0, 96, 100, 146]);
const turned = placed([0, -144, 96, 0, 304, 242]);

const rounded = (b: { x0: number; y0: number; x1: number; y1: number }) => [b.x0, b.y0, b.x1, b.y1].map((n) => Math.round(n * 10) / 10);

describe("anchorOf", () => {
  test("keeps the part of the box on the image, in the image's frame", () => {
    expect(anchorOf(page, box(90, 90, 359.2, 302), [whole])).toEqual({ fingerprint: logo, aspect: 1.5, frame: [0, 0, 0.9, 1] });
  });

  test("anchors to nothing when less than half the box is on an image", () => {
    expect(anchorOf(page, box(300, 250, 500, 350), [whole])).toBeUndefined();
  });
});

describe("placesOnCopies", () => {
  const anchor = { fingerprint: logo, aspect: 1.5, frame: [0, 0, 0.9, 1] } as const;

  test("lays the part over each copy, at its size and turn", () => {
    expect(placesOnCopies(anchor, [half, turned]).map(({ box: each }) => rounded(each))).toEqual([
      [100, 146, 229.6, 242],
      [304, 112.4, 400, 242],
    ]);
  });

  test("passes over an image that looks different or has another shape", () => {
    // Every bit of the first eight hex digits differs.
    const other = placed([288, 0, 0, 192, 100, 100], "f0c3a569e1b27d48");
    const stretched = placed([288, 0, 0, 192, 100, 100], logo, 1.8);
    expect(placesOnCopies(anchor, [other, stretched])).toEqual([]);
  });
});

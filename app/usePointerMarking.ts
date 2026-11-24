import { useState, type MouseEvent, type PointerEvent } from "react";
import type { PageModel } from "../engine/model/document";
import { pointBox, type Box } from "../engine/model/geometry";
import { contains } from "../engine/model/pageText";
import { boxesOn, type Mark, type MarkTarget } from "../engine/model/marks";
import { MIN_BOX_POINTS, type Tool } from "./marks";
import { pointOnPage } from "./pageGeometry";

type Point = readonly [number, number];

interface Drawing {
  readonly from: Point;
  readonly to: Point;
}

const toBox = ([ax, ay]: Point, [bx, by]: Point) =>
  pointBox(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));

interface PointerMarkingOptions {
  readonly page: PageModel;
  /** Undefined while the page takes no marks. */
  readonly tool: Tool | undefined;
  readonly marks: readonly Mark[];
  readonly highlighted: Mark["id"] | undefined;
  readonly onMark: (target: MarkTarget) => void;
  readonly onHighlight: (mark: Mark["id"] | undefined) => void;
}

/** The mouse on one page: drawing a box with the Draw box tool, and pointing at a mark to highlight it. */
export function usePointerMarking({ page, tool, marks, highlighted, onMark, onHighlight }: PointerMarkingOptions) {
  const [drawing, setDrawing] = useState<Drawing | undefined>(undefined);

  const pointAt = (event: MouseEvent): Point =>
    pointOnPage(page, event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);

  function onPointerDown(event: PointerEvent) {
    if (tool !== "box" || event.button !== 0) return;
    const point = pointAt(event);
    setDrawing({ from: point, to: point });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    const point = pointAt(event);
    if (drawing !== undefined) {
      setDrawing({ ...drawing, to: point });
      return;
    }
    const under = marks.find((mark) => boxesOn(mark.target, page.index).some((box) => contains(box, ...point)))?.id;
    if (under !== highlighted) onHighlight(under);
  }

  function onPointerUp() {
    setDrawing(undefined);
    const box = drawing && toBox(drawing.from, drawing.to);
    if (box && box.x1 - box.x0 >= MIN_BOX_POINTS && box.y1 - box.y0 >= MIN_BOX_POINTS) {
      onMark({ kind: "box", page: page.index, box });
    }
  }

  const drawn = drawing && toBox(drawing.from, drawing.to);
  return {
    drawn: drawn === undefined ? [] : [drawn],
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: () => setDrawing(undefined),
      onPointerLeave: () => onHighlight(undefined),
    },
  };
}

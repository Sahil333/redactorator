import { use, useEffect, useId, useRef, type ComponentProps, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { PageModel, PageText } from "../engine/model/document";
import type { FindingPlace } from "../engine/model/findings";
import type { Box } from "../engine/model/geometry";
import { boxesOn, type Mark, type MarkTarget } from "../engine/model/marks";
import type { Pending, Tool } from "./marks";
import { markTypeLabel } from "../engine/model/markTypes";
import { rangeBoxes } from "../engine/model/pageText";
import { CSS_PIXELS_PER_POINT, markElementId, pageFrameId, PageScale } from "./pageGeometry";
import type { RenderDetail } from "./usePageImages";
import { useKeyboardMarking } from "./useKeyboardMarking";
import { usePointerMarking } from "./usePointerMarking";
import type { TextSelecting } from "./useTextSelection";
import { useWhenVisible } from "./useWhenVisible";

interface PageViewProps {
  readonly page: PageModel;
  readonly image: ImageData | undefined;
  readonly marks: readonly Mark[];
  /** The places of the open findings review's values on this page, and the page's text, to find their boxes in. */
  readonly found: { readonly text: PageText | undefined; readonly places: readonly FindingPlace[] };
  /** A new mark still waiting for its type. */
  readonly pending: Pending | undefined;
  /** The mark under the pointer here or in the marks panel. */
  readonly highlighted: Mark["id"] | undefined;
  /** Undefined in the preview, or while the engine is busy: the page takes no marks. */
  readonly tool: Tool | undefined;
  /** This page's part in the document's text selection. */
  readonly text: TextSelecting;
  /** The page is near the screen and its image is missing, or too coarse for the scale it is shown at. */
  readonly onVisible: (detail: RenderDetail) => void;
  /** A box drawn on this page. */
  readonly onMark: (target: MarkTarget) => void;
  readonly onHighlight: (mark: Mark["id"] | undefined) => void;
  /** Where a refused Preview points on this page, such as the unmarked letters it would remove. */
  readonly refused: readonly Box[];
  readonly children?: ReactNode;
}

// Boxes are placed as shares of the page, so they follow it at whatever scale it is shown.
const boxStyle = (page: PageModel, box: Box) => ({
  left: `${(box.x0 / page.width) * 100}%`,
  top: `${(box.y0 / page.height) * 100}%`,
  width: `${((box.x1 - box.x0) / page.width) * 100}%`,
  height: `${((box.y1 - box.y0) / page.height) * 100}%`,
});

const tools: Record<Tool, { readonly label: string; readonly cursor: string; readonly hint: string }> = {
  text: {
    label: "select text",
    cursor: "cursor-text",
    hint: "Arrow keys move between words. Shift with an arrow extends by a letter or a line, and with Option (or Ctrl) too by a word. Enter marks, Escape clears.",
  },
  box: {
    label: "draw a box",
    cursor: "cursor-crosshair",
    hint: "Enter starts a box in view. Arrow keys move it, Shift with an arrow resizes it, Enter marks it.",
  },
};

// A new mark, brought by another document's approval, is drawn blue until this one is approved.
const markColours = {
  own: { box: "border-mark", text: "outline-mark", wash: "bg-mark-wash", fill: "bg-mark/30" },
  new: { box: "border-accent", text: "outline-accent", wash: "bg-accent/15", fill: "bg-accent/30" },
} as const;

const markStyle = (target: MarkTarget, highlighted: boolean, isNew = false) => {
  const colour = markColours[isNew ? "new" : "own"];
  return target.kind === "box"
    ? `absolute border-dashed ${colour.box} ${highlighted ? `border-2 ${colour.fill}` : `border-[1.5px] ${colour.wash}`}`
    : `absolute rounded-[1px] ${colour.text} ${highlighted ? `${colour.fill} outline-2` : `${colour.wash} outline-[1.5px]`}`;
};

function PageImage({ image, label }: { readonly image: ImageData; readonly label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);
  return <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 size-full" />;
}

/** Keeps `box` in view: where a keyboard selection or box is moving. */
function InView({ page, box }: { readonly page: PageModel; readonly box: Box }) {
  const ref = useRef<HTMLDivElement>(null);
  const { x0, y0, x1, y1 } = box;
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [x0, y0, x1, y1]);
  return <div ref={ref} className="absolute" style={boxStyle(page, box)} />;
}

interface MarkLayerProps {
  readonly page: PageModel;
  readonly marks: readonly Mark[];
  readonly pending: Pending | undefined;
  readonly highlighted: Mark["id"] | undefined;
  readonly selection: readonly Box[];
  readonly focusBox: Box | undefined;
  readonly refused: readonly Box[];
}

/**
 * The marks, a new mark waiting for its type, and the selection being made. Only the highlighted
 * mark shows its type, on a tag above it, so tags never cover the text above the other marks.
 */
function MarkLayer({ page, marks, pending, highlighted, selection, focusBox, refused }: MarkLayerProps) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {marks.flatMap((mark) =>
        boxesOn(mark.target, page.index).map((box, index) => (
          <div
            key={`${mark.id}-${index}`}
            {...(index === 0 && { id: markElementId(mark.id) })}
            className={markStyle(mark.target, mark.id === highlighted, mark.isNew)}
            style={boxStyle(page, box)}
          >
            {index === 0 && mark.id === highlighted && (
              <span className={`absolute bottom-full -left-[1.5px] mb-px max-w-40 truncate rounded-t-sm px-1 py-px text-[10px] leading-3 font-medium text-white ${mark.isNew ? "bg-accent" : "bg-mark"}`}>
                {markTypeLabel(mark.type)}
              </span>
            )}
          </div>
        )),
      )}
      {pending &&
        boxesOn(pending.target, page.index).map((box, index) => (
          <div key={`pending-${index}`} className={markStyle(pending.target, false)} style={boxStyle(page, box)} />
        ))}
      {selection.map((box, index) => (
        <div key={index} className="absolute border border-accent bg-accent/20" style={boxStyle(page, box)} />
      ))}
      {refused.map((box, index) => (
        <div key={`refused-${index}`} data-refused="" className="absolute bg-fail-wash/60 outline-2 outline-mark outline-dotted" style={boxStyle(page, box)} />
      ))}
      {focusBox && <InView page={page} box={focusBox} />}
    </div>
  );
}

/** The found values on the page, drawn apart from the marks: they are removed only once confirmed. */
function FindingLayer({ page, found: { text, places } }: { readonly page: PageModel; readonly found: PageViewProps["found"] }) {
  if (text === undefined || places.length === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {places.flatMap(({ start, end }) =>
        rangeBoxes(text, start, end).map((box, index) => (
          <div key={`${start}-${end}-${index}`} data-finding="" className="absolute rounded-[1px] outline-[1.5px] outline-mark outline-dashed" style={boxStyle(page, box)} />
        )),
      )}
    </div>
  );
}

interface MarkingSurfaceProps {
  readonly pageNumber: number;
  readonly tool: Tool;
  readonly handlers: ComponentProps<"div">;
  readonly announcement: string;
}

/** The page's surface that takes marks with the pointer and the keyboard, and what it says to a screen reader. */
function MarkingSurface({ pageNumber, tool, handlers, announcement }: MarkingSurfaceProps) {
  const hintId = useId();
  return (
    <>
      <div
        role="application"
        aria-label={`Page ${pageNumber}, ${tools[tool].label}`}
        aria-describedby={hintId}
        tabIndex={0}
        {...handlers}
        className={`absolute inset-0 touch-none select-none ${tools[tool].cursor}`}
      />
      <div className="sr-only">
        <p id={hintId}>{tools[tool].hint}</p>
        <p aria-live="polite">{announcement}</p>
      </div>
    </>
  );
}

type PointerHandlers = ReturnType<typeof usePointerMarking>["handlers"];

/** The page surface's mouse handlers: text goes to the document's selection, boxes stay on the page. */
const surfaceHandlers = (tool: Tool, text: TextSelecting, pointer: PointerHandlers) => ({
  onPointerDown: (event: PointerEvent) => (tool === "text" ? text.onPointerDown(event) : pointer.onPointerDown(event)),
  onPointerMove: (event: PointerEvent) => {
    if (!text.onPointerMove(event)) pointer.onPointerMove(event);
  },
  onPointerUp: () => {
    text.onPointerUp();
    pointer.onPointerUp();
  },
  onPointerCancel: () => {
    text.onPointerCancel();
    pointer.onPointerCancel();
  },
  onPointerLeave: pointer.onPointerLeave,
  onDoubleClick: (event: MouseEvent) => {
    if (tool === "text") text.onDoubleClick(event);
  },
});

/**
 * Asks for the page's image once it nears the screen, and again, drawn twice as finely, once the
 * page is zoomed past its printed size, so it stays sharp.
 */
function useSharpImage(
  frameRef: RefObject<HTMLElement | null>,
  page: PageModel,
  image: ImageData | undefined,
  scale: number,
  onVisible: (detail: RenderDetail) => void,
) {
  const detail: RenderDetail = scale > CSS_PIXELS_PER_POINT ? 2 : 1;
  const needed = page.width * CSS_PIXELS_PER_POINT * devicePixelRatio * detail;
  const coarse = image === undefined || image.width < needed * 0.98;
  useWhenVisible(frameRef, coarse ? `${detail}:${image?.width ?? 0}` : undefined, () => onVisible(detail));
}

export function PageView({
  page,
  image,
  marks,
  found,
  pending,
  highlighted,
  tool,
  text,
  onVisible,
  onMark,
  onHighlight,
  refused,
  children,
}: PageViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const scale = use(PageScale);
  const pageNumber = page.index + 1;
  const pointer = usePointerMarking({ page, tool, marks, highlighted, onMark, onHighlight });
  const keys = useKeyboardMarking({ page, tool, frameRef, onMark, text });
  useSharpImage(frameRef, page, image, scale, onVisible);

  return (
    <div
      ref={frameRef}
      id={pageFrameId(page.index)}
      // The page's width in points, so tests can turn points into places on screen at any zoom.
      data-points-wide={page.width}
      className="relative shrink-0 bg-white shadow-[0_1px_3px_rgb(31_27_22/0.18)]"
      style={{ width: `${page.width * scale}px`, height: `${page.height * scale}px` }}
    >
      {image !== undefined && <PageImage image={image} label={`Page ${pageNumber}`} />}
      <FindingLayer page={page} found={found} />
      <MarkLayer
        page={page}
        marks={marks}
        pending={pending}
        highlighted={highlighted}
        selection={[...pointer.drawn, ...keys.draft, ...text.boxes]}
        focusBox={keys.focusBox}
        refused={refused}
      />
      {tool !== undefined && (
        <MarkingSurface pageNumber={pageNumber} tool={tool} handlers={{ ...keys.handlers, ...surfaceHandlers(tool, text, pointer.handlers) }} announcement={keys.announcement} />
      )}
      {children}
    </div>
  );
}

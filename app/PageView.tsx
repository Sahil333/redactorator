import { useEffect, useId, useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { Box, PageModel } from "../engine/contract";
import { boxesOn, type Mark, type MarkTarget, type Pending, type Tool } from "./marks";
import { markTypeLabel } from "./markTypes";
import { pageFrameId } from "./pageGeometry";
import { CSS_PIXELS_PER_POINT } from "./useEngine";
import { useKeyboardMarking } from "./useKeyboardMarking";
import { usePointerMarking } from "./usePointerMarking";
import type { TextSelecting } from "./useTextSelection";
import { useWhenVisible } from "./useWhenVisible";

interface PageViewProps {
  readonly page: PageModel;
  readonly image: ImageData | undefined;
  readonly marks: readonly Mark[];
  /** A new mark still waiting for its type. */
  readonly pending: Pending | undefined;
  /** The mark under the pointer here or in the marks panel. */
  readonly highlighted: Mark["id"] | undefined;
  /** Undefined in the preview, or while the engine is busy: the page takes no marks. */
  readonly tool: Tool | undefined;
  /** This page's part in the document's text selection. */
  readonly text: TextSelecting;
  readonly onVisible: () => void;
  /** A box drawn on this page. */
  readonly onMark: (target: MarkTarget) => void;
  readonly onHighlight: (mark: Mark["id"] | undefined) => void;
  readonly children?: ReactNode;
}

const px = (points: number) => `${points * CSS_PIXELS_PER_POINT}px`;

const boxStyle = (box: Box) => ({
  left: px(box.x0),
  top: px(box.y0),
  width: px(box.x1 - box.x0),
  height: px(box.y1 - box.y0),
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

const markStyle = (target: MarkTarget, highlighted: boolean) =>
  target.kind === "box"
    ? `absolute border-dashed border-mark ${highlighted ? "border-2 bg-mark/30" : "border-[1.5px] bg-mark-wash"}`
    : `absolute rounded-[1px] outline-mark ${highlighted ? "bg-mark/30 outline-2" : "bg-mark-wash outline-[1.5px]"}`;

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
function InView({ box }: { readonly box: Box }) {
  const ref = useRef<HTMLDivElement>(null);
  const { x0, y0, x1, y1 } = box;
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [x0, y0, x1, y1]);
  return <div ref={ref} className="absolute" style={boxStyle(box)} />;
}

interface MarkLayerProps {
  readonly page: PageModel;
  readonly marks: readonly Mark[];
  readonly pending: Pending | undefined;
  readonly highlighted: Mark["id"] | undefined;
  readonly selection: readonly Box[];
  readonly focusBox: Box | undefined;
}

/** The marks, each tagged with its type, a new mark waiting for one, and the selection being made. */
function MarkLayer({ page, marks, pending, highlighted, selection, focusBox }: MarkLayerProps) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {marks.flatMap((mark) =>
        boxesOn(mark.target, page.index).map((box, index) => (
          <div key={`${mark.id}-${index}`} className={markStyle(mark.target, mark.id === highlighted)} style={boxStyle(box)}>
            {index === 0 && (
              <span className="absolute bottom-full -left-[1.5px] mb-px max-w-40 truncate rounded-t-sm bg-mark px-1 py-px text-[10px] leading-3 font-medium text-white">
                {markTypeLabel(mark.type)}
              </span>
            )}
          </div>
        )),
      )}
      {pending &&
        boxesOn(pending.target, page.index).map((box, index) => (
          <div key={`pending-${index}`} className={markStyle(pending.target, false)} style={boxStyle(box)} />
        ))}
      {selection.map((box, index) => (
        <div key={index} className="absolute border border-accent bg-accent/20" style={boxStyle(box)} />
      ))}
      {focusBox && <InView box={focusBox} />}
    </div>
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

export function PageView({
  page,
  image,
  marks,
  pending,
  highlighted,
  tool,
  text,
  onVisible,
  onMark,
  onHighlight,
  children,
}: PageViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const pageNumber = page.index + 1;
  const pointer = usePointerMarking({ page, tool, marks, highlighted, onMark, onHighlight });
  const keys = useKeyboardMarking({ page, tool, frameRef, onMark, text });
  useWhenVisible(frameRef, image === undefined, onVisible);

  return (
    <div
      ref={frameRef}
      id={pageFrameId(page.index)}
      className="relative shrink-0 bg-white shadow-[0_1px_3px_rgb(31_27_22/0.18)]"
      style={{ width: px(page.width), height: px(page.height) }}
    >
      {image !== undefined && <PageImage image={image} label={`Page ${pageNumber}`} />}
      <MarkLayer
        page={page}
        marks={marks}
        pending={pending}
        highlighted={highlighted}
        selection={[...pointer.drawn, ...keys.draft, ...text.boxes]}
        focusBox={keys.focusBox}
      />
      {tool !== undefined && (
        <>
          <div
            role="application"
            aria-label={`Page ${pageNumber}, ${tools[tool].label}`}
            aria-describedby={hintId}
            tabIndex={0}
            {...keys.handlers}
            {...surfaceHandlers(tool, text, pointer.handlers)}
            className={`absolute inset-0 touch-none select-none ${tools[tool].cursor}`}
          />
          <div className="sr-only">
            <p id={hintId}>{tools[tool].hint}</p>
            <p aria-live="polite">{keys.announcement}</p>
          </div>
        </>
      )}
      {children}
    </div>
  );
}

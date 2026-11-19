import { useRef, type KeyboardEvent, type PointerEvent } from "react";

/** A side panel's width in CSS pixels: where it starts and how far it may shrink or grow. */
export interface PanelWidth {
  readonly initial: number;
  readonly min: number;
  readonly max: number;
}

interface SplitterProps {
  readonly label: string;
  /** The id of the panel this splitter resizes. */
  readonly panel: string;
  readonly width: number;
  readonly limits: PanelWidth;
  /** 1 when the panel is left of the splitter (dragging right grows it), -1 when it is right of it. */
  readonly grows: 1 | -1;
  readonly onResize: (width: number) => void;
}

const KEY_STEP = 16;

/** The line between two panels: drag it, or focus it and use the arrow keys, Home and End. */
export function Splitter({ label, panel, width, limits, grows, onResize }: SplitterProps) {
  const dragFrom = useRef<{ readonly x: number; readonly width: number } | undefined>(undefined);
  const resize = (next: number) => onResize(Math.min(Math.max(next, limits.min), limits.max));
  const endDrag = () => {
    dragFrom.current = undefined;
  };

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    dragFrom.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (dragFrom.current !== undefined) resize(dragFrom.current.width + (event.clientX - dragFrom.current.x) * grows);
  }

  function onKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowLeft":
        resize(width - KEY_STEP * grows);
        break;
      case "ArrowRight":
        resize(width + KEY_STEP * grows);
        break;
      case "Home":
        resize(limits.min);
        break;
      case "End":
        resize(limits.max);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={panel}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels wide`}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="relative z-10 w-px cursor-col-resize touch-none bg-rule select-none after:absolute after:inset-y-0 after:-inset-x-1 hover:bg-accent active:bg-accent"
    />
  );
}

import { MAX_ZOOM, MIN_ZOOM, type useZoom } from "./useZoom";

const button =
  "grid size-8 place-items-center text-ink hover:bg-paper-sunk disabled:cursor-not-allowed disabled:text-field disabled:hover:bg-transparent";

const icons = {
  out: "M5 10h10",
  in: "M5 10h10 M10 5v10",
  fit: "M3 10h14 M6 7l-3 3 3 3 M14 7l3 3-3 3",
} as const;

function Icon({ path }: { readonly path: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]">
      <path d={path} />
    </svg>
  );
}

/** Zoom out, the size shown, zoom in, and back to fitting the width: over the pages, bottom right. */
export function ZoomControls({ zoom }: { readonly zoom: ReturnType<typeof useZoom> }) {
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="absolute right-6 bottom-4 z-20 flex items-center divide-x divide-rule overflow-hidden rounded-md border border-rule bg-paper-raised shadow-[0_2px_8px_rgb(31_27_22/0.12)]"
    >
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom.shown <= MIN_ZOOM + 0.001} onClick={zoom.zoomOut} className={button}>
        <Icon path={icons.out} />
      </button>
      <span aria-live="polite" className="w-14 text-center tabular-nums">
        {Math.round(zoom.shown * 100)}%
      </span>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom.shown >= MAX_ZOOM - 0.001} onClick={zoom.zoomIn} className={button}>
        <Icon path={icons.in} />
      </button>
      <button type="button" aria-label="Fit to width" title="Fit to width" aria-pressed={zoom.fitted} onClick={zoom.fit} className={`${button} aria-pressed:bg-accent-wash aria-pressed:text-accent`}>
        <Icon path={icons.fit} />
      </button>
    </div>
  );
}

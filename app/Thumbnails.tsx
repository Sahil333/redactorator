import { useEffect, useRef } from "react";
import type { PageIndex, PageModel } from "../engine/contract";
import { pageFrameId } from "./pageGeometry";
import type { PanelWidth } from "./Splitter";
import { useWhenVisible } from "./useWhenVisible";

export const thumbnailsWidth: PanelWidth = { initial: 184, min: 120, max: 360 };

const PADDING_X = 20;
// A thumbnail is drawn at the widest it can be shown, so it stays sharp however wide the panel is made.
const DRAWN_WIDTH = thumbnailsWidth.max - 2 * PADDING_X;

interface ThumbnailsProps {
  readonly id: string;
  readonly width: number;
  readonly pages: readonly PageModel[];
  readonly images: ReadonlyMap<PageIndex, ImageData>;
  readonly currentPage: PageIndex;
  readonly markedPages: ReadonlySet<PageIndex>;
  readonly onVisible: (page: PageIndex) => void;
}

function Thumbnail({ image, onVisible }: { readonly image: ImageData | undefined; readonly onVisible: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useWhenVisible(canvasRef, image === undefined, onVisible);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || image === undefined) return;
    const full = new OffscreenCanvas(image.width, image.height);
    full.getContext("2d")?.putImageData(image, 0, 0);
    canvas.width = Math.min(DRAWN_WIDTH * window.devicePixelRatio, image.width);
    canvas.height = Math.round((canvas.width * image.height) / image.width);
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.imageSmoothingQuality = "high";
    context.drawImage(full, 0, 0, canvas.width, canvas.height);
  }, [image]);

  return <canvas ref={canvasRef} aria-hidden="true" className="size-full" />;
}

export function Thumbnails({ id, width, pages, images, currentPage, markedPages, onVisible }: ThumbnailsProps) {
  return (
    <nav id={id} aria-label="Pages" className="overflow-y-auto bg-paper py-4" style={{ width, paddingInline: PADDING_X }}>
      <ol className="flex flex-col gap-4">
        {pages.map((page) => {
          const pageNumber = page.index + 1;
          const current = page.index === currentPage;
          return (
            <li key={page.index}>
              <a
                href={`#${pageFrameId(page.index)}`}
                aria-label={`Page ${pageNumber}${markedPages.has(page.index) ? ", has marks" : ""}`}
                aria-current={current ? "page" : undefined}
                className="group flex flex-col items-center gap-1.5 text-xs text-ink-muted"
              >
                <span
                  className={`block w-full bg-white ring-1 ${current ? "ring-2 ring-accent" : "ring-rule group-hover:ring-ink-muted"}`}
                  style={{ aspectRatio: `${page.width} / ${page.height}` }}
                >
                  <Thumbnail image={images.get(page.index)} onVisible={() => onVisible(page.index)} />
                </span>
                <span className="flex items-center gap-1">
                  {markedPages.has(page.index) && <span className="size-1.5 rounded-full bg-mark" />}
                  {pageNumber}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

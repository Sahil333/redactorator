import { useEffect, useRef, useState } from "react";
import type { EngineError } from "../engine/api/errors";
import type { Session } from "../engine/api/facade";
import type { DocumentHandle } from "../engine/api/state";
import type { PageText, Pixels, Source } from "../engine/model/document";
import { isPageIndex, type PageIndex } from "../engine/model/geometry";
import { CSS_PIXELS_PER_POINT } from "./pageGeometry";

/** How finely a page is drawn: at its printed size, or twice that for a page zoomed in. */
const DETAILS = [1, 2] as const;
export type RenderDetail = (typeof DETAILS)[number];

const renderKeysOf = (source: Source) => `${source}:`;
const renderKey = (source: Source, page: PageIndex, detail: RenderDetail) => `${renderKeysOf(source)}${page}:${detail}`;

const MAX_FINE_PAGES = 6;

interface PageOf {
  readonly source: Source;
  readonly page: PageIndex;
}

/** Adds `page` to the finely drawn pages, oldest first, and returns the one that must go to make room. */
function makeRoom(fine: PageOf[], page: PageOf): PageOf | undefined {
  fine.push(page);
  return fine.length > MAX_FINE_PAGES ? fine.shift() : undefined;
}

type Images = ReadonlyMap<PageIndex, ImageData>;

const noImages = { original: new Map(), output: new Map() } satisfies Record<Source, Images>;

/** The images with a newly drawn page in them. A finer image is kept over a coarser one that arrives after it. */
function withImage(current: Record<Source, Images>, source: Source, page: PageIndex, { width, height, rgba }: Pixels) {
  const shown = current[source].get(page);
  if (shown !== undefined && shown.width >= width) return current;
  return { ...current, [source]: new Map(current[source]).set(page, new ImageData(rgba, width, height)) };
}

/** Forgets every request whose key starts with `prefix`, so each is made again when next wanted. */
function forgetRequests(requested: Set<string>, prefix: string) {
  for (const key of requested) if (key.startsWith(prefix)) requested.delete(key);
}

/**
 * The open document's pages as drawn, and their text, asked of the Session as each page nears the
 * screen. `output` is the cleaned file shown, if any: once it is gone, its pages are forgotten.
 * `onFailure` hears why a page could not be drawn or read.
 */
export function usePageImages(session: Session, handle: DocumentHandle, output: DocumentHandle | undefined, onFailure: (error: EngineError) => void) {
  const requested = useRef(new Set<string>());
  // The pages drawn at detail 2, oldest first. One can take some 55 MB at a pixel ratio of 2,
  // so only the latest few are kept; an older one is drawn again if it is shown again.
  const fine = useRef<PageOf[]>([]);
  const [images, setImages] = useState<Record<Source, Images>>(noImages);
  const [texts, setTexts] = useState<ReadonlyMap<PageIndex, PageText>>(new Map());

  useEffect(() => {
    forgetRequests(requested.current, renderKeysOf("output"));
    fine.current = fine.current.filter((each) => each.source !== "output");
    setImages((current) => (current.output.size === 0 ? current : { ...current, output: new Map() }));
  }, [output]);

  function once(key: string, ask: () => void) {
    if (requested.current.has(key)) return;
    requested.current.add(key);
    ask();
  }

  function fetchText(page: PageIndex) {
    once(`text:${page}`, () =>
      void session.viewer.pageText(handle, page).then((text) => {
        if (!text.ok) onFailure(text.error);
        else setTexts((current) => new Map(current).set(page, text.value));
      }),
    );
  }

  /** Forgets a page's image and that it was asked for, so it is drawn again when next shown. */
  function forget(source: Source, page: PageIndex) {
    for (const detail of DETAILS) requested.current.delete(renderKey(source, page, detail));
    setImages((current) => {
      const kept = new Map(current[source]);
      kept.delete(page);
      return { ...current, [source]: kept };
    });
  }

  /** Asks for a page's image from `source` at `detail`, and for the original's text, once each. */
  function show(source: Source, page: PageIndex, detail: RenderDetail = 1) {
    const evicted = detail === 2 && !requested.current.has(renderKey(source, page, 2)) ? makeRoom(fine.current, { source, page }) : undefined;
    if (evicted !== undefined) forget(evicted.source, evicted.page);
    const scale = CSS_PIXELS_PER_POINT * window.devicePixelRatio * detail;
    once(renderKey(source, page, detail), () =>
      void session.viewer.render(handle, source, page, scale).then((pixels) => {
        if (!pixels.ok) onFailure(pixels.error);
        // A page forgotten while its image was on its way, to make room, stays forgotten.
        else if (DETAILS.some((each) => requested.current.has(renderKey(source, page, each)))) setImages((current) => withImage(current, source, page, pixels.value));
      }),
    );
    if (source !== "original") return;
    fetchText(page);
    // The next page's text too, so a selection made with the keys can carry onto it at once.
    const next = page + 1;
    if (isPageIndex(next) && next < handle.pages.length) fetchText(next);
  }

  return { images, texts, show };
}

import { useEffect, useRef, useState } from "react";
import type { Appearance, DocumentModel, Edit, PageText, Source } from "../engine/model/document";
import { isPageIndex, type PageIndex } from "../engine/model/geometry";
import type { EngineError } from "../engine/api/errors";
import type { Pixels } from "../engine/api/facade";
import type { Applied, ClientError, PdfClient, WorkerStatus } from "../engine/host-browser/interim";
import { CSS_PIXELS_PER_POINT } from "./pageGeometry";

/** What the engine is doing when that is all there is to say, or undefined while it is ready. */
export function engineStatus(engine: Pick<PdfEngine, "state">): string | undefined {
  if (engine.state === "starting") return "Starting the PDF engine…";
  if (engine.state === "stopped") return "The PDF engine is not running.";
  if (engine.state === "applying") return "Applying and checking…";
  return undefined;
}

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

/** A PDF to open: its name, its bytes and their SHA-256, for labelling mode's ground truth. */
export interface PdfSource {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface OpenDocument extends Omit<PdfSource, "bytes"> {
  readonly model: DocumentModel;
}

type Images = ReadonlyMap<PageIndex, ImageData>;

export interface PdfEngine {
  readonly state: WorkerStatus["state"];
  readonly document: OpenDocument | undefined;
  readonly images: Readonly<Record<Source, Images>>;
  readonly texts: ReadonlyMap<PageIndex, PageText>;
  readonly output: Applied | undefined;
  readonly error: EngineError | undefined;
  open(source: PdfSource): void;
  /** Whether the engine can work on `bytes`. */
  inspect: PdfClient["inspect"];
  /** Where each key is in each document's text. */
  match: PdfClient["match"];
  /** Asks for a page's image from `source` at `detail`, and for the original's text, once each. */
  show(source: Source, page: PageIndex, detail?: RenderDetail): void;
  apply(edits: readonly Edit[], appearance: Appearance): void;
  discardOutput(): void;
}

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

const notRunning: ClientError = { code: "worker-not-running" };

/** The PDF worker as the open project's hooks use it, over the engine's client once the engine starts. */
export function useEngine(started: PdfClient | undefined): PdfEngine {
  const client = useRef<PdfClient | undefined>(undefined);
  const picked = useRef({ name: "", sha256: "" });
  // The client acts on the document opened last, so a request from a render made before then
  // must not reach it: it would ask the new document about the old one's pages or marks.
  const opened = useRef<OpenDocument | undefined>(undefined);
  const requested = useRef(new Set<string>());
  // The pages drawn at detail 2, oldest first. One can take some 55 MB at a pixel ratio of 2,
  // so only the latest few are kept; an older one is drawn again if it is shown again.
  const fine = useRef<PageOf[]>([]);
  // False once the marks change while an apply is under way: its output would not match them.
  const outputWanted = useRef(false);
  const [state, setState] = useState<WorkerStatus["state"]>("starting");
  const [document, setDocument] = useState<OpenDocument | undefined>(undefined);
  const [images, setImages] = useState<Record<Source, Images>>(noImages);
  const [texts, setTexts] = useState<ReadonlyMap<PageIndex, PageText>>(new Map());
  const [output, setOutput] = useState<Applied | undefined>(undefined);
  const [error, setError] = useState<EngineError | undefined>(undefined);

  useEffect(() => {
    client.current = started;
    return started?.onStatus((status) => {
      setState(status.state);
      // Once stopped, no output can be trusted to match what is shown.
      if (status.state === "stopped") setOutput(undefined);
      if (status.error !== undefined) setError(status.error);
    });
  }, [started]);

  // Only a sentence the worker wrote about the request is shown: a stale answer, or one after the
  // worker stopped, has nothing to add to what the status already says.
  function showFailure(failure: EngineError) {
    if (failure.message !== undefined) setError(failure);
  }

  function open({ name, bytes, sha256 }: PdfSource) {
    if (client.current === undefined || state === "stopped") return;
    picked.current = { name, sha256 };
    opened.current = undefined;
    requested.current = new Set();
    fine.current = [];
    setDocument(undefined);
    setImages(noImages);
    setTexts(new Map());
    setOutput(undefined);
    setError(undefined);
    void client.current.open(bytes).then((model) => {
      if ("code" in model) showFailure(model);
      else {
        opened.current = { ...picked.current, model };
        setDocument(opened.current);
      }
    });
  }

  function once(key: string, ask: () => void) {
    if (requested.current.has(key)) return;
    requested.current.add(key);
    ask();
  }

  function fetchText(started: PdfClient, page: PageIndex) {
    once(`text:${page}`, () =>
      void started.text(page).then((text) => {
        if ("code" in text) showFailure(text);
        else setTexts((current) => new Map(current).set(page, text));
      }),
    );
  }

  /** Forgets a page's image and that it was asked for, so it is drawn again when next shown. */
  function forget(source: Source, page: PageIndex) {
    for (const detail of DETAILS) requested.current.delete(renderKey(source, page, detail));
    setImages((current) => {
      const images = new Map(current[source]);
      images.delete(page);
      return { ...current, [source]: images };
    });
  }

  function show(source: Source, page: PageIndex, detail: RenderDetail = 1) {
    const started = client.current;
    if (started === undefined || document === undefined || document !== opened.current) return;
    const evicted = detail === 2 && !requested.current.has(renderKey(source, page, 2)) ? makeRoom(fine.current, { source, page }) : undefined;
    if (evicted !== undefined) forget(evicted.source, evicted.page);
    const scale = CSS_PIXELS_PER_POINT * window.devicePixelRatio * detail;
    once(renderKey(source, page, detail), () =>
      void started.render(source, page, scale).then((pixels) => {
        if ("code" in pixels) showFailure(pixels);
        // A page forgotten while its image was on its way, to make room, stays forgotten.
        else if (DETAILS.some((each) => requested.current.has(renderKey(source, page, each)))) setImages((current) => withImage(current, source, page, pixels));
      }),
    );
    if (source !== "original") return;
    fetchText(started, page);
    // The next page's text too, so a selection made with the keys can carry onto it at once.
    const next = page + 1;
    if (isPageIndex(next) && next < document.model.pages.length) fetchText(started, next);
  }

  function apply(edits: readonly Edit[], appearance: Appearance) {
    if (client.current === undefined || document === undefined || document !== opened.current || state !== "ready") return;
    discardOutput();
    setError(undefined);
    outputWanted.current = true;
    void client.current.apply(edits, appearance).then((applied) => {
      if ("code" in applied) showFailure(applied);
      else if (outputWanted.current) setOutput(applied);
    });
  }

  function discardOutput() {
    outputWanted.current = false;
    forgetRequests(requested.current, renderKeysOf("output"));
    fine.current = fine.current.filter((each) => each.source !== "output");
    setImages((current) => ({ ...current, output: new Map() }));
    setOutput(undefined);
  }

  return {
    state,
    document,
    images,
    texts,
    output,
    error,
    open,
    // Asked before the engine starts, nothing would answer.
    inspect: (bytes) => client.current?.inspect(bytes) ?? Promise.resolve(notRunning),
    match: (keys, documents) => client.current?.match(keys, documents) ?? Promise.resolve(notRunning),
    show,
    apply,
    discardOutput,
  };
}

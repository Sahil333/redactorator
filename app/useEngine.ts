import { useEffect, useRef, useState } from "react";
import {
  isAboutOlderFile,
  isFileNumber,
  isInspectionNumber,
  isPageIndex,
  parseEngineMessage,
  type Appearance,
  type DocumentModel,
  type Edit,
  type EngineError,
  type EngineMessage,
  type EngineRequest,
  type FileNumber,
  type InspectionNumber,
  type PageIndex,
  type PageText,
  type Source,
} from "../engine/contract";

// PDF points are 1/72 inch and CSS pixels 1/96 inch, so this shows a page at its printed size.
export const CSS_PIXELS_PER_POINT = 96 / 72;

/** What the engine is doing when that is all there is to say, or undefined while it is ready. */
export function engineStatus(engine: Pick<Engine, "state">): string | undefined {
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

type EngineState = "starting" | "ready" | "applying" | "stopped";

/** A PDF to open: its name, its bytes and their SHA-256, for labelling mode's ground truth. */
export interface PdfSource {
  readonly name: string;
  readonly bytes: ArrayBuffer;
  readonly sha256: string;
}

export interface OpenDocument extends Omit<PdfSource, "bytes"> {
  readonly file: FileNumber;
  readonly model: DocumentModel;
}

/** What inspecting a file found: its page count, or why it cannot be added. */
export type Inspection = { readonly pages: number } | { readonly error: EngineError };

/** A cleaned file that passed the engine's check. */
interface Output {
  readonly bytes: ArrayBuffer;
  readonly model: DocumentModel;
}

type Images = ReadonlyMap<PageIndex, ImageData>;

export interface Engine {
  readonly state: EngineState;
  readonly document: OpenDocument | undefined;
  readonly images: Readonly<Record<Source, Images>>;
  readonly texts: ReadonlyMap<PageIndex, PageText>;
  readonly output: Output | undefined;
  readonly error: string | undefined;
  open(source: PdfSource): void;
  /** Whether the engine can work on `bytes`, which it takes over. */
  inspect(bytes: ArrayBuffer): Promise<Inspection>;
  /** Asks for a page's image from `source` at `detail`, and for the original's text, once each. */
  show(source: Source, page: PageIndex, detail?: RenderDetail): void;
  apply(edits: readonly Edit[], appearance: Appearance): void;
  discardOutput(): void;
}

const noImages = { original: new Map(), output: new Map() } satisfies Record<Source, Images>;

/** Files the engine has been asked to inspect, each waiting for its answer. */
class Inspections {
  private latest = 0;
  private stopped = false;
  private readonly waiting = new Map<InspectionNumber, (inspection: Inspection) => void>();

  ask(send: (inspection: InspectionNumber) => void): Promise<Inspection> {
    const inspection = this.latest + 1;
    // Once the engine has stopped, nothing would ever answer.
    if (this.stopped || !isInspectionNumber(inspection)) return Promise.resolve(notRunning);
    this.latest = inspection;
    return new Promise((resolve) => {
      this.waiting.set(inspection, resolve);
      send(inspection);
    });
  }

  answer(inspection: InspectionNumber, result: Inspection) {
    this.waiting.get(inspection)?.(result);
    this.waiting.delete(inspection);
  }

  stop(message: string) {
    this.stopped = true;
    for (const answer of this.waiting.values()) answer({ error: { code: "bad-message", message } });
    this.waiting.clear();
  }
}

const notRunning: Inspection = { error: { code: "bad-message", message: "The PDF engine is not running. Reload the page to try again." } };

/** The images with a newly drawn page in them. A finer image is kept over a coarser one that arrives after it. */
function withImage(current: Record<Source, Images>, { source, page, image }: Extract<EngineMessage, { type: "rendered" }>) {
  const shown = current[source].get(page);
  if (shown !== undefined && shown.width >= image.width) return current;
  return { ...current, [source]: new Map(current[source]).set(page, image) };
}

export function useEngine(): Engine {
  const workerRef = useRef<Worker | undefined>(undefined);
  // The worker listens only once MuPDF has loaded; anything sent before it says so would be lost.
  const beforeReady = useRef<[EngineRequest, Transferable[]][] | undefined>([]);
  const latestFile = useRef(0);
  const picked = useRef({ name: "", sha256: "" });
  const [inspections] = useState(() => new Inspections());
  const requested = useRef(new Set<string>());
  // The pages drawn at detail 2, oldest first. One can take some 55 MB at a pixel ratio of 2,
  // so only the latest few are kept; an older one is drawn again if it is shown again.
  const fine = useRef<PageOf[]>([]);
  // False once the marks change while an apply is under way: its output would not match them.
  const outputWanted = useRef(false);
  const [state, setState] = useState<EngineState>("starting");
  const [document, setDocument] = useState<OpenDocument | undefined>(undefined);
  const [images, setImages] = useState<Record<Source, Images>>(noImages);
  const [texts, setTexts] = useState<ReadonlyMap<PageIndex, PageText>>(new Map());
  const [output, setOutput] = useState<Output | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const stop = (message: string) => {
      // Fail closed: no later reply can redraw a page or re-enable the picker,
      // and the worker's copy of the document is freed.
      worker.terminate();
      setState("stopped");
      setOutput(undefined);
      setError(message);
      inspections.stop(message);
    };

    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = parseEngineMessage(event.data);
      if (message === undefined) {
        stop("The PDF engine sent something unexpected. Reload the page to try again.");
        return;
      }
      if (isAboutOlderFile(message, latestFile.current)) return;
      switch (message.type) {
        case "ready":
          setState("ready");
          for (const [request, transfer] of beforeReady.current ?? []) worker.postMessage(request, transfer);
          beforeReady.current = undefined;
          break;
        case "inspected":
          inspections.answer(message.inspection, { pages: message.pages });
          break;
        case "refused":
          inspections.answer(message.inspection, { error: message.error });
          break;
        case "opened":
          setDocument({ file: message.file, ...picked.current, model: message.document });
          break;
        case "rendered":
          // A page forgotten while its image was on its way, to make room, stays forgotten.
          if (!DETAILS.some((detail) => requested.current.has(renderKey(message.source, message.page, detail)))) break;
          setImages((current) => withImage(current, message));
          break;
        case "text":
          setTexts((current) => new Map(current).set(message.page, message.text));
          break;
        case "applied":
          setState("ready");
          if (outputWanted.current) setOutput({ bytes: message.bytes, model: message.output });
          break;
        case "error":
          setState((current) => (current === "applying" ? "ready" : current));
          setError(message.error.message);
          break;
      }
    });
    worker.addEventListener("messageerror", () =>
      stop("The PDF engine sent something unreadable. Reload the page to try again."),
    );
    worker.addEventListener("error", () => stop("The PDF engine stopped. Reload the page to try again."));
    return () => worker.terminate();
  }, []);

  function post(request: EngineRequest, transfer: Transferable[] = []) {
    if (beforeReady.current !== undefined) beforeReady.current.push([request, transfer]);
    else workerRef.current?.postMessage(request, transfer);
  }

  function inspect(bytes: ArrayBuffer): Promise<Inspection> {
    return inspections.ask((inspection) => post({ type: "inspect", inspection, bytes }, [bytes]));
  }

  function open({ name, bytes, sha256 }: PdfSource) {
    if (state === "stopped") return;
    const file = latestFile.current + 1;
    if (!isFileNumber(file)) return;
    latestFile.current = file;
    picked.current = { name, sha256 };
    requested.current = new Set();
    fine.current = [];
    // An apply still under way was for the document being left: its reply will be dropped.
    setState((current) => (current === "applying" ? "ready" : current));
    setDocument(undefined);
    setImages(noImages);
    setTexts(new Map());
    setOutput(undefined);
    setError(undefined);
    post({ type: "open", file, bytes }, [bytes]);
  }

  function once(key: string, request: EngineRequest) {
    if (requested.current.has(key)) return;
    requested.current.add(key);
    post(request);
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
    if (document === undefined) return;
    const { file } = document;
    const evicted = detail === 2 && !requested.current.has(renderKey(source, page, 2)) ? makeRoom(fine.current, { source, page }) : undefined;
    if (evicted !== undefined) forget(evicted.source, evicted.page);
    const scale = CSS_PIXELS_PER_POINT * window.devicePixelRatio * detail;
    once(renderKey(source, page, detail), { type: "render", file, source, page, scale });
    if (source !== "original") return;
    once(`text:${page}`, { type: "text", file, page });
    // The next page's text too, so a selection made with the keys can carry onto it at once.
    const next = page + 1;
    if (isPageIndex(next) && next < document.model.pages.length) once(`text:${next}`, { type: "text", file, page: next });
  }

  function apply(edits: readonly Edit[], appearance: Appearance) {
    if (document === undefined || state !== "ready") return;
    discardOutput();
    setError(undefined);
    setState("applying");
    outputWanted.current = true;
    post({ type: "apply", file: document.file, edits, appearance });
  }

  function discardOutput() {
    outputWanted.current = false;
    for (const key of requested.current) if (key.startsWith(renderKeysOf("output"))) requested.current.delete(key);
    fine.current = fine.current.filter((each) => each.source !== "output");
    setImages((current) => ({ ...current, output: new Map() }));
    setOutput(undefined);
  }

  return { state, document, images, texts, output, error, open, inspect, show, apply, discardOutput };
}

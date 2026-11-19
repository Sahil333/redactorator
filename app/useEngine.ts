import { useEffect, useRef, useState } from "react";
import {
  isAboutOlderFile,
  isFileNumber,
  parseEngineMessage,
  type Appearance,
  type DocumentModel,
  type Edit,
  type EngineRequest,
  type FileNumber,
  type PageIndex,
  type PageText,
  type Source,
} from "../engine/contract";

// PDF points are 1/72 inch and CSS pixels 1/96 inch, so this shows a page at its printed size.
export const CSS_PIXELS_PER_POINT = 96 / 72;

type EngineState = "starting" | "ready" | "applying" | "stopped";

export interface OpenDocument {
  readonly file: FileNumber;
  readonly name: string;
  /** Of the bytes the engine opened, for labelling mode's ground truth. */
  readonly sha256: string;
  readonly model: DocumentModel;
}

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
  open(picked: File): Promise<void>;
  /** Asks for a page's image from `source`, and for the original's text, once each. */
  show(source: Source, page: PageIndex): void;
  apply(edits: readonly Edit[], appearance: Appearance): void;
  discardOutput(): void;
}

const noImages = { original: new Map(), output: new Map() } satisfies Record<Source, Images>;

export function useEngine(): Engine {
  const workerRef = useRef<Worker | undefined>(undefined);
  const latestFile = useRef(0);
  const picked = useRef({ name: "", sha256: "" });
  const requested = useRef(new Set<string>());
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
          break;
        case "opened":
          setDocument({ file: message.file, ...picked.current, model: message.document });
          break;
        case "rendered":
          setImages((current) => ({
            ...current,
            [message.source]: new Map(current[message.source]).set(message.page, message.image),
          }));
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

  const post = (request: EngineRequest, transfer: Transferable[] = []) =>
    workerRef.current?.postMessage(request, transfer);

  async function open(chosen: File) {
    if (state !== "ready") return;
    const file = latestFile.current + 1;
    if (!isFileNumber(file)) return;
    latestFile.current = file;
    let bytes: ArrayBuffer;
    let digest: ArrayBuffer;
    try {
      bytes = await chosen.arrayBuffer();
      digest = await crypto.subtle.digest("SHA-256", bytes);
    } catch {
      if (file === latestFile.current) setError("This file could not be read. Choose it again.");
      return;
    }
    // Only the latest pick may reach the worker, so its open document is always the one on screen.
    if (file !== latestFile.current) return;
    // Clear the screen only now: until the worker gets this file it still holds the previous one.
    picked.current = { name: chosen.name, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
    requested.current = new Set();
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

  function show(source: Source, page: PageIndex) {
    if (document === undefined) return;
    const { file } = document;
    const scale = CSS_PIXELS_PER_POINT * window.devicePixelRatio;
    once(`${source}:${page}`, { type: "render", file, source, page, scale });
    if (source === "original") once(`text:${page}`, { type: "text", file, page });
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
    for (const key of requested.current) if (key.startsWith("output:")) requested.current.delete(key);
    setImages((current) => ({ ...current, output: new Map() }));
    setOutput(undefined);
  }

  return { state, document, images, texts, output, error, open, show, apply, discardOutput };
}

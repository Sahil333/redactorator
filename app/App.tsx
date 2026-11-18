import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  isAboutOlderFile,
  isFileNumber,
  parseEngineMessage,
  type DocumentModel,
  type EngineRequest,
} from "../engine/contract";

// PDF points are 1/72 inch and CSS pixels 1/96 inch, so this shows a page at its printed size.
const CSS_PIXELS_PER_POINT = 96 / 72;

type EngineState = "starting" | "ready" | "stopped";

function statusText(engine: EngineState, document: DocumentModel | undefined): string {
  if (engine === "starting") return "Starting the PDF engine…";
  if (engine === "stopped") return "The PDF engine is not running.";
  if (document === undefined) return "Choose a PDF to open.";
  return `Page 1 of ${document.pages.length}`;
}

export function App() {
  const workerRef = useRef<Worker | undefined>(undefined);
  const latestFile = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<EngineState>("starting");
  const [document, setDocument] = useState<DocumentModel | undefined>(undefined);
  const [firstPageImage, setFirstPageImage] = useState<ImageData | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const stop = (message: string) => {
      // Fail closed: no later reply can redraw the page or re-enable the picker,
      // and the worker's copy of the document is freed.
      worker.terminate();
      setEngine("stopped");
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
          setEngine("ready");
          break;
        case "opened": {
          setDocument(message.document);
          const request: EngineRequest = {
            type: "render",
            file: message.file,
            page: message.document.pages[0].index,
            scale: CSS_PIXELS_PER_POINT * window.devicePixelRatio,
          };
          worker.postMessage(request);
          break;
        }
        case "rendered":
          setFirstPageImage(message.image);
          break;
        case "error":
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || firstPageImage === undefined) return;
    canvas.width = firstPageImage.width;
    canvas.height = firstPageImage.height;
    canvas.getContext("2d")?.putImageData(firstPageImage, 0, 0);
  }, [firstPageImage]);

  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    const worker = workerRef.current;
    if (picked === undefined || worker === undefined) return;
    const file = latestFile.current + 1;
    if (!isFileNumber(file)) return;
    latestFile.current = file;
    let bytes: ArrayBuffer;
    try {
      bytes = await picked.arrayBuffer();
    } catch {
      if (file === latestFile.current) setError("This file could not be read. Choose it again.");
      return;
    }
    // Only the latest pick may reach the worker, so its open document is always the one on screen.
    if (file !== latestFile.current) return;
    // Clear the screen only now: until the worker gets this file it still holds the previous one.
    setDocument(undefined);
    setFirstPageImage(undefined);
    setError(undefined);
    const request: EngineRequest = { type: "open", file, bytes };
    worker.postMessage(request, [bytes]);
  }

  const firstPage = document?.pages[0];

  return (
    <main className="flex flex-col items-start gap-3">
      <h1 className="text-3xl font-bold">Redactorator</h1>
      <label>
        Open a PDF{" "}
        <input
          type="file"
          accept="application/pdf"
          disabled={engine !== "ready"}
          onChange={openFile}
          className="text-sm file:mr-2 file:rounded file:border file:border-zinc-400 file:bg-white file:px-2 file:py-1 disabled:opacity-50"
        />
      </label>
      <p role="status">{statusText(engine, document)}</p>
      {error !== undefined && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {firstPage !== undefined && (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Page 1"
          className="max-w-none bg-white shadow"
          style={{
            width: `${firstPage.width * CSS_PIXELS_PER_POINT}px`,
            height: `${firstPage.height * CSS_PIXELS_PER_POINT}px`,
          }}
        />
      )}
    </main>
  );
}

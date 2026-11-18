import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { parseEngineMessage, type DocumentModel, type EngineRequest } from "../engine/contract";

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<EngineState>("starting");
  // One file at a time: until the current file has rendered or failed, a reply
  // could otherwise land after a newer pick and show the wrong document.
  const [opening, setOpening] = useState(false);
  const [document, setDocument] = useState<DocumentModel | undefined>(undefined);
  const [firstPageImage, setFirstPageImage] = useState<ImageData | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = parseEngineMessage(event.data);
      if (message === undefined) {
        setError("The PDF engine sent something unexpected. Reload the page to try again.");
        return;
      }
      switch (message.type) {
        case "ready":
          setEngine("ready");
          break;
        case "opened": {
          setDocument(message.document);
          const request: EngineRequest = {
            type: "render",
            page: message.document.pages[0].index,
            scale: CSS_PIXELS_PER_POINT * window.devicePixelRatio,
          };
          worker.postMessage(request);
          break;
        }
        case "rendered":
          setFirstPageImage(message.image);
          setOpening(false);
          break;
        case "error":
          setError(message.error.message);
          setOpening(false);
          break;
      }
    });
    worker.addEventListener("error", () => {
      setEngine("stopped");
      setError("The PDF engine stopped. Reload the page to try again.");
    });
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
    const file = event.target.files?.[0];
    const worker = workerRef.current;
    if (file === undefined || worker === undefined) return;
    setDocument(undefined);
    setFirstPageImage(undefined);
    setError(undefined);
    setOpening(true);
    try {
      const bytes = await file.arrayBuffer();
      const request: EngineRequest = { type: "open", bytes };
      worker.postMessage(request, [bytes]);
    } catch {
      setOpening(false);
      setError("This file could not be read. Choose it again.");
    }
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
          disabled={engine !== "ready" || opening}
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

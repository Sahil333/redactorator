import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { parseEngineMessage, type DocumentModel, type EngineRequest } from "../engine/contract";

// PDF points are 1/72 inch and CSS pixels 1/96 inch, so this shows a page at its printed size.
const CSS_PIXELS_PER_POINT = 96 / 72;

export function App() {
  const workerRef = useRef<Worker | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [document, setDocument] = useState<DocumentModel | undefined>(undefined);
  const [firstPageImage, setFirstPageImage] = useState<ImageData | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const send = (request: EngineRequest, transfer: Transferable[] = []) =>
      worker.postMessage(request, transfer);

    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = parseEngineMessage(event.data);
      if (message === undefined) {
        setError("The PDF engine sent something unexpected. Reload the page to try again.");
        return;
      }
      switch (message.type) {
        case "ready":
          setEngineReady(true);
          break;
        case "opened": {
          setDocument(message.document);
          const firstPage = message.document.pages[0];
          if (firstPage !== undefined) {
            send({
              type: "render",
              page: firstPage.index,
              scale: CSS_PIXELS_PER_POINT * window.devicePixelRatio,
            });
          }
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
    worker.addEventListener("error", () =>
      setError("The PDF engine could not start. Reload the page to try again."),
    );
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
    const bytes = await file.arrayBuffer();
    const request: EngineRequest = { type: "open", bytes };
    worker.postMessage(request, [bytes]);
  }

  const firstPage = document?.pages[0];

  return (
    <main>
      <h1>Redactorator</h1>
      <label>
        Open a PDF{" "}
        <input type="file" accept="application/pdf" disabled={!engineReady} onChange={openFile} />
      </label>
      <p role="status">
        {!engineReady
          ? "Starting the PDF engine…"
          : document === undefined
            ? "Choose a PDF to open."
            : `Page 1 of ${document.pages.length}`}
      </p>
      {error !== undefined && <p role="alert">{error}</p>}
      {firstPage !== undefined && (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Page 1"
          style={{
            width: `${firstPage.width * CSS_PIXELS_PER_POINT}px`,
            height: `${firstPage.height * CSS_PIXELS_PER_POINT}px`,
          }}
        />
      )}
    </main>
  );
}

import { useState, type DragEvent, type ReactNode, type UIEvent } from "react";

interface DropZoneProps {
  /** Shown above the pages: why the last open or apply failed. */
  readonly error: string | undefined;
  readonly onFile: (file: File) => void;
  readonly onScroll?: (event: UIEvent<HTMLElement>) => void;
  readonly children: ReactNode;
}

/** The centre pane: it scrolls the pages and takes a PDF dropped on it. */
export function DropZone({ error, onFile, onScroll, children }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) onFile(dropped);
  }

  return (
    <main
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onScroll={onScroll}
      className={`flex min-h-0 flex-col overflow-auto bg-paper-sunk ${dragging ? "outline-2 -outline-offset-4 outline-accent outline-dashed" : ""}`}
    >
      {error !== undefined && (
        <p role="alert" className="m-4 mb-0 rounded-md border border-mark/40 bg-fail-wash px-3 py-2 text-mark">
          {error}
        </p>
      )}
      {children}
    </main>
  );
}

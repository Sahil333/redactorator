import { useState, type DragEvent, type ReactNode, type Ref, type UIEvent } from "react";

interface DropZoneProps {
  readonly ref?: Ref<HTMLElement>;
  /** Shown above the content: why the last open, add or apply failed. */
  readonly error: string | undefined;
  readonly onFiles: (files: readonly File[]) => void;
  readonly onScroll?: (event: UIEvent<HTMLElement>) => void;
  readonly children: ReactNode;
}

const isFileEntry = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile;
const isFolderEntry = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory;

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/** A dropped folder's entries. The browser hands them over a batch at a time, until a batch is empty. */
function entriesOf(folder: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = folder.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

/** Every file in a dropped file or folder, folders read all the way down. */
async function filesIn(entry: FileSystemEntry): Promise<File[]> {
  if (isFileEntry(entry)) return [await fileOf(entry)];
  if (isFolderEntry(entry)) return (await Promise.all((await entriesOf(entry)).map(filesIn))).flat();
  return [];
}

/**
 * The files dropped, with each dropped folder's files in place of the folder. The entries must be
 * taken while the drop event runs; the browser empties the drop once it returns.
 */
function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const files = [...transfer.files];
  const items = [...transfer.items].filter((item) => item.kind === "file").map((item) => item.webkitGetAsEntry() ?? item.getAsFile());
  return Promise.all(items.map((item) => (item === null ? [] : item instanceof File ? [item] : filesIn(item)))).then(
    (lists) => lists.flat(),
    () => files,
  );
}

/** The centre pane: it scrolls its content and takes PDFs, and folders of them, dropped on it. */
export function DropZone({ ref, error, onFiles, onScroll, children }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void droppedFiles(event.dataTransfer).then((dropped) => {
      if (dropped.length > 0) onFiles(dropped);
    });
  }

  return (
    <main
      ref={ref}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onScroll={onScroll}
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-paper-sunk ${dragging ? "outline-2 -outline-offset-4 outline-accent outline-dashed" : ""}`}
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

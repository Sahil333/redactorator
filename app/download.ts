import { writeWhole } from "./storage";

// Chrome's save dialog, which TypeScript's DOM types leave out.
declare global {
  interface Window {
    showSaveFilePicker(options: {
      readonly suggestedName: string;
      readonly types: readonly { readonly description: string; readonly accept: Record<string, readonly string[]> }[];
    }): Promise<FileSystemFileHandle>;
  }
}

/** The picked file's name without its .pdf ending, to name what the app saves. */
export const baseName = (name: string) => name.replace(/\.pdf$/i, "");

/** Saves `blob` as a download made in this browser: nothing is uploaded. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Saves a PDF where the user picks in Chrome's save dialog, and says whether it was saved:
 * false when they cancel. Unlike a download, this knows the file landed. Nothing is uploaded.
 */
export async function savePdf(pdf: Blob, name: string): Promise<boolean> {
  let file: FileSystemFileHandle;
  try {
    file = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    throw error;
  }
  await writeWhole(file, pdf);
  return true;
}

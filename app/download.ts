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

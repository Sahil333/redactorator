import type { InspectionNumber } from "../pdf-protocol/messages";
import { placedImages } from "./images";
import { post } from "./messages";
import { load } from "./read";
import { pageText, withPage } from "./text";

/** Whether a file can be added, and if so what the project keeps of it: its pages' text and images. */
export function inspect(inspection: InspectionNumber, bytes: ArrayBuffer): void {
  const loaded = load(bytes);
  if ("code" in loaded) {
    post({ type: "refused", inspection, error: loaded });
    return;
  }
  const { document, model } = loaded;
  try {
    const [first, ...rest] = model.pages.map((page) => withPage(document, page.index, pageText));
    if (first === undefined) throw new Error("No pages");
    const images = model.pages.flatMap((page) => withPage(document, page.index, (loadedPage) => placedImages(loadedPage, page.index)));
    post({ type: "inspected", inspection, reading: { texts: [first, ...rest], images } });
  } catch {
    post({ type: "refused", inspection, error: { code: "text-failed", message: "The pages of this PDF could not be read. Choose another file." } });
  } finally {
    document.destroy();
  }
}

import type { DocumentHandle } from "../../../api/state";
import type { PageText } from "../../../model/document";
import type { PageIndex } from "../../../model/geometry";
import type { SessionChange } from "../changes";

export interface ViewerPart {
  /** The document open in the PDF worker; undefined while one opens, or when none could be. */
  readonly handle: DocumentHandle | undefined;
  /** Its pages' text, as each arrives. */
  readonly texts: ReadonlyMap<PageIndex, PageText>;
}

export const firstViewer: ViewerPart = { handle: undefined, texts: new Map() };

/** The open document and its page texts. */
export function viewer(part: ViewerPart, change: SessionChange): ViewerPart {
  switch (change.type) {
    case "opening":
      return part.handle === undefined && part.texts.size === 0 ? part : firstViewer;
    case "opened":
      return { handle: change.handle, texts: new Map() };
    case "pageTextLoaded":
      return change.handle === part.handle ? { ...part, texts: new Map(part.texts).set(change.page, change.text) } : part;
    default:
      return part;
  }
}

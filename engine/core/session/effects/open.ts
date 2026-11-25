import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { DocumentHandle } from "../../../api/state";
import type { PageText } from "../../../model/document";
import type { PageIndex } from "../../../model/geometry";
import type { DocumentId } from "../../../model/project";
import { READER_TAG } from "../../../pdf-protocol/messages";
import type { PdfClient } from "../../pdf-client/client";
import { findOriginal, readWorking } from "../../stored/projects";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";
import { validOutput } from "../selectors";
import { imagesOf, type ReadingSource } from "./readings";

/** What the open document's commands use: the Session's state and gate, its project's store, and the PDF worker. */
interface ViewerHost {
  readonly source: ReadingSource & { readonly client: PdfClient };
  view(): SessionView | undefined;
  allowed(command: "open" | "query", document?: DocumentId): Result<SessionView>;
  dispatch(change: SessionChange): void;
}

export const staleHandle: Result<never> = { ok: false, error: { code: "stale-handle" } };

const busyUpdating: Result<never> = { ok: false, error: { code: "busy-updating" } };

/**
 * The open document: opening its working copy in the PDF worker, and its pages' images and text.
 * Each page's text is fetched once while its document is open, and kept in the state for
 * `marks.add`. The user's own file is never opened: a document whose working copy is missing is
 * prepared again first.
 */
export function viewerOf({ source, view, allowed, dispatch }: ViewerHost): Session["viewer"] {
  const { store, folder, client } = source;
  // Each open is numbered, so one overtaken by a newer open never lands.
  let latest = 0;
  let texts = new Map<PageIndex, Promise<Result<PageText>>>();
  const isOpen = (handle: DocumentHandle) => view()?.parts.viewer.handle === handle;
  const isLatest = (asked: number) => asked === latest && view() !== undefined;

  async function fetchText(handle: DocumentHandle, page: PageIndex): Promise<Result<PageText>> {
    const text = await client.text(page);
    if ("code" in text) return { ok: false, error: text };
    dispatch({ type: "pageTextLoaded", handle, page, text });
    return isOpen(handle) ? { ok: true, value: text } : staleHandle;
  }

  return {
    async open(document) {
      const at = allowed("open", document);
      if (!at.ok) return at;
      const asked = ++latest;
      texts = new Map();
      const record = at.value.parts.record.present.project.documents.find(({ id }) => id === document);
      dispatch({ type: "opening", document });
      if (record === undefined) return staleHandle;
      const failed = source.failed(document);
      let bytes: Uint8Array<ArrayBuffer> | undefined;
      let original: boolean;
      try {
        bytes = failed ? undefined : await readWorking(store, folder, READER_TAG, record);
        original = bytes !== undefined || (await findOriginal(store, folder, record)) !== undefined;
      } catch {
        original = false;
      }
      if (!original) return { ok: false, error: { code: "original-missing", data: { file: record.file } } };
      // Its stale copy is never opened: one that could not be prepared again stays shut.
      if (failed) return { ok: false, error: { code: "prepare-failed" } };
      if (bytes === undefined) {
        source.unavailable();
        return busyUpdating;
      }
      if (!isLatest(asked)) return staleHandle;
      const model = await client.open(bytes);
      if ("code" in model) return { ok: false, error: model };
      if (!isLatest(asked)) return staleHandle;
      const handle: DocumentHandle = { document, pages: model.pages };
      dispatch({ type: "opened", handle });
      return { ok: true, value: handle };
    },
    async render(handle, from, page, scale) {
      const at = allowed("query");
      if (!at.ok) return at;
      const output = validOutput(at.value);
      if (from === "output" && output === undefined) return staleHandle;
      // Once the output is out of date, its pages are no longer drawn, and late ones are dropped.
      const current = () => {
        const now = view();
        return now?.parts.viewer.handle === handle && (from === "original" || validOutput(now) === output);
      };
      if (!current()) return staleHandle;
      const pixels = await client.render(from, page, scale);
      if ("code" in pixels) return { ok: false, error: pixels };
      return current() ? { ok: true, value: pixels } : staleHandle;
    },
    pageText(handle, page) {
      const at = allowed("query");
      if (!at.ok) return Promise.resolve(at);
      if (!isOpen(handle)) return Promise.resolve(staleHandle);
      const asked = texts.get(page) ?? fetchText(handle, page);
      texts.set(page, asked);
      return asked;
    },
    async images(document) {
      const at = allowed("query", document);
      if (!at.ok) return at;
      const record = at.value.parts.record.present.project.documents.find(({ id }) => id === document);
      try {
        return { ok: true, value: record && (await imagesOf(source, record)) };
      } catch {
        // Unread, the images are only not shown as such; spreading reads them again.
        return { ok: true, value: undefined };
      }
    },
  };
}

// Preparing documents again for this build: the only code that does. A document's working copy,
// text and images in the tag folder are derived from its original, so any that is missing or
// damaged is made again, and its marks are placed again on the text it now has
// (docs/designs/pdf-leak-suite.md, parts 3 and 4).
import type { PageText, RemovalKind } from "../../../model/document";
import { readerErrorCodes, type ReaderErrorCode } from "../../../model/errors";
import { isPageIndex, type PageIndex } from "../../../model/geometry";
import type { Mark } from "../../../model/marks";
import type { DocumentId, ProjectDocument } from "../../../model/project";
import { reanchor } from "../../../model/textAnchor";
import { READER_TAG } from "../../../pdf-protocol/messages";
import type { Store } from "../../../storage/store";
import { sha256 } from "../../hash";
import type { PdfClient } from "../../pdf-client/client";
import { findOriginal, readImages, readTexts, readWorking, savePrepared } from "../../stored/projects";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";

interface UpdateHost {
  readonly store: Store;
  readonly folder: string;
  readonly client: Pick<PdfClient, "prepare">;
  view(): SessionView | undefined;
  dispatch(change: SessionChange, ...effects: (() => void)[]): void;
  /** Dispatches a change to the project record, which saves it. */
  change(change: SessionChange): void;
  /** Saves now; resolves once every change so far is written. */
  flush(): Promise<boolean>;
  /** Runs once the update has finished, with the documents it made again. */
  updated(documents: ReadonlySet<DocumentId>): void;
}

const pagesOf = (texts: readonly PageText[]): ReadonlyMap<PageIndex, PageText> =>
  new Map(texts.flatMap((text, index) => (isPageIndex(index) ? [[index, text] as const] : [])));

/** A document's marks placed again on `texts`, and the ids of those that could not be; the same array when none moved. */
function placed(marks: readonly Mark[], texts: readonly PageText[]): { readonly marks: readonly Mark[]; readonly lost: readonly number[] } {
  const pages = pagesOf(texts);
  const lost: number[] = [];
  let moved = false;
  const again = marks.map((mark): Mark => {
    if (mark.target.kind !== "text") return mark;
    const target = reanchor(mark.target, pages);
    if (target === "lost") {
      lost.push(mark.id);
      return mark;
    }
    moved ||= target !== mark.target;
    return target === mark.target ? mark : { ...mark, target };
  });
  return { marks: moved ? again : marks, lost };
}

const sameKinds = (a: readonly RemovalKind[], b: readonly RemovalKind[]) => a.length === b.length && a.every((kind, index) => kind === b[index]);

/** A document's prepared files in the tag folder, or undefined when one is missing or damaged. */
export async function preparedFilesOf(store: Store, folder: string, document: ProjectDocument) {
  const [texts, images, working] = await Promise.all([
    readTexts(store, folder, READER_TAG, document),
    readImages(store, folder, READER_TAG, document),
    readWorking(store, folder, READER_TAG, document),
  ]);
  if (texts === undefined || typeof texts === "string" || texts.removed === undefined || !Array.isArray(images) || working === undefined) return undefined;
  return { texts: texts.pages, removed: texts.removed, working };
}

/** Dispatches what a document's prepared files say: its removed kinds and lost marks, and its marks placed again when they moved. */
export function anchorDocument(
  host: Pick<UpdateHost, "dispatch" | "change">,
  document: ProjectDocument,
  { texts, removed }: { readonly texts: readonly PageText[]; readonly removed: readonly RemovalKind[] },
  workingChanged: boolean,
): void {
  const again = placed(document.marks, texts);
  host.dispatch({ type: "documentPrepared", document: document.id, removed, lost: again.lost });
  if (workingChanged || again.marks !== document.marks) host.change({ type: "reanchored", document: document.id, marks: again.marks, workingChanged });
}

/** Why the worker refused to prepare a document again; any failure that is not the reader's own counts as preparation failing. */
const readerCode = (code: string): ReaderErrorCode => readerErrorCodes.find((each) => each === code) ?? "prepare-failed";

/**
 * The update: `update()` prepares again, one at a time, every document whose files in the tag
 * folder are missing or damaged, then saves the project. One that fails is marked failed, and the
 * rest carry on. A second call while one runs waits for it; `settled` resolves once none runs.
 */
export function updaterOf(host: UpdateHost) {
  const { store, folder, client, view, dispatch } = host;
  let underWay: Promise<void> | undefined;

  async function reprepare(document: ProjectDocument): Promise<void> {
    const failed = (code: ReaderErrorCode) => dispatch({ type: "preparationFailed", document: document.id, code });
    const original = await findOriginal(store, folder, document);
    if (original === undefined) return failed("open-failed");
    // What was stored before, read on its own: the files may be here in part.
    const [texts, working] = await Promise.all([
      readTexts(store, folder, READER_TAG, document).catch(() => undefined),
      readWorking(store, folder, READER_TAG, document).catch(() => undefined),
    ]);
    const removedBefore = texts === undefined || typeof texts === "string" ? undefined : texts.removed;
    const prepared = await client.prepare(original);
    if ("code" in prepared) return failed(readerCode(prepared.code));
    try {
      await savePrepared(store, folder, READER_TAG, document.id, prepared);
    } catch {
      return failed("prepare-failed");
    }
    const workingChanged =
      working === undefined || removedBefore === undefined || !sameKinds(removedBefore, prepared.removed) || (await sha256(working)) !== (await sha256(prepared.preparedBytes));
    // The record may have changed while the worker prepared, so the marks placed are its latest.
    const latest = view()?.parts.record.present.project.documents.find(({ id }) => id === document.id);
    if (latest !== undefined) anchorDocument(host, latest, { texts: prepared.reading.texts, removed: prepared.removed }, workingChanged);
  }

  async function run(): Promise<void> {
    const remade = new Set<DocumentId>();
    try {
      for (const document of view()?.parts.record.present.project.documents ?? []) {
        if ((await preparedFilesOf(store, folder, document).catch(() => undefined)) !== undefined) continue;
        remade.add(document.id);
        await reprepare(document).catch(() => dispatch({ type: "preparationFailed", document: document.id, code: "prepare-failed" }));
      }
    } finally {
      dispatch({ type: "updateFinished" });
      await host.flush();
      host.updated(remade);
    }
  }

  return {
    update(): Promise<void> {
      underWay ??= new Promise<void>((resolve) => dispatch({ type: "updateStarted" }, () => resolve(run()))).finally(() => {
        underWay = undefined;
      });
      return underWay;
    },
    settled: () => underWay ?? Promise.resolve(),
  };
}

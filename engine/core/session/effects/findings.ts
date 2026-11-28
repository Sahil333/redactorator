import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { RunRecord } from "../../../model/detection";
import type { PageText } from "../../../model/document";
import { findingMarks } from "../../../model/findingMarks";
import type { DroppedReason, Finding, FindingChange, Hit } from "../../../model/findings";
import { markedAgain } from "../../../model/marks";
import type { DocumentId } from "../../../model/project";
import { resolve } from "../../../model/resolver";
import { readsAt } from "../../../model/textAnchor";
import { READER_TAG } from "../../../pdf-protocol/messages";
import { hitsJson, runJson, stateJson } from "../../formats/findings";
import { findingsFiles, type StoredFindings } from "../../stored/findings";
import { recordsIn } from "../../stored/projects";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";
import { storedTexts, type ReadingSource } from "./readings";
import { pagesOf } from "./reprepare";

/** What a findings review uses: the Session's state, gate and project's stored page texts, how changes land, and how its files are written. */
interface FindingsHost {
  readonly source: ReadingSource;
  view(): SessionView | undefined;
  allowed(command: "findings" | "confirmFindings" | "closeFindings" | "dismissNotice", document?: DocumentId): Result<SessionView>;
  dispatch(change: SessionChange): void;
  /** Dispatches a change to the project record, which saves it. */
  change(change: SessionChange): void;
  /** Writes `content` to the findings file at `path`, or removes it when undefined, after every write asked for so far. */
  file(path: string, content: string | undefined): void;
  /** Saves now; resolves once every change so far is written: true if they all landed. */
  flush(): Promise<boolean>;
}

/** The findings review's part that the Session's other effects call: runs that start and end, stored reviews, and records that changed a document's marks. */
export interface FindingsReview {
  /** A run is starting: a stored notice goes, and so does a state file of an earlier run. */
  started(document: DocumentId): void;
  /**
   * Stores `record`, and opens a findings review on what its run found, or leaves a notice when
   * there is nothing to offer or it failed before any page answered.
   */
  ended(document: DocumentId, record: RunRecord, hits: readonly Hit[]): void;
  /** Opens the findings review `stored` holds, once `texts` are the document's prepared page texts; or shows its stored notice. Runs nothing. */
  reopened(document: DocumentId, stored: StoredFindings, texts: readonly PageText[]): void;
  /** Resolves again each open findings review whose document's marks `change` changed from outside the panel. */
  landed(change: SessionChange): void;
  /** Resolves once no confirm is under way. */
  settled(): Promise<unknown>;
}

type Confirmed = Awaited<ReturnType<Session["findings"]["confirm"]>>;

const done: Result<void> = { ok: true, value: undefined };
const noFindings: Result<never> = { ok: false, error: { code: "no-findings" } };
const unknownFinding: Result<never> = { ok: false, error: { code: "unknown-finding" } };
const dropped: Result<never> = { ok: false, error: { code: "findings-dropped" } };
const closed: Result<never> = { ok: false, error: { code: "session-closed" } };
const confirmFailed: Result<never> = { ok: false, error: { code: "confirm-failed" } };

const documentIn = (view: SessionView, document: DocumentId) => view.parts.record.present.project.documents.find(({ id }) => id === document);

/** The findings of `hits` in `document` as `view` holds it: against its marks that are not lost, and its rejected values. */
function findingsIn(view: SessionView, document: DocumentId, hits: readonly Hit[], changes: ReadonlyMap<string, FindingChange>): readonly Finding[] {
  const record = documentIn(view, document);
  const lost = new Set(view.parts.documents.get(document)?.lost);
  const marks = record?.marks.filter(({ id }) => !lost.has(id)) ?? [];
  return resolve({ hits, marks, rejected: record?.rejected ?? [], changes });
}

/** The documents whose marks `change` changed from outside a findings review: an approval that spread marks in, and marks placed again. */
function marksChangedBy(change: SessionChange): readonly DocumentId[] {
  switch (change.type) {
    case "approved":
      return change.changedDocuments;
    case "documentPrepared":
    case "reanchored":
      return [change.document];
    default:
      return [];
  }
}

/** How a stored run ended: as its run record says, or, should that record be another run's, as its pages not searched suggest. */
function endedOf({ hits, record }: StoredFindings & { readonly hits: NonNullable<StoredFindings["hits"]> }): RunRecord["ended"] {
  if (record?.run === hits.run) return record.ended;
  return hits.notSearched.length === 0 ? "finished" : "stopped";
}

/**
 * A document's findings review, behind the gate: ticking its findings, confirming it into marks and
 * rejected values, closing it, and dismissing a stored notice. It keeps the review in the reader
 * folder: the hits once, the state on each change, and the run record of every run; and deletes
 * them in the orders of section 5. Picking candidates and moving edges come with slice R3; until
 * then those commands refuse.
 */
export function findingsOf({ source, allowed, view, dispatch, change, file, flush }: FindingsHost): Session["findings"] & FindingsReview {
  let underWay: Promise<unknown> = Promise.resolve();
  const filesOf = (document: DocumentId) => findingsFiles(recordsIn(source.folder, READER_TAG), document);

  const refused = (command: Parameters<FindingsHost["allowed"]>[0], document: DocumentId): Result<never> => {
    const at = allowed(command, document);
    return at.ok ? noFindings : at;
  };

  /** Stores the open findings review's state: its run, and the user's changes. */
  function storeState(document: DocumentId) {
    const open = view()?.parts.findings.get(document);
    if (open !== undefined) file(filesOf(document).state, stateJson({ kind: "open", run: open.run, changes: open.changes }));
  }

  /** Deletes a findings review's files: the hits, then the state, so a crash between leaves a state file no hits file matches, which is ignored. */
  function forget(document: DocumentId) {
    const files = filesOf(document);
    file(files.hits, undefined);
    file(files.state, undefined);
  }

  /** Drops a findings review: its state file becomes the notice, and its hits go. Nothing is marked. */
  function drop(document: DocumentId, reason: DroppedReason) {
    const files = filesOf(document);
    file(files.state, stateJson({ kind: "dropped", reason }));
    file(files.hits, undefined);
    dispatch({ type: "noticeSet", document, notice: { kind: "dropped", reason } });
  }

  /** Runs the resolver on `document`'s open findings review; one with no findings left ends by itself. */
  function resolveAgain(document: DocumentId) {
    const now = view();
    const open = now?.parts.findings.get(document);
    if (now === undefined || open === undefined) return;
    const findings = findingsIn(now, document, open.hits, open.changes);
    if (findings.length > 0) {
      dispatch({ type: "findingsResolved", document, findings });
      return;
    }
    dispatch({ type: "findingsClosed", document });
    forget(document);
  }

  /**
   * Confirm's steps 2 to 5 (Technical Plan, section 4), once `findingsApplying` began the
   * operation: tests every hit against the stored page texts, builds one mark per place of each
   * ticked finding, lands them with the rejected values, and once the project is saved deletes
   * the review's files. Every way out ends the operation.
   */
  async function marking(document: DocumentId): Promise<Confirmed> {
    const before = view();
    const record = before && documentIn(before, document);
    const texts = record === undefined ? noFindings : await storedTexts(source, record);
    const now = view();
    if (now === undefined) return closed;
    const open = now.parts.findings.get(document);
    const latest = documentIn(now, document);
    if (!texts.ok || open === undefined || latest === undefined) {
      dispatch({ type: "findingsNotApplied", document });
      if (!texts.ok && texts.error.code === "busy-updating") source.unavailable();
      return texts.ok ? noFindings : texts;
    }
    const pages = pagesOf(texts.value);
    const marks = open.hits.every((hit) => readsAt(pages, hit)) ? findingMarks(pages, open.findings, latest.marks) : undefined;
    if (marks === undefined) {
      dispatch({ type: "findingsNotApplied", document });
      dispatch({ type: "findingsClosed", document });
      drop(document, "text-changed");
      return dropped;
    }
    const lostIds = new Set(now.parts.documents.get(document)?.lost);
    const lost = latest.marks.filter(({ id }) => lostIds.has(id));
    const replaces = [...new Set(marks.flatMap(({ target }) => markedAgain(lost, target)))];
    const rejected = open.findings.flatMap(({ key, ticked }) => (ticked ? [] : [key]));
    const values = open.findings.length - rejected.length;
    change({ type: "findingsApplied", document, values, marks, replaces, rejected });
    // Until the project holds the marks and rejected values, the stored review is what keeps them.
    // A later run may have opened a review of its own on the document while the save was written.
    if ((await flush()) && view()?.parts.findings.has(document) === false) forget(document);
    return { ok: true, value: { values, marks: marks.length } };
  }

  return {
    setTicked(document, key, ticked) {
      const at = allowed("findings", document);
      if (!at.ok) return at;
      if (!at.value.parts.findings.get(document)?.findings.some((finding) => finding.key === key)) return unknownFinding;
      dispatch({ type: "findingChanged", document, key, change: { ticked } });
      resolveAgain(document);
      storeState(document);
      return done;
    },
    choose: (document) => refused("findings", document),
    setEdges: (document) => refused("findings", document),
    confirm(document) {
      const at = allowed("confirmFindings", document);
      if (!at.ok) return Promise.resolve(at);
      dispatch({ type: "findingsApplying", document });
      const confirmed = marking(document).catch((): Confirmed => {
        // A fault in building the marks ends the operation, with nothing marked and nothing deleted.
        if (view()?.parts.operation.operation === "marking") dispatch({ type: "findingsNotApplied", document });
        return confirmFailed;
      });
      underWay = confirmed;
      return confirmed;
    },
    close(document) {
      const at = allowed("closeFindings", document);
      if (!at.ok) return Promise.resolve(at);
      dispatch({ type: "findingsClosed", document });
      forget(document);
      return Promise.resolve(done);
    },
    dismissNotice(document) {
      const at = allowed("dismissNotice", document);
      if (!at.ok) return at;
      const notice = at.value.parts.detection.get(document)?.notice;
      if (notice === undefined) return done;
      dispatch({ type: "noticeDismissed", document });
      if (notice.kind === "dropped") file(filesOf(document).state, undefined);
      return done;
    },
    settled: () => underWay,
    started(document) {
      file(filesOf(document).state, undefined);
    },
    ended(document, record, hits) {
      const files = filesOf(document);
      file(files.run, runJson(record));
      const now = view();
      // A run the Session's closing stopped loses its hits, as a reload does.
      if (now === undefined || now.parts.operation.closing) return;
      const { run, ended, code, notSearched, pages } = record;
      if (code !== undefined && notSearched.length === pages) {
        dispatch({ type: "noticeSet", document, notice: { kind: "run-failed", code } });
        return;
      }
      const changes = new Map<string, FindingChange>();
      const findings = findingsIn(now, document, hits, changes);
      if (findings.length === 0) {
        dispatch({ type: "noticeSet", document, notice: { kind: "nothing-found", ended, notSearched } });
        return;
      }
      file(files.hits, hitsJson({ run, notSearched, hits }));
      file(files.state, stateJson({ kind: "open", run, changes }));
      dispatch({ type: "findingsOpened", document, run, hits, ended, notSearched, changes, findings });
    },
    reopened(document, stored, texts) {
      const now = view();
      if (now === undefined) return;
      const { hits, state } = stored;
      if (hits === undefined) {
        if (state?.kind === "dropped") dispatch({ type: "noticeSet", document, notice: { kind: "dropped", reason: state.reason } });
        return;
      }
      const pages = pagesOf(texts);
      if (!hits.hits.every((hit) => readsAt(pages, hit))) {
        drop(document, "text-changed");
        return;
      }
      // A state file of another run is ignored, so unticks never carry into a run the user didn't review.
      const changes = state?.kind === "open" && state.run === hits.run ? state.changes : new Map<string, FindingChange>();
      const findings = findingsIn(now, document, hits.hits, changes);
      if (findings.length === 0) {
        forget(document);
        return;
      }
      dispatch({ type: "findingsOpened", document, run: hits.run, hits: hits.hits, ended: endedOf({ ...stored, hits }), notSearched: hits.notSearched, changes, findings });
    },
    landed(change) {
      for (const document of marksChangedBy(change)) resolveAgain(document);
    },
  };
}

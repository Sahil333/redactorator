import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import { profilePacks, type Profile, type RunRecord } from "../../../model/detection";
import type { PageText } from "../../../model/document";
import type { Hit } from "../../../model/findings";
import { isPageIndex, type PageIndex } from "../../../model/geometry";
import type { DocumentId, ProjectDocument } from "../../../model/project";
import { READER_TAG } from "../../../pdf-protocol/messages";
import type { DetectionClient } from "../../detect-client/client";
import { findOriginal, readTexts } from "../../stored/projects";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";
import type { FindingsReview } from "./findings";
import type { ReadingSource } from "./readings";

/** What a run of Auto mode uses: the Session's gate, its project's stored page texts, how changes land, the detection worker, and the findings review it hands an ended run to. */
interface DetectionHost {
  readonly source: ReadingSource;
  allowed(command: "run" | "stop", document?: DocumentId): Result<SessionView>;
  dispatch(change: SessionChange): void;
  readonly client: DetectionClient;
  readonly ended: FindingsReview["ended"];
}

type Pages = Parameters<DetectionClient["run"]>[0]["pages"];
type Ended = Awaited<ReturnType<DetectionClient["run"]>>;

const done: Result<void> = { ok: true, value: undefined };
const noProfile: Result<never> = { ok: false, error: { code: "no-profile" } };
const busyUpdating: Result<never> = { ok: false, error: { code: "busy-updating" } };
// The client resolves every run; a rejection is a fault in it, and ends the run as the worker failing would.
const failed: Ended = { ended: "failed", code: "detector-failed", packs: [] };

/**
 * A page's characters as the detection worker takes them: one per `PageText.chars` entry, in
 * order, so a hit's indexes are the page's own; "\n" where the character has no box, else its
 * `c`. The worker reads a hit's `text` with `rangeText`, which reads a boxless character as a
 * space, so it equals `rangeText` over the stored page, the test a stored hit must pass later.
 */
const workerChars = ({ chars }: PageText): string[] => chars.map(({ c, box }) => (box === undefined ? "\n" : c));

/**
 * `document`'s page texts as this build stored them, each page as the characters the client
 * sends. Missing or damaged texts start the update that prepares the document again; a document
 * whose original is gone cannot be prepared, and says so.
 */
async function storedPages(source: ReadingSource, document: ProjectDocument): Promise<Result<Pages>> {
  const { store, folder } = source;
  const missing: Result<never> = { ok: false, error: { code: "original-missing", data: { file: document.file } } };
  try {
    const texts = await readTexts(store, folder, READER_TAG, document);
    if (texts !== undefined && typeof texts !== "string") {
      return { ok: true, value: texts.pages.flatMap((text, index) => (isPageIndex(index) ? [{ index, chars: workerChars(text) }] : [])) };
    }
    if ((await findOriginal(store, folder, document)) === undefined) return missing;
  } catch {
    // As opening the document does: a folder that cannot be read is told as its original missing.
    return missing;
  }
  source.unavailable();
  return busyUpdating;
}

function hitsPerRule(hits: readonly Hit[]): RunRecord["hitsPerRule"] {
  const counts = new Map<string, number>();
  for (const { rule } of hits) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return Object.fromEntries(counts);
}

/**
 * Runs of Auto mode, behind the gate: one at a time in a project, each searching one document's
 * stored page texts page by page in the detection worker. The pages that answered keep their hits
 * however the run ends; a run that failed before any did leaves the `run-failed` notice. `end`
 * stops a run and ends the worker, as the Session closes, and resolves once that run has ended.
 */
export function detectionOf({ source, allowed, dispatch, client, ended }: DetectionHost): Session["detection"] & { end(): Promise<void> } {
  let underWay: Promise<void> = Promise.resolve();

  async function search(document: DocumentId, profile: Profile, pages: Pages): Promise<void> {
    const run = crypto.randomUUID();
    dispatch({ type: "runStarted", document, run, pages: pages.length });
    const hits: Hit[] = [];
    const searched = new Set<PageIndex>();
    let errors = 0;
    let answering = true;
    const result = await client
      .run({
        packs: profilePacks(profile),
        pages,
        onPage(page) {
          if (!answering) return;
          for (const each of page.hits) hits.push(each);
          errors += page.errors;
          searched.add(page.page);
          dispatch({ type: "pageSearched", document, ...page });
        },
      })
      .catch(() => failed);
    answering = false;
    const notSearched = pages.flatMap(({ index }) => (searched.has(index) ? [] : [index]));
    const record: RunRecord = { run, ...result, profile, pages: pages.length, notSearched, hitsPerRule: hitsPerRule(hits), errors };
    dispatch({ type: "runEnded", document, record });
    if (searched.size === 0 && result.code !== undefined) dispatch({ type: "noticeSet", document, notice: { kind: "run-failed", code: result.code } });
    else ended(document, record, hits);
  }

  return {
    async run(document, profile) {
      const at = allowed("run", document);
      if (!at.ok) return at;
      const { project } = at.value.parts.record.present;
      const chosen = profile ?? project.profile;
      const record = project.documents.find(({ id }) => id === document);
      if (chosen === undefined) return noProfile;
      if (record === undefined) return { ok: false, error: { code: "unknown-document" } };
      const pages = await storedPages(source, record);
      if (!pages.ok) return pages;
      // Another run, an approval or an update may have begun while the texts were read.
      const again = allowed("run", document);
      if (!again.ok) return again;
      underWay = search(document, chosen, pages.value);
      return done;
    },
    stop(document) {
      const at = allowed("stop", document);
      if (!at.ok) return at;
      if (at.value.parts.detection.get(document)?.run.state === "running") client.stop();
      return done;
    },
    end() {
      client.stop();
      return underWay;
    },
  };
}

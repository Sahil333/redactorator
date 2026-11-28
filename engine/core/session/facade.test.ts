import { describe, expect, test, vi } from "vitest";
import type { DocumentHandle } from "../../api/state";
import type { PackId, Profile } from "../../model/detection";
import type { PageChar, PageModel, PageText } from "../../model/document";
import type { Evidence, Hit } from "../../model/findings";
import { isPageIndex, isPoints, pointBox, type Box, type PageIndex } from "../../model/geometry";
import type { Mark } from "../../model/marks";
import { findAll, keyOf } from "../../model/match";
import { rangeText } from "../../model/pageText";
import { textTarget } from "../../model/selection";
import { defaultSettings, newDocumentId, type Project, type ProjectDocument } from "../../model/project";
import { READER_TAG } from "../../pdf-protocol/messages";
import type { Store } from "../../storage/store";
import { notStarted, type DetectionClient } from "../detect-client/client";
import type { PdfClient } from "../pdf-client/client";
import type { ClientError } from "../pdf-client/errors";
import { savePrepared } from "../stored/projects";
import type { SessionChange } from "./changes";
import { openSession, type OpenSession, type SessionHost } from "./facade";
import { firstParts, session as reduce } from "./slices";

const nothing = (): Promise<ClientError> => Promise.resolve({ code: "worker-not-running" });
// marks.add needs neither: it works from the page texts the Session already holds.
const client: PdfClient = { onStatus: () => () => undefined, prepare: nothing, match: nothing, open: nothing, render: nothing, text: nothing, apply: nothing };
const store: Store = { read: () => Promise.resolve(undefined), write: () => Promise.resolve(), folders: () => Promise.resolve([]), files: () => Promise.resolve([]), remove: () => Promise.resolve() };

/** The one page of the documents here, and a box on it. */
function onePage(): PageModel & { readonly box: Box } {
  const [index, width, height] = [0, 612, 792];
  const box = pointBox(72, 100, 80, 110);
  if (!isPageIndex(index) || !isPoints(width) || !isPoints(height) || box === undefined) throw new Error("A bad page");
  return { index, width, height, box };
}
const { box, ...page } = onePage();

/** A project of one one-page document, "a.pdf", with `marks`; and that document. */
function projectWith(marks: ProjectDocument["marks"]): { readonly project: Project; readonly document: ProjectDocument } {
  const document: ProjectDocument = { id: newDocumentId(), file: "a.pdf", sha256: "00", pages: 1, marks, review: "in-review", download: "none", shown: [], removedSeen: [], rejected: [] };
  return { project: { id: "p", name: "Letters", created: "2026-11-24T00:00:00.000Z", archived: false, hidden: [], documents: [document] }, document };
}

/**
 * A Session over `project`, with the PDF worker ready. `land` dispatches a change straight to the
 * state, past the gate, as only a gate bug would; `parts` is the Session's part of the state now.
 */
function sessionOver(
  project: Project,
  { stored = store, pdf = client, detection = notStarted }: { readonly stored?: Store; readonly pdf?: PdfClient; readonly detection?: DetectionClient } = {},
) {
  let open: OpenSession | undefined;
  const host: SessionHost = {
    state: () => ({ worker: { status: "ready" }, settings: defaultSettings, session: open }),
    dispatch: (_from, change, ...effects) => {
      if (open !== undefined) open = { ...open, parts: reduce(open.parts, change) };
      for (const effect of effects) effect();
    },
    client: pdf,
    detection,
    intake: () => Promise.resolve({ added: [], refused: [] }),
    addCustomType: () => undefined,
  };
  open = openSession(host, { store: stored, folder: "Letters", project, migrated: false }, { release: () => undefined }, () => undefined);
  const { session } = open;
  // Each document's prepared files read, with nothing removed, as `begin` finds them.
  for (const { id } of project.documents) host.dispatch(session, { type: "documentPrepared", document: id, removed: [], lost: [] });
  const parts = () => open?.parts ?? firstParts(project);
  return { session, land: (change: SessionChange) => host.dispatch(session, change), parts };
}

/** A Session over a one-page document whose page text is "Jane" and is held, with the document open. */
function sessionWithText() {
  const { project, document } = projectWith([]);
  const { session, land } = sessionOver(project);
  const handle: DocumentHandle = { document: document.id, pages: [page] };
  land({ type: "opened", handle });
  land({ type: "pageTextLoaded", handle, page: page.index, text: { chars: [..."Jane"].map((c) => ({ c, box })) } });
  return { session, handle, page: page.index, box };
}

describe("marks.add", () => {
  test("adds text whose offsets lie within its page's text", () => {
    const { session, handle, page } = sessionWithText();
    expect(session.marks.add({ handle, type: "person", target: { kind: "text", pieces: [{ page, start: 0, end: 4 }] } })).toEqual({ ok: true, value: { markId: 1 } });
  });

  test("refuses text whose offsets run past its page's text, or are negative", () => {
    const { session, handle, page } = sessionWithText();
    for (const offsets of [
      { start: 0, end: 5 },
      { start: -1, end: 2 },
      { start: 3, end: 2 },
    ]) {
      expect(session.marks.add({ handle, type: "person", target: { kind: "text", pieces: [{ page, ...offsets }] } })).toEqual({ ok: false, error: { code: "empty-target" } });
    }
  });

  test("refuses a box on a page the document doesn't have", () => {
    const { session, handle, box } = sessionWithText();
    const beyond = 1;
    if (!isPageIndex(beyond)) throw new Error("A bad page");
    expect(session.marks.add({ handle, type: "other", target: { kind: "box", page: beyond, box } })).toEqual({ ok: false, error: { code: "empty-box" } });
  });
});

describe("approval", () => {
  const jane: Mark = { id: 1, type: "person", linkId: "", isNew: false, target: { kind: "text", text: "Jane", pieces: [{ page: page.index, start: 0, end: 4, boxes: [box], text: "Jane" }] } };
  const dear: Mark = { ...jane, id: 2, target: { kind: "box", page: page.index, box } };
  const none = (document: ProjectDocument["id"]) => ({ document, hidden: 0, shown: 0, retyped: 0 });

  /** A Session whose approval of its document waits for its heads-up, as `planned` leaves it. */
  function waitingForHeadsUp() {
    const { project, document } = projectWith([jane]);
    const opened = sessionOver(project);
    const approved: Project = { ...project, documents: [{ ...document, review: "approved" }] };
    const plan = { planId: 1, document: document.id, changes: [], here: { ...none(document.id), hidden: 1 }, removed: [], unmarkedFindings: 0 };
    opened.land({ type: "planned", plan, from: project, project: approved });
    return { ...opened, document, approved };
  }

  test("lands at once when it changes nothing beyond its document's review state", async () => {
    const { project, document } = projectWith([jane]);
    const { session, parts } = sessionOver(project);
    expect(await session.approval.plan(document.id)).toEqual({ ok: true, value: { landed: true } });
    expect(parts().record.present.project.documents[0]?.review).toBe("approved");
    expect(parts().operation.operation).toBe("idle");
  });

  test("approves nothing when the record changed while the plan was worked out", async () => {
    const { project, document } = projectWith([jane]);
    const { session, land, parts } = sessionOver(project);
    const planned = session.approval.plan(document.id);
    land({ type: "markAdded", document: document.id, mark: dear, replaces: [] });
    expect(await planned).toEqual({ ok: false, error: { code: "approval-failed" } });
    expect(parts().record.present.project.documents[0]).toMatchObject({ review: "in-review", marks: [jane, dear] });
    expect(parts().operation.operation).toBe("idle");
  });

  test("while its heads-up is open, the record takes no change, and only its own plan is confirmed or cancelled", async () => {
    const { session, document, parts } = waitingForHeadsUp();
    const busy = { ok: false, error: { code: "busy-approving" } };
    expect(session.marks.remove(document.id, jane.id)).toEqual(busy);
    expect(session.labelling.link(document.id, jane.id, "L1")).toEqual(busy);
    expect(session.history.undo(document.id)).toEqual(busy);
    expect(session.documents.markDownloaded(document.id)).toEqual(busy);
    expect(await session.approval.confirm(2)).toEqual({ ok: false, error: { code: "no-plan" } });
    expect(session.approval.cancel(1)).toEqual({ ok: true, value: undefined });
    expect(parts().operation.operation).toBe("idle");
    expect(parts().record.present.project.documents[0]?.review).toBe("in-review");
    expect(await session.approval.confirm(1)).toEqual({ ok: false, error: { code: "no-plan" } });
  });

  test("a heads-up confirmed lands the approval it showed", async () => {
    const { session, approved, parts } = waitingForHeadsUp();
    expect(await session.approval.confirm(1)).toEqual({ ok: true, value: undefined });
    expect(parts().record.present.project).toBe(approved);
    expect(parts().approval).toBeUndefined();
  });

  test("a heads-up confirmed on a record changed since its plan approves nothing", async () => {
    const { session, document, land, parts } = waitingForHeadsUp();
    land({ type: "markAdded", document: document.id, mark: dear, replaces: [] });
    expect(await session.approval.confirm(1)).toEqual({ ok: false, error: { code: "approval-failed" } });
    expect(parts().record.present.project.documents[0]).toMatchObject({ review: "in-review", marks: [jane, dear] });
    expect(parts().approval).toBeUndefined();
    expect(parts().operation.operation).toBe("idle");
  });
});

describe("profile.set", () => {
  test("stores the profile in the project record, makes no undo step, and leaves the document's review as it was", () => {
    const jane: Mark = { id: 1, type: "person", linkId: "", isNew: false, target: { kind: "box", page: page.index, box } };
    const { project, document } = projectWith([jane]);
    const approved: Project = { ...project, documents: [{ ...document, review: "approved" }] };
    const { session, parts } = sessionOver(approved);
    const profile: Profile = { countries: ["us", "in"], industries: ["finance"] };
    expect(session.profile.set(profile)).toEqual({ ok: true, value: undefined });
    expect(parts().record.present.project.profile).toEqual(profile);
    expect(parts().record.present.project.documents[0]?.review).toBe("approved");
    expect(parts().record.steps.size).toBe(0);
    expect(parts().operation.save).toBe("saving");
  });
});

describe("Auto mode", () => {
  const profile: Profile = { countries: ["us"], industries: [] };
  const format: Evidence = { kind: "format", level: "format" };

  function pageAt(index: number): PageIndex {
    if (!isPageIndex(index)) throw new Error("A bad page");
    return index;
  }
  /** A page of these characters, "\n" being one with no box. */
  const pageOf = (chars: readonly string[]): PageText => ({ chars: chars.map((c): PageChar => (c === "\n" ? { c, box: undefined } : { c, box })) });
  const textOf = (line: string): PageText => pageOf([...line]);
  /** A hit on the first page over [start, start + value's length); its text is read from the page as the real worker reads it. */
  const hit = (value: string, start: number, more: Partial<Hit> = {}): Hit => ({
    page: page.index,
    start,
    end: start + value.length,
    text: value,
    identifier: "us-ssn",
    evidence: [format],
    rule: "us-ssn",
    recognizer: "pattern",
    ...more,
  });
  const textMark = (id: number, text: string, start: number): Mark => ({
    id,
    type: "other",
    linkId: "",
    isNew: false,
    target: { kind: "text", text, pieces: [{ page: page.index, start, end: start + text.length, boxes: [box], text }] },
  });

  /** A store of files in memory. The tests' files are ASCII, so a string is stored a byte per character. */
  function memoryStore(): Store & { readonly paths: Map<string, Uint8Array<ArrayBuffer>> } {
    const paths = new Map<string, Uint8Array<ArrayBuffer>>();
    return {
      paths,
      read: (path) => Promise.resolve(paths.get(path)?.slice()),
      write(path, data) {
        paths.set(path, typeof data === "string" ? Uint8Array.from(data, (c) => c.charCodeAt(0)) : data);
        return Promise.resolve();
      },
      folders: () => Promise.resolve([]),
      files: () => Promise.resolve([]),
      remove(path) {
        for (const each of [...paths.keys()]) if (each === path || each.startsWith(`${path}/`)) paths.delete(each);
        return Promise.resolve();
      },
    };
  }

  /** What the fake worker does on each page: answer with these hits, never answer until stopped, or fail. */
  type Answer = readonly Hit[] | "hang" | "fail";

  /**
   * A detection client that answers pages as `answer` says, and counts the packs it was asked for
   * and its stops. As the real worker, it has only the characters it is sent, reads "\n" as one
   * with no box, and reads each hit's text there with `rangeText`.
   */
  function fakeDetection(answer: (page: PageIndex) => Answer) {
    const asked: (readonly PackId[])[] = [];
    let stops = 0;
    let stopped: () => void = () => undefined;
    const client: DetectionClient = {
      async run({ packs, pages, onPage }) {
        asked.push(packs);
        for (const { index, chars } of pages) {
          const answered = answer(index);
          if (answered === "fail") return { ended: "failed", code: "detector-failed", packs: [] };
          if (answered === "hang") {
            await new Promise<void>((resolve) => {
              stopped = resolve;
            });
            return { ended: "stopped", packs: [] };
          }
          const text = pageOf(chars);
          onPage({ page: index, hits: answered.map((each) => ({ ...each, text: rangeText(text, each.start, each.end) })), errors: 0 });
        }
        return { ended: "finished", packs: [{ id: "universal", version: "000000000000" }] };
      },
      stop() {
        stops++;
        stopped();
      },
    };
    return { client, asked, stops: () => stops };
  }

  /**
   * A Session over one document whose stored pages read `lines`, with the original in the folder,
   * `marks` and `rejected`, the project's `profile`, and the fake worker answering as `answer` says.
   */
  async function autoSession({
    lines = ["SSN 123-45-6789"],
    marks = [],
    rejected = [],
    withProfile = true,
    answer = () => [],
    pdf = client,
  }: {
    readonly lines?: readonly string[];
    readonly marks?: readonly Mark[];
    readonly rejected?: readonly string[];
    readonly withProfile?: boolean;
    readonly answer?: (page: PageIndex) => Answer;
    readonly pdf?: PdfClient;
  } = {}) {
    const { project, document } = projectWith([...marks]);
    const id = document.id;
    const withRecord: Project = {
      ...project,
      ...(withProfile ? { profile } : {}),
      documents: [{ ...document, pages: lines.length, rejected: [...rejected] }],
    };
    const stored = memoryStore();
    await stored.write(`Letters/${document.file}`, "%PDF");
    const [first, ...rest] = lines.map(textOf);
    if (first === undefined) throw new Error("No pages");
    await savePrepared(stored, "Letters", READER_TAG, id, { preparedBytes: new Uint8Array(0), reading: { texts: [first, ...rest], images: [] }, removed: [] });
    const detection = fakeDetection(answer);
    const opened = sessionOver(withRecord, { stored, pdf, detection: detection.client });
    const running = () => opened.parts().detection.get(id)?.run.state === "running";
    return { ...opened, ...detection, id, stored, running, ended: () => vi.waitFor(() => expect(running()).toBe(false)) };
  }

  test("a run on a document with stored text searches it with the profile's packs and offers its hits, ticked", async () => {
    const { session, id, parts, asked, ended } = await autoSession({ answer: () => [hit("123-45-6789", 4)] });
    expect(await session.detection.run(id)).toEqual({ ok: true, value: undefined });
    await ended();
    expect(asked).toEqual([["universal", "us"]]);
    expect(parts().findings.get(id)?.findings).toMatchObject([{ key: "123456789", text: "123-45-6789", places: [{ page: page.index, start: 4, end: 15 }], ticked: true }]);
    expect(parts().findings.get(id)?.notSearched).toEqual([]);
  });

  test("a value followed by a line end is found with the text and key a hand mark over the same range has", async () => {
    const lines = ["SSN 123-45-6789\nNext"];
    const { session, id, parts, ended } = await autoSession({ lines, answer: () => [hit("123-45-6789\n", 4)] });
    await session.detection.run(id);
    await ended();
    const [line] = lines.map(textOf);
    if (line === undefined) throw new Error("No page");
    const marked = textTarget(new Map([[page.index, line]]), [{ page: page.index, start: 4, end: 16 }]);
    if (typeof marked === "string") throw new Error("No target");
    expect(parts().findings.get(id)?.findings).toMatchObject([{ text: marked.text, key: keyOf(marked.text), places: [{ page: page.index, start: 4, end: 16 }] }]);
    expect(marked.text).toBe("123-45-6789");
  });

  test("a hit where the same value is marked is left out; one inside or around a mark of another value is kept", async () => {
    const { session, id, parts, ended } = await autoSession({
      lines: ["A 123-45-6789 B 987-65-4321 C 555-12-3456"],
      marks: [textMark(1, "123 45 6789", 2), textMark(2, "65-4321", 20), textMark(3, "C 555-12-3456", 28)],
      answer: () => [hit("123-45-6789", 2), hit("987-65-4321", 16), hit("555-12-3456", 30)],
    });
    await session.detection.run(id);
    await ended();
    expect(parts().findings.get(id)?.findings.map(({ text }) => text)).toEqual(["987-65-4321", "555-12-3456"]);
  });

  test("two hits whose spans overlap are two findings; two hits on one span are one finding with two candidates", async () => {
    const { session, id, parts, ended } = await autoSession({
      lines: ["12-34-56 12345678"],
      answer: () => [
        hit("12-34-56 12345678", 0, { identifier: "uk-sort-code-account" }),
        hit("12345678", 9, { identifier: "us-bank-account" }),
        hit("12345678", 9, { identifier: "in-bank-account" }),
      ],
    });
    await session.detection.run(id);
    await ended();
    const findings = parts().findings.get(id)?.findings ?? [];
    expect(findings.map(({ text, candidates }) => [text, candidates.map(({ identifier }) => identifier)])).toEqual([
      ["12-34-56 12345678", ["uk-sort-code-account"]],
      ["12345678", ["us-bank-account", "in-bank-account"]],
    ]);
  });

  test("a hit of a rejected value is left out, and a run with nothing to offer opens no findings review", async () => {
    const { session, id, parts, ended } = await autoSession({ rejected: ["123456789"], answer: () => [hit("123-45-6789", 4)] });
    await session.detection.run(id);
    await ended();
    expect(parts().findings.has(id)).toBe(false);
    expect(parts().detection.get(id)?.notice).toEqual({ kind: "nothing-found", notSearched: [] });
  });

  test("a lost mark does not count as a mark of its value", async () => {
    const { session, id, parts, land, ended } = await autoSession({ marks: [textMark(1, "123-45-6789", 4)], answer: () => [hit("123-45-6789", 4)] });
    land({ type: "documentPrepared", document: id, removed: [], lost: [1] });
    await session.detection.run(id);
    await ended();
    expect(parts().findings.get(id)?.findings.map(({ key }) => key)).toEqual(["123456789"]);
  });

  test("during a run, a second run and approving the document are refused", async () => {
    const { session, id, running } = await autoSession({ answer: () => "hang" });
    await session.detection.run(id);
    expect(running()).toBe(true);
    const busy = { ok: false, error: { code: "busy-detecting" } };
    expect(await session.detection.run(id)).toEqual(busy);
    expect(await session.approval.plan(id)).toEqual(busy);
  });

  test("a run is refused when neither the project nor the call names a profile; a profile for this run only is used and not kept", async () => {
    const { session, id, parts, asked, ended } = await autoSession({ withProfile: false });
    expect(await session.detection.run(id)).toEqual({ ok: false, error: { code: "no-profile" } });
    expect(asked).toEqual([]);
    expect(await session.detection.run(id, { countries: ["in"], industries: ["finance"] })).toEqual({ ok: true, value: undefined });
    await ended();
    expect(asked).toEqual([["universal", "in", "finance"]]);
    expect(parts().record.present.project.profile).toBeUndefined();
  });

  test("a stopped run keeps the hits of the pages searched, and lists the pages it did not search", async () => {
    const { session, id, parts, running, ended } = await autoSession({
      lines: ["SSN 123-45-6789", "SSN 987-65-4321", "SSN 555-12-3456"],
      answer: (at) => (at === 0 ? [hit("123-45-6789", 4)] : "hang"),
    });
    await session.detection.run(id);
    await vi.waitFor(() => expect(parts().detection.get(id)?.run).toEqual({ state: "running", page: 2, pages: 3 }));
    expect(running()).toBe(true);
    expect(session.detection.stop(id)).toEqual({ ok: true, value: undefined });
    await ended();
    expect(parts().findings.get(id)).toMatchObject({ findings: [{ text: "123-45-6789" }], notSearched: [pageAt(1), pageAt(2)] });
  });

  test("a run whose worker failed keeps the hits of the pages searched", async () => {
    const { session, id, parts, ended } = await autoSession({
      lines: ["SSN 123-45-6789", "SSN 987-65-4321", "SSN 555-12-3456"],
      answer: (at) => (at === 0 ? [hit("123-45-6789", 4)] : "fail"),
    });
    await session.detection.run(id);
    await ended();
    expect(parts().findings.get(id)).toMatchObject({ findings: [{ text: "123-45-6789" }], notSearched: [pageAt(1), pageAt(2)] });
  });

  /** Removes the stored files whose paths `match` picks. */
  const without = (stored: ReturnType<typeof memoryStore>, match: (path: string) => boolean) => {
    for (const path of [...stored.paths.keys()]) if (match(path)) stored.paths.delete(path);
  };

  test("a run on a document whose stored text is missing starts the update, and is refused", async () => {
    const { session, id, stored, parts } = await autoSession();
    without(stored, (path) => path.includes("/text/"));
    expect(await session.detection.run(id)).toEqual({ ok: false, error: { code: "busy-updating" } });
    // The update finds the PDF worker not running, so preparing the document again fails.
    await vi.waitFor(() => expect(parts().documents.get(id)?.failed).toBe("prepare-failed"));
  });

  test("a run on a document whose stored text and original are gone is refused with the document's code", async () => {
    const { session, id, stored } = await autoSession();
    without(stored, (path) => path.includes("/text/") || path.endsWith(".pdf"));
    expect(await session.detection.run(id)).toEqual({ ok: false, error: { code: "original-missing", data: { file: "a.pdf" } } });
  });

  test("an approval that marks every found value ends the findings review by itself", async () => {
    // The PDF worker finds values as the real one does.
    const pdf: PdfClient = {
      ...client,
      match: (keys, documents) =>
        Promise.resolve(
          documents.flatMap(({ texts }, document) =>
            findAll(texts.map(({ chars }) => chars.map(({ c }) => c)), keys).flatMap(({ page: at, ...found }) => (isPageIndex(at) ? [{ document, page: at, ...found }] : [])),
          ),
        ),
    };
    const { session, id, parts, ended } = await autoSession({
      lines: ["SSN 123-45-6789 and 123-45-6789"],
      marks: [textMark(1, "123-45-6789", 4)],
      answer: () => [hit("123-45-6789", 4), hit("123-45-6789", 20)],
      pdf,
    });
    await session.detection.run(id);
    await ended();
    expect(parts().findings.get(id)?.findings).toMatchObject([{ places: [{ page: page.index, start: 20, end: 31 }] }]);
    // Approving the document marks its own value where it is not marked yet, after the heads-up.
    const planned = await session.approval.plan(id);
    if (!planned.ok || planned.value.landed) throw new Error("No heads-up");
    expect(await session.approval.confirm(planned.value.plan.planId)).toEqual({ ok: true, value: undefined });
    expect(parts().findings.has(id)).toBe(false);
  });

  test("closing the Session stops a run and ends the worker; the run's hits are lost", async () => {
    const { session, id, parts, stops, running } = await autoSession({ answer: () => "hang" });
    await session.detection.run(id);
    expect(running()).toBe(true);
    expect(await session.close()).toEqual({ ok: true, value: undefined });
    expect(stops()).toBe(1);
    expect(running()).toBe(false);
    expect(parts().findings.has(id)).toBe(false);
  });
});

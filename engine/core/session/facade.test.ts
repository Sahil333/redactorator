import { describe, expect, test } from "vitest";
import type { DocumentHandle } from "../../api/state";
import { isPageIndex, isPoints, pointBox } from "../../model/geometry";
import { defaultSettings, newDocumentId, type Project } from "../../model/project";
import type { Store } from "../../storage/store";
import type { PdfClient } from "../pdf-client/client";
import type { ClientError } from "../pdf-client/errors";
import { openSession, type OpenSession, type SessionHost } from "./facade";
import { session as reduce } from "./slices";

const nothing = (): Promise<ClientError> => Promise.resolve({ code: "worker-not-running" });
// marks.add needs neither: it works from the page texts the Session already holds.
const client: PdfClient = { onStatus: () => () => undefined, inspect: nothing, match: nothing, open: nothing, render: nothing, text: nothing, apply: nothing };
const store: Store = { read: () => Promise.resolve(undefined), write: () => Promise.resolve(), folders: () => Promise.resolve([]), files: () => Promise.resolve([]), remove: () => Promise.resolve() };

/** A Session over a one-page document whose page text is "Jane" and is held, with the document open. */
function sessionWithText() {
  const id = newDocumentId();
  const project: Project = {
    id: "p",
    name: "Letters",
    created: "2026-11-24T00:00:00.000Z",
    archived: false,
    hidden: [],
    documents: [{ id, file: "a.pdf", sha256: "00", pages: 1, marks: [], review: "not-started", download: "none", shown: [] }],
  };
  const [index, width, height] = [0, 612, 792];
  const box = pointBox(72, 100, 80, 110);
  if (!isPageIndex(index) || !isPoints(width) || !isPoints(height) || box === undefined) throw new Error("A bad page");
  let open: OpenSession | undefined;
  const host: SessionHost = {
    state: () => ({ worker: { status: "ready" }, settings: defaultSettings, session: open }),
    dispatch: (_from, change) => {
      if (open !== undefined) open = { ...open, parts: reduce(open.parts, change) };
    },
    client,
    addCustomType: () => undefined,
  };
  open = openSession(host, { store, folder: "Letters", project }, { release: () => undefined }, () => undefined);
  const { session } = open;
  const handle: DocumentHandle = { document: id, pages: [{ index, width, height }] };
  host.dispatch(session, { type: "opened", handle });
  host.dispatch(session, { type: "pageTextLoaded", handle, page: index, text: { chars: [..."Jane"].map((c) => ({ c, box })) } });
  return { session, handle, page: index, box };
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

import { describe, expect, test } from "vitest";
import type { DocumentHandle } from "../../api/state";
import type { PageModel } from "../../model/document";
import { isPageIndex, isPoints, pointBox, type Box } from "../../model/geometry";
import type { Mark } from "../../model/marks";
import { defaultSettings, newDocumentId, type Project, type ProjectDocument } from "../../model/project";
import type { Store } from "../../storage/store";
import type { PdfClient } from "../pdf-client/client";
import type { ClientError } from "../pdf-client/errors";
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
  const document: ProjectDocument = { id: newDocumentId(), file: "a.pdf", sha256: "00", pages: 1, marks, review: "in-review", download: "none", shown: [] };
  return { project: { id: "p", name: "Letters", created: "2026-11-24T00:00:00.000Z", archived: false, hidden: [], documents: [document] }, document };
}

/**
 * A Session over `project`, with the PDF worker ready. `land` dispatches a change straight to the
 * state, past the gate, as only a gate bug would; `parts` is the Session's part of the state now.
 */
function sessionOver(project: Project) {
  let open: OpenSession | undefined;
  const host: SessionHost = {
    state: () => ({ worker: { status: "ready" }, settings: defaultSettings, session: open }),
    dispatch: (_from, change, ...effects) => {
      if (open !== undefined) open = { ...open, parts: reduce(open.parts, change) };
      for (const effect of effects) effect();
    },
    client,
    intake: () => Promise.resolve({ added: [], refused: [] }),
    addCustomType: () => undefined,
  };
  open = openSession(host, { store, folder: "Letters", project, migrated: false }, { release: () => undefined }, () => undefined);
  const { session } = open;
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
    const plan = { planId: 1, document: document.id, changes: [], here: { ...none(document.id), hidden: 1 } };
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

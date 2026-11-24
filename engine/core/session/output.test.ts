import { describe, expect, test } from "vitest";
import type { DocumentHandle } from "../../api/state";
import { isPageIndex, isPoints } from "../../model/geometry";
import { defaultSettings, newDocumentId, type Project, type ProjectDocument } from "../../model/project";
import type { SessionChange } from "./changes";
import { sessionState } from "./selectors";
import { firstParts, session } from "./slices";

const document = (file: string): ProjectDocument => ({ id: newDocumentId(), file, sha256: "00", pages: 1, marks: [], review: "in-review", download: "none", shown: [] });

/** The Session's published state after `changes`, with the PDF worker ready. */
function after(project: Project, changes: readonly SessionChange[]) {
  const parts = changes.reduce(session, firstParts(project));
  return sessionState({ worker: { status: "ready" }, settings: defaultSettings, parts }, "folder");
}

describe("the output", () => {
  const shown = document("shown.pdf");
  const other = document("other.pdf");
  const project: Project = { id: "p", name: "Letters", created: "2026-11-24T00:00:00.000Z", archived: false, documents: [shown, other], hidden: [] };
  const [index, width, height] = [0, 612, 792];
  if (!isPageIndex(index) || !isPoints(width) || !isPoints(height)) throw new Error("A bad page");
  const handle: DocumentHandle = { document: shown.id, pages: [{ index, width, height }] };
  const showing: readonly SessionChange[] = [
    { type: "opening", document: shown.id },
    { type: "opened", handle },
    { type: "applyStarted" },
    { type: "applied", tag: { document: shown.id, edits: 0, appearance: defaultSettings.appearance }, bytes: new Uint8Array(), shown: handle },
  ];

  test("is dropped when another document's approval spreads into its document, which shows its marks again", () => {
    expect(after(project, showing).output).toBe(handle);
    const approved: SessionChange = { type: "approved", project, changedDocuments: [other.id, shown.id] };
    expect(after(project, [...showing, approved]).output).toBeUndefined();
  });

  test("stays when an approval changes only other documents", () => {
    const approved: SessionChange = { type: "approved", project, changedDocuments: [other.id] };
    expect(after(project, [...showing, approved]).output).toBe(handle);
  });
});

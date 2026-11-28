import { describe, expect, test } from "vitest";
import type { PageChar, PageText, Reading } from "./document";
import { isPageIndex, pointBox, type PageIndex } from "./geometry";
import type { Mark } from "./marks";
import { rangeBoxes } from "./pageText";
import { newDocumentId, type DocumentId, type Project, type ProjectDocument } from "./project";
import { approve, type TextPlace } from "./spread";

function pageIndex(n: number): PageIndex {
  if (!isPageIndex(n)) throw new Error("Not a page index");
  return n;
}

const first = pageIndex(0);

/** One line of 6 pt letters from x 72. */
function line(text: string): PageText {
  return {
    chars: [...text].map((c, at): PageChar => {
      const box = pointBox(72 + at * 6, 80, 78 + at * 6, 96);
      if (box === undefined) throw new Error("Not a box");
      return { c, box };
    }),
  };
}

/** A text mark over [start, end) of `text`'s first page. */
function textMark(id: number, type: string, text: PageText, start: number, end: number): Mark {
  const letters = text.chars.slice(start, end).map(({ c }) => c).join("");
  const piece = { page: first, start, end, boxes: rangeBoxes(text, start, end), text: letters };
  return { id, type, linkId: "", isNew: false, target: { kind: "text", text: letters, pieces: [piece] } };
}

const documentOf = (id: DocumentId, file: string, marks: Mark[]): ProjectDocument => ({
  id, file, sha256: "00", pages: 1, marks, review: "in-review", download: "none", shown: [], removedSeen: [], rejected: [],
});

const place = (document: DocumentId, key: string, page: PageIndex, start: number, end: number): TextPlace => ({ document, key, page, start, end });

describe("approve", () => {
  test("stops hiding a value its document no longer marks, though the value can't be found in its text", () => {
    const id = newDocumentId();
    const project: Project = {
      id: "p",
      name: "Letters",
      created: "2026-11-21T00:00:00.000Z",
      archived: false,
      // Marked across a page break once, so no search of single pages finds it again.
      hidden: [{ key: "jane roe", text: "Jane Roe", type: "person", from: id }],
      documents: [{ id, file: "a.pdf", sha256: "00", pages: 2, marks: [], review: "in-review", download: "none", shown: [], removedSeen: [], rejected: [] }],
    };
    expect(approve(project, id, new Map(), [], [])?.project.hidden).toEqual([]);
  });

  test("marks a value inside a wider mark of another value, so approving that document keeps the value hidden", () => {
    const [a, b] = [newDocumentId(), newDocumentId()];
    const [textA, textB] = [line("1234 5678 is hers"), line("Account 1234 5678 closed")];
    const wider = textMark(1, "other", textB, 0, 17);
    const project: Project = {
      id: "p",
      name: "Letters",
      created: "2026-11-21T00:00:00.000Z",
      archived: false,
      hidden: [],
      documents: [documentOf(a, "a.pdf", [textMark(1, "financial-account", textA, 0, 9)]), documentOf(b, "b.pdf", [wider])],
    };
    const readings = new Map<DocumentId, Reading>([[a, { texts: [textA], images: [] }], [b, { texts: [textB], images: [] }]]);
    const account = [place(a, "12345678", first, 0, 9), place(b, "12345678", first, 8, 17)];

    const approvedA = approve(project, a, readings, account, []);
    const marksB = approvedA?.project.documents.find((document) => document.id === b)?.marks;
    expect(marksB).toMatchObject([
      { type: "other", isNew: false, target: { text: "Account 1234 5678" } },
      { type: "financial-account", isNew: true, target: { text: "1234 5678" } },
    ]);

    const wholeB = place(b, "account 12345678", first, 0, 17);
    const approvedB = approvedA && approve(approvedA.project, b, readings, [...account, wholeB], []);
    expect(approvedB?.project.hidden.map(({ key }) => key)).toEqual(["12345678", "account 12345678"]);
    expect(approvedB?.project.documents.find((document) => document.id === a)?.marks).toHaveLength(1);
  });
});

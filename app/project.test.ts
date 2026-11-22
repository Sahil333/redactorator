import { describe, expect, test } from "vitest";
import { pointBox, type PageText } from "../engine/contract";
import { parseProject, parseTexts, projectJson, textsJson, type Project } from "./project";

const box = pointBox(72, 99.123, 98.456, 115.6);
if (box === undefined) throw new Error("No box");

// A project as phase 2 slice 1 stored it: version 1, with no review states and no hidden values.
const versionOne = JSON.stringify({
  format: "redactorator-project",
  version: 1,
  id: "p1",
  name: "Letters",
  created: "2026-11-21T00:00:00.000Z",
  archived: false,
  documents: [
    { id: "d1", file: "a.pdf", sha256: "00", pages: 1, marks: [{ id: 1, type: "person", linkId: "", target: { kind: "box", page: 0, box } }] },
    { id: "d2", file: "b.pdf", sha256: "11", pages: 1, marks: [] },
  ],
});

describe("parseProject", () => {
  test("opens a version 1 project with its marks its own, a marked document in review, and nothing hidden", () => {
    const project = parseProject(versionOne);
    if (typeof project === "string") throw new Error(project);
    expect(project.hidden).toEqual([]);
    expect(project.documents.map(({ review, download, shown }) => ({ review, download, shown }))).toEqual([
      { review: "in-review", download: "none", shown: [] },
      { review: "not-started", download: "none", shown: [] },
    ]);
    expect(project.documents[0]?.marks[0]?.isNew).toBe(false);
  });

  test("reads back what it writes", () => {
    const project = parseProject(versionOne);
    if (typeof project === "string") throw new Error(project);
    const [first] = project.documents;
    if (first === undefined) throw new Error("No document");
    const approved: Project = { ...project, hidden: [{ key: "jane roe", text: "Jane Roe", type: "person", from: first.id }] };
    expect(parseProject(projectJson(approved))).toEqual(approved);
  });

  test("leaves a newer version alone, and calls a broken one damaged", () => {
    expect(parseProject(versionOne.replace('"version":1', '"version":3'))).toBe("newer");
    expect(parseProject(versionOne.replace('"review"', '"x"').replace('"version":1', '"version":2'))).toBe("damaged");
  });
});

describe("parseTexts", () => {
  test("reads back each page's characters and boxes, to a hundredth of a point", () => {
    const texts: PageText[] = [{ chars: [{ c: "D", box }, { c: "\n", box: undefined }] }];
    expect(parseTexts(textsJson(texts), 1)).toEqual([{ chars: [{ c: "D", box: { x0: 72, y0: 99.12, x1: 98.46, y1: 115.6 } }, { c: "\n", box: undefined }] }]);
  });

  test("calls a file damaged when its pages don't match the document's", () => {
    expect(parseTexts(textsJson([{ chars: [] }]), 2)).toBe("damaged");
  });
});

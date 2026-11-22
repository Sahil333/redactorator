import { describe, expect, test } from "vitest";
import { newDocumentId, type Project } from "./project";
import { approve } from "./spread";

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
      documents: [{ id, file: "a.pdf", sha256: "00", pages: 2, marks: [], review: "in-review", download: "none", shown: [] }],
    };
    expect(approve(project, id, new Map(), [])?.project.hidden).toEqual([]);
  });
});

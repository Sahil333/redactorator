import { describe, expect, test } from "vitest";
import { readerTag, type PageText, type PlacedImage } from "../../model/document";
import { isPageIndex, pointBox } from "../../model/geometry";
import type { ImageAnchor } from "../../model/images";
import type { Project } from "../../model/project";
import { imagesJson, parseImages, parseProject, parseTexts, projectJson, textsJson } from "./project";

const box = pointBox(72, 99.123, 98.456, 115.6);
if (box === undefined) throw new Error("No box");
const firstPage = 0;
if (!isPageIndex(firstPage)) throw new Error("No page");

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
    const image: ImageAnchor = { fingerprint: "0f0f0f0f0f0f0f0f", aspect: 1.5, frame: [0, 0, 0.9, 1] };
    const anchored = first.marks.map((mark) => (mark.target.kind === "box" ? { ...mark, target: { ...mark.target, image } } : mark));
    const approved: Project = {
      ...project,
      documents: [{ ...first, marks: anchored, removedSeen: ["metadata", "form-data"] }, ...project.documents.slice(1)],
      hidden: [
        { key: "jane roe", text: "Jane Roe", type: "person", from: first.id },
        { key: "Image 0f0f0f0f0f0f0f0f 0 0 0.9 1", text: "Box", type: "person", from: first.id, image },
      ],
    };
    expect(parseProject(projectJson(approved))).toEqual(approved);
  });

  test("reads a file of any version without a profile or rejected values as having no profile and nothing rejected", () => {
    const document = { id: "d1", file: "a.pdf", sha256: "00", pages: 1, marks: [], review: "not-started", download: "none", shown: [] };
    const stored = (version: number) =>
      JSON.stringify({ format: "redactorator-project", version, id: "p1", name: "Letters", created: "2026-11-21T00:00:00.000Z", archived: false, hidden: [], documents: [document] });
    for (const version of [1, 2, 3]) {
      const project = parseProject(stored(version));
      if (typeof project === "string") throw new Error(project);
      expect(project).not.toHaveProperty("profile");
      expect(project.documents[0]?.rejected).toEqual([]);
    }
  });

  test("reads back a profile and rejected values, and calls a profile with an unknown choice damaged", () => {
    const project = parseProject(versionOne);
    if (typeof project === "string") throw new Error(project);
    const [first, ...rest] = project.documents;
    if (first === undefined) throw new Error("No document");
    const chosen: Project = { ...project, profile: { countries: ["us", "in"], industries: [] }, documents: [{ ...first, rejected: ["123456789", "jane@example.com"] }, ...rest] };
    expect(parseProject(projectJson(chosen))).toEqual(chosen);
    expect(parseProject(projectJson(chosen).replace('"in"]', '"nz"]'))).toBe("damaged");
  });

  test("leaves a newer version alone, and calls a broken one damaged", () => {
    expect(parseProject(versionOne.replace('"version":1', '"version":4'))).toBe("newer");
    expect(parseProject(versionOne.replace('"review"', '"x"').replace('"version":1', '"version":2'))).toBe("damaged");
  });
});

describe("parseTexts", () => {
  const tag = readerTag("pdf-3");
  const texts: PageText[] = [{ chars: [{ c: "D", box }, { c: "\n", box: undefined }] }];
  const rounded = [{ chars: [{ c: "D", box: { x0: 72, y0: 99.12, x1: 98.46, y1: 115.6 } }, { c: "\n", box: undefined }] }];

  test("reads back each page's characters and boxes, to a hundredth of a point, with the reader tag and removed kinds", () => {
    expect(parseTexts(textsJson(texts, tag, ["metadata", "form-data"]), 1)).toEqual({ pages: rounded, readerTag: tag, removed: ["metadata", "form-data"] });
  });

  test("reads a version 1 file, from before reader tags, for migrating marks", () => {
    const versionOneTexts = JSON.stringify({ format: "redactorator-text", version: 1, pages: [{ chars: ["D", "\n"], boxes: [72, 99.12, 98.46, 115.6] }] });
    expect(parseTexts(versionOneTexts, 1)).toEqual({ pages: rounded });
  });

  test("leaves a newer version alone, and calls a broken one damaged", () => {
    expect(parseTexts(textsJson(texts, tag, []).replace('"version":2', '"version":3'), 1)).toBe("newer");
    expect(parseTexts(textsJson(texts, tag, []).replace('"removed":[]', '"removed":["unknown-kind"]'), 1)).toBe("damaged");
    expect(parseTexts("{", 1)).toBe("damaged");
  });

  test("calls a file damaged when its pages don't match the document's", () => {
    expect(parseTexts(textsJson([{ chars: [] }], tag, []), 2)).toBe("damaged");
  });
});

describe("text pieces", () => {
  const withPieces = (piece: Record<string, unknown>) =>
    JSON.stringify({
      format: "redactorator-project",
      version: 3,
      id: "p1",
      name: "Letters",
      created: "2026-11-21T00:00:00.000Z",
      archived: false,
      hidden: [],
      documents: [
        { id: "d1", file: "a.pdf", sha256: "00", pages: 1, review: "in-review", download: "none", shown: [], marks: [{ id: 1, type: "person", linkId: "", isNew: false, target: { kind: "text", text: "Jane", pieces: [piece] } }] },
      ],
    });
  const pieceOf = (project: ReturnType<typeof parseProject>) => (typeof project === "string" ? project : project.documents[0]?.marks[0]?.target);

  test("reads a piece stored without its letters as having none", () => {
    expect(pieceOf(parseProject(withPieces({ page: 0, start: 5, end: 9, boxes: [box] })))).toMatchObject({ pieces: [{ text: "" }] });
  });

  test("reads a document stored without the removed kinds its approval listed as having listed none", () => {
    const project = parseProject(withPieces({ page: 0, start: 5, end: 9, boxes: [box], text: "Jane" }));
    expect(typeof project === "string" ? project : project.documents[0]?.removedSeen).toEqual([]);
  });

  test("reads back a piece's letters", () => {
    const project = parseProject(withPieces({ page: 0, start: 5, end: 9, boxes: [box], text: "Jane" }));
    if (typeof project === "string") throw new Error(project);
    expect(pieceOf(project)).toMatchObject({ pieces: [{ text: "Jane" }] });
    expect(parseProject(projectJson(project))).toEqual(project);
  });
});

describe("parseImages", () => {
  const images: PlacedImage[] = [{ page: firstPage, matrix: [288, 0, 0, 192, 100, 100], aspect: 1.5, fingerprint: "0123456789abcdef" }];

  test("reads back each image's page, place, shape and fingerprint", () => {
    expect(parseImages(imagesJson(images), 1)).toEqual(images);
  });

  test("calls a file damaged when an image is on a page the document doesn't have", () => {
    expect(parseImages(imagesJson(images), 0)).toBe("damaged");
  });
});

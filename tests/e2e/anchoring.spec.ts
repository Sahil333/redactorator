// Marks staying on their words when a build reads text otherwise (docs/designs/pdf-leak-suite.md,
// part 4): storage written by the build before reader tags, fixtures/golden/pre-phase-3/, opened
// by this one.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { parseProject, parseTexts } from "../../engine/core/formats/project";
import { isPageIndex } from "../../engine/model/geometry";
import { rangeText } from "../../engine/model/pageText";
import { applyAndDownload, crossPagePdf, filesIn, loadStorage, marks, oneWordPdf, openApp, saved, show, storedFiles, storedNamesIn } from "./app";
import { test } from "./coverage";
import { judge } from "./oracle";

const prePhase3 = new URL("../../fixtures/golden/pre-phase-3/", import.meta.url).pathname;
const decoder = new TextDecoder();

test("a project stored before reader tags keeps its older files, and its marks on their words, and exports clean", async ({ page }) => {
  await openApp(page);
  await loadStorage(page, prePhase3);
  await page.getByRole("button", { name: "cross-page", exact: true }).click();
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await show(page, "cross-page.pdf");
  await expect(marks(page)).toHaveText([/Jane Roe,/]);
  await saved(page);

  // The older build's files are as it left them, and this build's are in a folder of their own.
  const stored = await storedFiles(page);
  const before = await filesIn(join(prePhase3, "cross-page/.redactorator"));
  for (const [path, bytes] of before) expect(stored.get(`cross-page/.redactorator/${path}`), path).toEqual(new Uint8Array(bytes));
  expect(await storedNamesIn(page, "cross-page/.redactorator")).toContain("pdf-3");

  // Every text piece reads, in the text this build stored, as the letters it was made on.
  const project = parseProject(decoder.decode(stored.get("cross-page/.redactorator/pdf-3/project.json")));
  if (typeof project === "string") throw new Error(`The migrated project is ${project}`);
  const pieces = project.documents.flatMap((document) =>
    document.marks.flatMap((mark) => (mark.target.kind === "text" ? mark.target.pieces.map((piece) => ({ document, piece })) : [])),
  );
  expect(pieces.length).toBeGreaterThan(0);
  for (const { document, piece } of pieces) {
    const texts = parseTexts(decoder.decode(stored.get(`cross-page/.redactorator/pdf-3/text/${document.id}.json`)), document.pages);
    if (typeof texts === "string") throw new Error(`${document.file}'s text is ${texts}`);
    const text = isPageIndex(piece.page) ? texts.pages[piece.page] : undefined;
    expect(piece.text, document.file).not.toBe("");
    expect(text && rangeText(text, piece.start, piece.end), document.file).toBe(piece.text);
  }

  // The mark across the page break still removes both its words, and nothing else moves.
  const output = await applyAndDownload(page);
  await judge(crossPagePdf, output, [
    { check: "absent", values: ["Jane", "Roe,"] },
    { check: "positions", words: ["Jane", "Roe,"] },
  ]);
});

test("a mark whose offsets point at other letters in this build's text is placed on its words again", async ({ page }) => {
  // The older build's project, with one-word.pdf's "Jane Roe" three characters off, as if that
  // build had read the page with three more characters before it.
  const storage = await mkdtemp(join(tmpdir(), "pre-phase-3-"));
  await cp(prePhase3, storage, { recursive: true });
  const file = join(storage, "cross-page/.redactorator/project.json");
  const project: unknown = JSON.parse(await readFile(file, "utf8"));
  const documents: unknown = typeof project === "object" && project !== null ? Reflect.get(project, "documents") : undefined;
  const oneWord: unknown = Array.isArray(documents) ? documents.find((each: unknown) => Reflect.get(Object(each), "file") === "one-word.pdf") : undefined;
  const marked: unknown = Reflect.get(Object(oneWord), "marks");
  const jane: unknown = Array.isArray(marked) ? marked.find((mark: unknown) => Reflect.get(Object(Reflect.get(Object(mark), "target")), "text") === "Jane Roe") : undefined;
  const [piece]: unknown[] = Reflect.get(Object(Reflect.get(Object(jane), "target")), "pieces");
  Reflect.set(Object(piece), "start", Number(Reflect.get(Object(piece), "start")) - 3);
  Reflect.set(Object(piece), "end", Number(Reflect.get(Object(piece), "end")) - 3);
  await writeFile(file, JSON.stringify(project));

  await openApp(page);
  await loadStorage(page, storage);
  await page.getByRole("button", { name: "cross-page", exact: true }).click();
  // Its documents are prepared again for this build first; until then none can be switched to.
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await show(page, "one-word.pdf");
  await expect(marks(page)).toHaveText([/Jane Roe/, /Dear/]);
  await saved(page);

  const output = await applyAndDownload(page);
  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Jane Roe", "Dear"] },
    { check: "positions", words: ["Jane Roe", "Dear"] },
  ]);
});

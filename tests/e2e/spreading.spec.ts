import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import {
  addDocuments,
  applyAndDownload,
  aJaneRoe,
  approvalLands,
  approve,
  approveButton,
  bStatement,
  dear,
  downloadButton,
  drawBox,
  dropFiles,
  encryptedPdf,
  inExplorer,
  janeRoe,
  letterA,
  letterB,
  logoA,
  logoB,
  markText,
  marks,
  mostOfLogo,
  oneWordPdf,
  openApp,
  openPdf,
  reference,
  saved,
  saveFile,
  show,
  standInForSaveDialog,
  toScreen,
  type PointBox,
} from "./app";
import { holdApprovalSearch, holdPreparation, stopWorkerOnSearch } from "./fakes";
import { judge } from "./oracle";

const lineFeedGlyph = new URL("../../fixtures/line-feed-glyph.pdf", import.meta.url).pathname;
const unmatchableImages = new URL("../../fixtures/unmatchable-images.pdf", import.meta.url).pathname;
const signatures = new URL("../../fixtures/signatures.pdf", import.meta.url).pathname;
const formPdf = new URL("../../fixtures/form.pdf", import.meta.url).pathname;

// More words of letter-a.pdf, from tests/oracle/README.md, in the app's box convention.
const aAccount: PointBox = [72, 99.1, 128.7, 115.6];
const aRoe: PointBox = [72, 119.1, 94.0, 135.6];
// letter-b.pdf's line "Her account 1234-5678 was closed, and 1234.5678 too.", from Helvetica's widths.
const bAccountLine: PointBox = [72, 99.1, 370.2, 115.6];
// Across logo-a.pdf's logo's lower right corner, less than half of it on the logo.
const offLogo: PointBox = [330, 250, 530, 350];
// Where logo-b.pdf draws each image, in user space (tests/oracle/README.md).
const logoHalf = [100, 550, 244, 646] as const;
const logoTurned = [304, 550, 400, 694] as const;
const logoResaved = [100, 250, 388, 442] as const;
const otherImage = [420, 300, 564, 396] as const;
// "Jane Roe" and the line-feed glyph after it in line-feed-glyph.pdf.
const janeRoeAndLineFeed: PointBox = [101.3, 79.1, 156.0, 95.6];

const newMarks = (page: Page) => page.getByRole("region", { name: "New marks" });

/**
 * Rewrites the stored project as phase 2's slice 1 kept it: in `.redactorator/` itself, version 1,
 * no review fields or piece letters, and no stored text, images or working copies; and deletes
 * `gone` from its folder.
 */
async function storeAsVersion1(page: Page, folder: string, gone: readonly string[] = []): Promise<void> {
  await saved(page);
  await page.evaluate(
    async ({ folder, gone }) => {
      const root = await navigator.storage.getDirectory();
      const project = await root.getDirectoryHandle(folder);
      const records = await project.getDirectoryHandle(".redactorator");
      const tagged = await records.getDirectoryHandle("pdf-3");
      const added = new Set(["hidden", "review", "download", "shown", "isNew"]);
      const text = (await (await (await tagged.getFileHandle("project.json")).getFile()).text()).replace('"version":3', '"version":1');
      // A piece is the only record with boxes; its letters came with Phase 3.
      const older = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(older);
        if (typeof value !== "object" || value === null) return value;
        const kept = Object.entries(value).filter(([key]) => !added.has(key) && !(key === "text" && "boxes" in value));
        return Object.fromEntries(kept.map(([key, each]) => [key, older(each)]));
      };
      const writable = await (await records.getFileHandle("project.json", { create: true })).createWritable();
      await writable.write(JSON.stringify(older(JSON.parse(text))));
      await writable.close();
      await records.removeEntry("pdf-3", { recursive: true });
      for (const name of gone) await project.removeEntry(name);
    },
    { folder, gone },
  );
  await page.reload();
}

/** Deletes the stored text this build keeps of document `file` in `folder`'s project, as a disk might lose it. */
async function loseReading(page: Page, folder: string, file: string): Promise<void> {
  await saved(page);
  await page.evaluate(
    async ({ folder, file }) => {
      const records = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(folder)).getDirectoryHandle(".redactorator");
      const tagged = await records.getDirectoryHandle("pdf-3");
      const project: unknown = JSON.parse(await (await (await tagged.getFileHandle("project.json")).getFile()).text());
      const documents: unknown = typeof project === "object" && project !== null ? Reflect.get(project, "documents") : undefined;
      const document: unknown = Array.isArray(documents) ? documents.find((each: unknown) => typeof each === "object" && each !== null && Reflect.get(each, "file") === file) : undefined;
      const id: unknown = typeof document === "object" && document !== null ? Reflect.get(document, "id") : undefined;
      if (typeof id !== "string") throw new Error(`${file} is not in the project`);
      await (await tagged.getDirectoryHandle("text")).removeEntry(`${id}.json`);
    },
    { folder, file },
  );
}

/** Starts a project from both letters, with letter-a.pdf open. */
async function openLetters(page: Page): Promise<void> {
  await openApp(page);
  await openPdf(page, letterA, letterB);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/letter-a\.pdf/);
}

test("approving a document hides its values in another, however they are written there, and sends it back to review", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aJaneRoe, "Person");
  await markText(page, 1, aAccount, "Financial account");
  await expect(inExplorer(page, "letter-a.pdf")).toContainText("In review");
  await expect(inExplorer(page, "letter-b.pdf")).toContainText("Not started");

  await approve(page, /hides 4 places in letter-b\.pdf/);
  await expect(inExplorer(page, "letter-a.pdf")).toContainText("Approved");
  await expect(inExplorer(page, "letter-b.pdf")).toContainText("In review");

  // Reload: the review states and the spread marks are kept.
  await saved(page);
  await page.reload();
  await show(page, "letter-b.pdf");
  await expect(newMarks(page)).toContainText("4 new marks from letter-a.pdf");
  await expect(marks(page)).toHaveText([/JANE ROE.*2 places, page 1/, /1234-5678.*2 places, page 1/]);

  const output = await applyAndDownload(page);
  expect(output).toMatch(/letter-b-preview\.pdf$/);
  await judge(letterB, output, [
    { check: "absent", values: ["JANE ROE", "Jane Roe", "1234-5678", "1234.5678"] },
    { check: "present", text: "Monroe Street" },
    { check: "present", text: "Ref 91234 5678 is not hers." },
    // The line above the hidden "Roe" sits closer than the letters are tall, and stays whole.
    { check: "present", text: "The form was signed by" },
    { check: "metadata" },
  ]);
});

test("a value inside a wider mark gets a mark of its own there, so approving that document keeps the value hidden in the others", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aAccount, "Financial account");
  await show(page, "letter-b.pdf");
  // Both places of the account in letter-b.pdf lie inside this mark.
  await markText(page, 1, bAccountLine, "Other");

  await show(page, "letter-a.pdf");
  await approve(page, /hides 2 places in letter-b\.pdf/);
  await show(page, "letter-b.pdf");
  await expect(marks(page)).toHaveText([/^Her account 1234-5678/, /^New1234-5678.*2 places, page 1/]);

  await approve(page, undefined);
  await judge(letterB, await applyAndDownload(page), [
    { check: "absent", values: ["1234-5678", "1234.5678", "Her account"] },
    { check: "present", text: "She lives on Monroe Street." },
  ]);
  await page.getByRole("button", { name: "Back to editing" }).click();
  await show(page, "letter-a.pdf");
  await expect(marks(page)).toHaveText([/1234 5678/]);
  await judge(letterA, await applyAndDownload(page), [
    { check: "absent", values: ["1234 5678"] },
    { check: "present", text: "is the account she named." },
  ]);
});

test("a value marked but not approved stays in the other documents", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aJaneRoe, "Person");

  await show(page, "letter-b.pdf");
  await expect(marks(page)).toHaveCount(0);
  await markText(page, 1, bStatement, "Other");
  const output = await applyAndDownload(page);
  await judge(letterB, output, [{ check: "present", text: "JANE ROE" }, { check: "present", text: "Jane Roe in person" }]);
});

test("a whole word only: hiding Roe leaves Monroe", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aRoe, "Person");
  await approve(page, /hides 2 places in letter-b\.pdf.*It also hides 1 place more in this document/s);

  await show(page, "letter-b.pdf");
  const output = await applyAndDownload(page);
  await judge(letterB, output, [
    { check: "absent", values: ["ROE", "Roe in person"] },
    { check: "present", text: "Monroe Street" },
    { check: "present", text: "JANE" },
    { check: "present", text: "The form was signed by Jane" },
  ]);
});

test("a document added later gets the approved values, and opens in review with them shown as new", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aJaneRoe, "Person");
  await approve(page, /hides 2 places in letter-b\.pdf/);

  await addDocuments(page, oneWordPdf);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/one-word\.pdf/);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("In review");
  await expect(newMarks(page)).toContainText("1 new mark from letter-a.pdf");
  await expect(marks(page)).toHaveText([/^New.*Jane Roe/]);
  await page.getByRole("button", { name: /^New/ }).click();
  await expect(marks(page)).toHaveText([/Jane Roe/]);

  const output = await applyAndDownload(page);
  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "covered", word: "Jane Roe" },
    { check: "positions", words: ["Jane Roe"] },
    { check: "metadata" },
  ]);
});

test("a document that can't be searched for the approved values isn't added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await approve(page, undefined);
  await saved(page);
  await stopWorkerOnSearch(page);
  await page.reload();
  await expect(marks(page)).toHaveText([/Jane Roe/]);

  await addDocuments(page, letterB);

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText([
    "letter-b.pdf: This file could not be searched for the project's hidden values, so it wasn't added. Reload the page, then add it again.",
  ]);
  await expect(inExplorer(page, "letter-b.pdf")).toHaveCount(0);
});

test("Don't hide here keeps a value in one document only", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aJaneRoe, "Person");
  await approve(page, /hides 2 places/);

  await show(page, "letter-b.pdf");
  await page.getByRole("button", { name: "Don't hide JANE ROE on 2 places, page 1 here" }).click();
  await expect(marks(page)).toHaveCount(0);
  await expect(newMarks(page)).toHaveCount(0);
  // The value is still hidden across the project.
  await page.getByRole("button", { name: "Whole project" }).click();
  await expect(page.getByRole("list", { name: "Hidden in this project" })).toHaveText([/Jane Roe.*1 place in 1 document/]);
  await page.getByRole("button", { name: "This document" }).click();

  await markText(page, 1, bStatement, "Other");
  const output = await applyAndDownload(page);
  await judge(letterB, output, [{ check: "present", text: "JANE ROE" }, { check: "present", text: "Jane Roe in person" }]);
});

test("a box over most of a logo hides the same part of every copy of it in another document, however it is drawn there", async ({ page }) => {
  await openApp(page);
  await openPdf(page, logoA, logoB);
  await drawBox(page, 1, mostOfLogo, "Other");
  await approve(page, /hides 3 places in logo-b\.pdf/);

  // Reload: the parts of images spread are kept.
  await saved(page);
  await page.reload();
  await show(page, "logo-b.pdf");
  await expect(inExplorer(page, "logo-b.pdf")).toContainText("In review");
  await expect(newMarks(page)).toContainText("3 new marks from logo-a.pdf");
  const output = await applyAndDownload(page);
  await judge(logoB, output, [
    { check: "pixels", at: logoHalf, region: [100, 550, 229.6, 646] },
    { check: "pixels", at: logoTurned, region: [304, 550, 400, 679.6] },
    { check: "pixels", at: logoResaved, region: [100, 250, 359.2, 442] },
    { check: "unchanged", at: otherImage },
    { check: "present", text: "Acme Ltd invoice" },
    { check: "metadata" },
  ]);
});

test("a document added later gets the hidden parts of images", async ({ page }) => {
  await openApp(page);
  await openPdf(page, logoA);
  await drawBox(page, 1, mostOfLogo, "Other");
  await approve(page, undefined);

  await addDocuments(page, logoB);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/logo-b\.pdf/);
  await expect(inExplorer(page, "logo-b.pdf")).toContainText("In review");
  await expect(newMarks(page)).toContainText("3 new marks from logo-a.pdf");
});

test("Don't hide here keeps the copies of a logo in one document", async ({ page }) => {
  await openApp(page);
  await openPdf(page, logoA, logoB);
  await drawBox(page, 1, mostOfLogo, "Other");
  await approve(page, /hides 3 places in logo-b\.pdf/);

  await show(page, "logo-b.pdf");
  await page.getByRole("button", { name: "Don't hide Box on 3 places, page 1 here" }).click();
  await expect(marks(page)).toHaveCount(0);
});

test("a box not mostly on an image, or on an image too big, small or plain to tell apart, stays in its document", async ({ page }) => {
  await openApp(page);
  await openPdf(page, logoA, logoB, unmatchableImages);
  await drawBox(page, 1, reference, "Other");
  await drawBox(page, 1, offLogo, "Other");
  await expect(marks(page)).toHaveText([/Stays in this document/, /Stays in this document/]);
  // Nothing spreads, so there is no heads-up.
  await approve(page, undefined);
  await expect(inExplorer(page, "logo-b.pdf")).toContainText("Not started");

  // Page 2 draws the same three images; a scan's page is one image, and two scans of one form would look alike.
  await show(page, "unmatchable-images.pdf");
  await drawBox(page, 1, [150, 250, 350, 350], "Other");
  await drawBox(page, 1, [100, 96, 196, 192], "Other");
  await drawBox(page, 1, [300, 64, 428, 192], "Other");
  await approve(page, undefined);
  await expect(marks(page)).toHaveText([/page 1.*Stays/, /page 1.*Stays/, /page 1.*Stays/]);
});

test("a signature drawn as a stencil, and a logo shaped by its mask, spread to their copies", async ({ page }) => {
  await openApp(page);
  await openPdf(page, signatures);
  // The left 90% of each on page 1, spilling past their other edges.
  await drawBox(page, 1, [90, 154, 272.8, 302], "Other");
  await drawBox(page, 1, [90, 454, 272.8, 602], "Other");
  await approve(page, /It also hides 2 places more in this document/);

  const output = await applyAndDownload(page);
  await judge(signatures, output, [
    { check: "pixels", at: [300, 600, 396, 664], region: [300, 600, 386.4, 664] },
    { check: "pixels", at: [300, 300, 396, 364], region: [300, 300, 386.4, 364], mask: true },
    { check: "metadata" },
  ]);
});

test("removing a hidden value stops hiding it everywhere once its document is approved", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aJaneRoe, "Person");
  await approve(page, /hides 2 places/);

  await page.getByRole("button", { name: "Remove mark Jane Roe on page 1" }).click();
  await expect(inExplorer(page, "letter-a.pdf")).toContainText("In review");
  // Not yet approved, so letter-b.pdf still hides it.
  await expect(inExplorer(page, "letter-b.pdf")).toContainText("2 marks");

  await approve(page, /stops hiding 2 places in letter-b\.pdf/);
  await show(page, "letter-b.pdf");
  await expect(marks(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Whole project" }).click();
  await expect(page.getByText("Nothing is hidden across the project yet.")).toBeVisible();
});

test("a type change spreads on approval", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aJaneRoe, "Person");
  await approve(page, /hides 2 places/);

  await page.getByRole("button", { name: "Change type of Jane Roe on page 1" }).click();
  const picker = page.getByRole("combobox", { name: "Type for this mark" });
  await picker.fill("Other");
  await picker.press("Enter");
  await approve(page, /changes the type of 2 places in letter-b\.pdf/);

  await show(page, "letter-b.pdf");
  await expect(marks(page)).toHaveText([/Other · 2 places/]);
});

test("the review steps through new marks; a spread marks a download as changed; approval names the file and ends undo", async ({ page }) => {
  await openLetters(page);
  await show(page, "letter-b.pdf");
  await markText(page, 1, bStatement, "Other");
  await applyAndDownload(page);
  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(inExplorer(page, "letter-b.pdf")).toContainText("Downloaded");

  await show(page, "letter-a.pdf");
  await markText(page, 1, aJaneRoe, "Person");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await approve(page, /hides 2 places in letter-b\.pdf/);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(inExplorer(page, "letter-b.pdf")).toContainText("Changed since download");

  await show(page, "letter-b.pdf");
  const banner = newMarks(page);
  await expect(banner).toContainText("2 new marks from letter-a.pdf");
  await banner.getByRole("button", { name: "Next" }).click();
  await expect(banner).toContainText("1 of 2, page 1");
  // Stepping to a new mark shows its type on the page.
  await expect(page.locator("#page-1").getByText("Person", { exact: true })).toBeVisible();
  await banner.getByRole("button", { name: "Next" }).click();
  await expect(banner).toContainText("2 of 2, page 1");
  await banner.getByRole("button", { name: "Previous" }).click();
  await expect(banner).toContainText("1 of 2, page 1");

  await approve(page, undefined);
  await expect(newMarks(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(downloadButton(page)).toHaveText("Download cleaned PDF");
  const output = await saveFile(page, () => downloadButton(page).click());
  expect(output).toMatch(/letter-b-redacted\.pdf$/);
  await expect(inExplorer(page, "letter-b.pdf")).toContainText("Downloaded");
});

test("a PDF that draws a line break as a glyph is added, and its text is marked, spread and removed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, lineFeedGlyph, oneWordPdf);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/line-feed-glyph\.pdf/);
  await expect(inExplorer(page, "one-word.pdf")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // The glyph reads as a space, so the value is "Jane Roe", which one-word.pdf holds too.
  await markText(page, 1, janeRoeAndLineFeed, "Person");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await approve(page, /hides 1 place in one-word\.pdf/);

  const output = await applyAndDownload(page);
  await judge(lineFeedGlyph, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "present", text: "thank you for writing to us." },
    { check: "present", text: "We will reply within ten working days." },
    { check: "metadata" },
  ]);
});

// form.pdf's filled field "Jane Roe", flattened into the page by preparation, in the app's box convention.
const formValue: PointBox = [162, 39.1, 213.4, 55.6];

test("a form field's value, made part of the page, is marked, spread and removed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, formPdf, oneWordPdf);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/form\.pdf/);

  await markText(page, 1, formValue, "Person");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await approve(page, /hides 1 place in one-word\.pdf/);
  await judge(formPdf, await applyAndDownload(page), [{ check: "absent", values: ["Jane Roe"] }, { check: "structure" }]);

  await page.getByRole("button", { name: "Back to editing" }).click();
  await show(page, "one-word.pdf");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await judge(oneWordPdf, await applyAndDownload(page), [{ check: "absent", values: ["Jane Roe"] }, { check: "positions", words: ["Jane Roe"] }]);
});

test("a document counts as downloaded only once its file is saved: a cancelled or failed save changes nothing", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await page.getByRole("button", { name: "Preview", exact: true }).click();

  await standInForSaveDialog(page, "cancel");
  await downloadButton(page).click();
  await expect(downloadButton(page)).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Not downloaded");

  await standInForSaveDialog(page, "fail");
  await downloadButton(page).click();
  await expect(page.getByRole("alert")).toHaveText(/could not be saved.*Try again/);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Not downloaded");

  // The project keeps the state: after a reload it is still not downloaded.
  await saved(page);
  await page.reload();
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Not downloaded");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  // A double click saves once: a second dialog while the first opens would be refused.
  await saveFile(page, () => downloadButton(page).dblclick());
  expect(await page.evaluate(() => Reflect.get(window, "refusedDialogs") ?? 0)).toBe(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Downloaded");
});

test("a project saved before review states opens with its marks, in review, and can be approved", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await storeAsVersion1(page, "one-word");

  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("In review");
  await approve(page, undefined);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Approved");
  // Opening it prepared the document again for this build, keeping the text the old project never kept.
  const texts = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const records = await (await root.getDirectoryHandle("one-word")).getDirectoryHandle(".redactorator");
    let count = 0;
    for await (const _ of (await (await records.getDirectoryHandle("pdf-3")).getDirectoryHandle("text")).keys()) count++;
    return count;
  });
  expect(texts).toBe(1);
});

test("in a project saved before review states, a document whose original is gone doesn't stop another being approved", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf, letterB);
  await show(page, "one-word.pdf");
  await markText(page, 1, janeRoe, "Person");
  await storeAsVersion1(page, "letter-b", ["letter-b.pdf"]);

  await show(page, "one-word.pdf");
  await approve(page, undefined);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Approved");
});

test("an approval that can't read the documents approves nothing and says so, until the next approval", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  // Approving needs the text, which it never reads from the original: it is prepared again.
  await loseReading(page, "one-word", "one-word.pdf");

  await approveButton(page).click();
  const failed = page.getByRole("alert").filter({ hasText: "The documents' text could not be read, so nothing was approved. Reload the page and approve again." });
  await expect(failed).toBeVisible();
  await expect(inExplorer(page, "one-word.pdf")).toContainText("In review");

  await approve(page, undefined);
  await expect(failed).toHaveCount(0);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Approved");
});

test("an approval that can't read the documents says so only in its project", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await loseReading(page, "one-word", "one-word.pdf");
  await approveButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("The documents' text could not be read, so nothing was approved. Reload the page and approve again.");

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("while an approval is worked out, the page and the marks panel take no marks, and the approval then lands", async ({ page }) => {
  const release = await holdApprovalSearch(page);
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await approveButton(page).click();
  await expect(approveButton(page)).toBeDisabled();

  // The page offers no marking tool, so a drag across it makes no mark waiting for its type.
  await expect(page.getByRole("application", { name: /^Page 1, / })).toHaveCount(0);
  const [x0, y0, x1, y1] = dear;
  const start = await toScreen(page, 1, x0 + 1, (y0 + y1) / 2);
  const end = await toScreen(page, 1, x1 - 1, (y0 + y1) / 2);
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(...end, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("combobox", { name: "Type for this mark" })).toHaveCount(0);
  const panel = page.getByRole("complementary", { name: "Marks" });
  await expect(panel.getByRole("button", { name: /^Remove mark Jane Roe/ })).toBeDisabled();
  await expect(panel.getByRole("button", { name: /^Change type of Jane Roe/ })).toBeDisabled();

  await release();
  await approvalLands(page, undefined);
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await expect(panel.getByRole("button", { name: /^Remove mark Jane Roe/ })).toBeEnabled();
  await saved(page);
  await page.reload();
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Approved");
});

test("a file dropped while an approval is worked out isn't added, and says why", async ({ page }) => {
  const release = await holdApprovalSearch(page);
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await addDocuments(page, encryptedPdf);
  await expect(page.getByText(/This PDF is encrypted/)).toBeVisible();
  await approveButton(page).click();

  await dropFiles(page, page.locator("#page-1"), [letterB]);
  await expect(page.getByText("This file wasn't added while a document was being approved. Add it again once the approval is done.")).toBeVisible();
  // The earlier refusal is still listed with it.
  await expect(page.getByText(/This PDF is encrypted/)).toBeVisible();
  await release();
  await approvalLands(page, undefined);
  await expect(inExplorer(page, "letter-b.pdf")).toHaveCount(0);
});

test("a file dropped while other files are being added isn't added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  // Held from here on: the next file's preparation, which keeps the add under way.
  const release = await holdPreparation(page);
  await page.reload();
  await addDocuments(page, letterB);

  await dropFiles(page, page.locator("#page-1"), [letterA]);

  await expect(page.getByText("letter-a.pdf: Documents are being added. Try again once they are in the project.")).toBeVisible();
  await release();
  await expect(inExplorer(page, "letter-b.pdf")).toBeVisible();
  await expect(inExplorer(page, "letter-a.pdf")).toHaveCount(0);
});

test("a document can't be approved or switched while files are being added, and can once they're in", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await saved(page);
  // Held from here on: the next file's preparation, which keeps the add under way.
  const release = await holdPreparation(page);
  await page.reload();
  await expect(marks(page)).toHaveText([/Jane Roe/]);

  await addDocuments(page, letterB);
  await expect(approveButton(page)).toBeDisabled();
  // No other document opens while the add runs either.
  await expect(inExplorer(page, "one-word.pdf")).toBeDisabled();
  await release();
  await expect(inExplorer(page, "letter-b.pdf")).toBeVisible();
  await show(page, "one-word.pdf");
  await approve(page, /hides 2 places in letter-b\.pdf/);
});

test("no document can be added while the approval heads-up is open, and one can once it is answered", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aJaneRoe, "Person");
  await approveButton(page).click();
  const dialog = page.getByRole("dialog", { name: /^Approve/ });
  await expect(dialog).toContainText(/hides 2 places in letter-b\.pdf/);

  await expect(page.getByLabel("Add documents")).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Add documents")).toBeEnabled();
});

test("cancelling the approval heads-up approves nothing and changes no other document", async ({ page }) => {
  await openLetters(page);
  await markText(page, 1, aJaneRoe, "Person");
  await approveButton(page).click();
  const dialog = page.getByRole("dialog", { name: /^Approve/ });
  await expect(dialog).toContainText(/hides 2 places in letter-b\.pdf/);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(inExplorer(page, "letter-a.pdf")).toContainText("In review");
  await expect(inExplorer(page, "letter-b.pdf")).toContainText("Not started");
  await saved(page);
  await page.reload();
  await show(page, "letter-b.pdf");
  await expect(marks(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Whole project" }).click();
  await expect(page.getByText("Nothing is hidden across the project yet.")).toBeVisible();
});

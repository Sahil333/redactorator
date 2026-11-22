import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import {
  addDocuments,
  applyAndDownload,
  dear,
  downloadButton,
  dropFiles,
  encryptedPdf,
  janeRoe,
  markText,
  oneWordPdf,
  openApp,
  openPdf,
  saved,
  saveFile,
  standInForSaveDialog,
  wrapEngine,
  type PointBox,
} from "./app";
import { judge } from "./oracle";

const letterA = new URL("../../fixtures/letter-a.pdf", import.meta.url).pathname;
const letterB = new URL("../../fixtures/letter-b.pdf", import.meta.url).pathname;
const lineFeedGlyph = new URL("../../fixtures/line-feed-glyph.pdf", import.meta.url).pathname;

// Words of letter-a.pdf and letter-b.pdf, from tests/oracle/README.md, in the app's box convention.
const aJaneRoe: PointBox = [72, 79.1, 123.4, 95.6];
const aAccount: PointBox = [72, 99.1, 128.7, 115.6];
const aRoe: PointBox = [72, 119.1, 94.0, 135.6];
const bStatement: PointBox = [72, 79.1, 126.7, 95.6];
// "Jane Roe" and the line-feed glyph after it in line-feed-glyph.pdf.
const janeRoeAndLineFeed: PointBox = [101.3, 79.1, 156.0, 95.6];

const explorer = (page: Page) => page.getByRole("navigation", { name: "Documents" });
const inExplorer = (page: Page, file: string) => explorer(page).getByRole("button", { name: new RegExp(`^${file.replace(".", "\\.")}`) });
const marks = (page: Page) => page.getByRole("complementary", { name: "Marks" }).getByRole("listitem");
const approveButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Approve", exact: true });
const newMarks = (page: Page) => page.getByRole("region", { name: "New marks" });

/**
 * Makes the engine hold its replies of `type` until the returned function releases them: "matched"
 * keeps an approval under way, "inspected" an add.
 */
async function holdReplies(page: Page, type: "matched" | "inspected"): Promise<() => Promise<void>> {
  await wrapEngine(
    page,
    `const send = globalThis.postMessage.bind(globalThis);
    const held = [];
    let holding = true;
    new BroadcastChannel("held-replies").onmessage = () => {
      holding = false;
      for (const [message, options] of held.splice(0)) send(message, options);
    };
    globalThis.postMessage = (message, options) => (holding && message.type === "${type}" ? held.push([message, options]) : send(message, options));`,
  );
  return () => page.evaluate(() => new BroadcastChannel("held-replies").postMessage("release"));
}

/** Rewrites the stored project as slice 1 kept it: version 1, no review fields, no stored text; and deletes `gone` from its folder. */
async function storeAsVersion1(page: Page, folder: string, gone: readonly string[] = []): Promise<void> {
  await saved(page);
  await page.evaluate(
    async ({ folder, gone }) => {
      const root = await navigator.storage.getDirectory();
      const project = await root.getDirectoryHandle(folder);
      const records = await project.getDirectoryHandle(".redactorator");
      const file = await records.getFileHandle("project.json");
      const added = new Set(["hidden", "review", "download", "shown", "isNew"]);
      const text = (await (await file.getFile()).text()).replace('"version":2', '"version":1');
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(JSON.parse(text), (key, value: unknown) => (added.has(key) ? undefined : value)));
      await writable.close();
      await records.removeEntry("text", { recursive: true });
      for (const name of gone) await project.removeEntry(name);
    },
    { folder, gone },
  );
  await page.reload();
}

/** Starts a project from both letters, with letter-a.pdf open. */
async function openLetters(page: Page): Promise<void> {
  await openApp(page);
  await openPdf(page, letterA, letterB);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/letter-a\.pdf/);
}

/** Approves the open document and, when it changes other documents, agrees to the heads-up. */
async function approve(page: Page, headsUp: RegExp | undefined): Promise<void> {
  await approveButton(page).click();
  if (headsUp !== undefined) {
    const dialog = page.getByRole("dialog", { name: /^Approve/ });
    await expect(dialog).toContainText(headsUp);
    await dialog.getByRole("button", { name: "Approve" }).click();
  }
  await expect(page.getByRole("banner").getByText("Approved", { exact: true })).toBeVisible();
}

async function show(page: Page, file: string): Promise<void> {
  await inExplorer(page, file).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(new RegExp(file.replace(".", "\\.")));
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
  await page.getByRole("button", { name: "Apply and check" }).click();
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

test("a document counts as downloaded only once its file is saved: a cancelled or failed save changes nothing", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await page.getByRole("button", { name: "Apply and check" }).click();

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
  await page.getByRole("button", { name: "Apply and check" }).click();
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
  // Approving read the original again for the text the old project never kept, and kept it.
  const texts = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const records = await (await root.getDirectoryHandle("one-word")).getDirectoryHandle(".redactorator");
    let count = 0;
    for await (const _ of (await records.getDirectoryHandle("text")).keys()) count++;
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

test("a mark made while an approval is worked out is kept, and approved with the rest", async ({ page }) => {
  const release = await holdReplies(page, "matched");
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await approveButton(page).click();
  await expect(approveButton(page)).toBeDisabled();

  await markText(page, 1, dear, "Other");
  await release();
  await expect(page.getByRole("banner").getByText("Approved", { exact: true })).toBeVisible();
  await expect(marks(page)).toHaveText([/Jane Roe/, /Dear/]);
  await saved(page);
  await page.reload();
  await expect(marks(page)).toHaveText([/Jane Roe/, /Dear/]);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Approved");
});

test("a file dropped while an approval is worked out isn't added, and says why", async ({ page }) => {
  const release = await holdReplies(page, "matched");
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
  await expect(page.getByRole("banner").getByText("Approved", { exact: true })).toBeVisible();
  await expect(inExplorer(page, "letter-b.pdf")).toHaveCount(0);
});

test("a document can't be approved while files are being added, and can once they're in", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await saved(page);
  // Held from here on: the next file's inspection, which keeps the add under way.
  const release = await holdReplies(page, "inspected");
  await page.reload();
  await expect(marks(page)).toHaveText([/Jane Roe/]);

  await addDocuments(page, letterB);
  await expect(approveButton(page)).toBeDisabled();
  await release();
  await expect(inExplorer(page, "letter-b.pdf")).toBeVisible();
  await show(page, "one-word.pdf");
  await approve(page, /hides 2 places in letter-b\.pdf/);
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

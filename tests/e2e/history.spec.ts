import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import {
  addDocuments,
  aJaneRoe,
  applyAndDownload,
  approve,
  approveButton,
  bStatement,
  dear,
  drawBox,
  inExplorer,
  janeRoe,
  letterA,
  letterB,
  markText,
  marks,
  oneWordPdf,
  openApp,
  openPdf,
  saved,
  show,
  storedJson,
  twoPagePdf,
} from "./app";
import { delayApplied, holdApprovalSearch, holdInspection } from "./fakes";

const undoButton = (page: Page) => page.getByRole("button", { name: "Undo" });
const redoButton = (page: Page) => page.getByRole("button", { name: "Redo" });

test("a new change after an undo clears redo", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await undoButton(page).click();
  await expect(redoButton(page)).toBeEnabled();

  await markText(page, 1, dear, "Other");

  await expect(redoButton(page)).toBeDisabled();
  await expect(marks(page)).toHaveText([/Dear/]);
});

test("undo and redo mark a downloaded document as changed since its download, and keep it in review", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await markText(page, 1, dear, "Other");
  await undoButton(page).click();
  await applyAndDownload(page);
  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Downloaded");

  await redoButton(page).click();
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Changed since download");
  await expect(inExplorer(page, "one-word.pdf")).toContainText("In review");

  await applyAndDownload(page);
  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Downloaded");
  await undoButton(page).click();
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Changed since download");
  await expect(inExplorer(page, "one-word.pdf")).toContainText("In review");
});

test("undoing Don't hide here brings the value back, and marking the value again stops keeping it visible", async ({ page }) => {
  const keepHere = page.getByRole("button", { name: "Don't hide Jane Roe on page 1 here" });
  const storedProject = () => storedJson(page, "one-word/.redactorator/project.json");
  const shown = ["documents", "0", "shown"];
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await approve(page, undefined);

  await keepHere.click();
  await expect(marks(page)).toHaveCount(0);
  await undoButton(page).click();
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await saved(page);
  expect(await storedProject()).toHaveProperty(shown, []);

  await keepHere.click();
  await saved(page);
  expect(await storedProject()).toHaveProperty([...shown, "length"], 1);
  await markText(page, 1, janeRoe, "Person");
  await saved(page);
  expect(await storedProject()).toHaveProperty(shown, []);
});

test("approval ends undo only in the documents it changed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, letterA, letterB, twoPagePdf);
  await show(page, "letter-b.pdf");
  await markText(page, 1, bStatement, "Other");
  await show(page, "two-pages.pdf");
  await drawBox(page, 1, [72, 300, 200, 340], "Other");
  await show(page, "letter-a.pdf");
  await markText(page, 1, aJaneRoe, "Person");

  await approve(page, /hides 2 places in letter-b\.pdf/);

  await expect(undoButton(page)).toBeDisabled();
  await show(page, "letter-b.pdf");
  await expect(undoButton(page)).toBeDisabled();
  await show(page, "two-pages.pdf");
  await expect(undoButton(page)).toBeEnabled();
});

test("undo waits while an apply runs", async ({ page }) => {
  await delayApplied(page, 2000);
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await expect(undoButton(page)).toBeEnabled();

  await page.getByRole("button", { name: "Apply and check" }).click();

  await expect(page.getByRole("status")).toHaveText("Applying and checking…");
  await expect(undoButton(page)).toBeDisabled();
  await expect(page.getByText("Checked:")).toBeVisible();
});

test("undo waits while an approval is worked out", async ({ page }) => {
  const release = await holdApprovalSearch(page);
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await expect(undoButton(page)).toBeEnabled();

  await approveButton(page).click();

  await expect(approveButton(page)).toBeDisabled();
  await expect(undoButton(page)).toBeDisabled();
  await release();
  await expect(page.getByRole("banner").getByText("Approved", { exact: true })).toBeVisible();
});

test("undo waits while documents are being added", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  // Held from here on: the next file's inspection, which keeps the add under way.
  const release = await holdInspection(page);
  await page.reload();
  await markText(page, 1, janeRoe, "Person");
  await expect(undoButton(page)).toBeEnabled();

  await addDocuments(page, letterB);

  await expect(undoButton(page)).toBeDisabled();
  await release();
  await expect(inExplorer(page, "letter-b.pdf")).toBeVisible();
  await show(page, "one-word.pdf");
  await expect(undoButton(page)).toBeEnabled();
});

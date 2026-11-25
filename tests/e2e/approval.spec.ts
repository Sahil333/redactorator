// The approval dialog's list of what preparing a document removed (docs/designs/pdf-leak-suite.md,
// part 8): kinds only, in Appendix A.3's words and order, each listed once per document.
import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { holdReadFromStart } from "./fakes";
import { addDocuments, approveButton, dear, documentId, fixturePath, inExplorer, janeRoe, letterA, letterB, markText, oneWordPdf, openApp, openPdf, saved, show, storedJson } from "./app";

const dialog = (page: Page) => page.getByRole("dialog", { name: /^Approve/ });
const removedList = (page: Page) => dialog(page).getByRole("region", { name: "Removed from this file" }).getByRole("listitem");
const approved = (page: Page) => page.getByRole("banner").getByText("Approved", { exact: true });
// Preparing one-word.pdf removes its document information and an earlier revision.
const oneWordRemoved = ["Document information and metadata: removed", "Earlier versions of the file: removed"];

/** Rewrites the JSON file at `path` in the browser's private storage with `change` applied. */
async function changeStoredJson(page: Page, path: string, change: (value: unknown) => unknown): Promise<void> {
  const text = JSON.stringify(change(await storedJson(page, path)));
  await page.evaluate(
    async ({ path, text }) => {
      const names = path.split("/");
      const name = names.pop() ?? "";
      let folder = await navigator.storage.getDirectory();
      for (const each of names) folder = await folder.getDirectoryHandle(each);
      const writable = await (await folder.getFileHandle(name)).createWritable();
      await writable.write(text);
      await writable.close();
    },
    { path, text },
  );
}

/** `project` with every document's listed kinds set to `kinds`. */
function withRemovedSeen(project: unknown, kinds: readonly string[]): unknown {
  const documents: unknown = Reflect.get(Object(project), "documents");
  return { ...Object(project), documents: Array.isArray(documents) ? documents.map((document: unknown) => ({ ...Object(document), removedSeen: kinds })) : documents };
}

test("the dialog lists every kind preparing removed, in the design's order, with Approve focused, and Enter approves", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/carriers.pdf"));
  await approveButton(page).click();

  await expect(removedList(page)).toHaveText([
    "Document information and metadata: removed",
    "Image camera data: removed",
    "Attachments: removed",
    "Scripts and actions: removed",
    "Links: removed",
    "Bookmarks: removed",
    "Page labels and article threads: removed",
    "Accessibility tags: removed",
    "Page thumbnails: removed",
    "Private application data: removed",
    "Earlier versions of the file: removed",
  ]);
  await expect(dialog(page).getByRole("button", { name: "Approve" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(approved(page)).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test("a form's and a signature's kinds are listed (CUJs 1 and 2)", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/form.pdf"));
  await approveButton(page).click();
  await expect(removedList(page)).toHaveText(["Form data: made part of the page", "Digital signature: removed; the cleaned file is not signed"]);
});

test("a document whose preparation removed nothing approves with no dialog", async ({ page }) => {
  await openApp(page);
  await openPdf(page, letterA);
  await approveButton(page).click();
  await expect(approved(page)).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test("cancelling lists the kinds again next time; once approved, a later approval lists only kinds not listed before, across a reload", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await approveButton(page).click();
  await expect(removedList(page)).toHaveText(oneWordRemoved);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(inExplorer(page, "one-word.pdf")).toContainText("Not started");

  await approveButton(page).click();
  await expect(removedList(page)).toHaveText(oneWordRemoved);
  await dialog(page).getByRole("button", { name: "Approve" }).click();
  await expect(approved(page)).toBeVisible();

  // A mark sends it back to review; its kinds were listed, so approving it lands at once.
  await markText(page, 1, janeRoe, "Person");
  await saved(page);
  await page.reload();
  await approveButton(page).click();
  await expect(approved(page)).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);

  // As if an earlier approval had listed only its document information, and this build's
  // preparation had then found the earlier revision.
  await markText(page, 1, dear, "Person");
  await saved(page);
  await changeStoredJson(page, "one-word/.redactorator/pdf-3/project.json", (project) => withRemovedSeen(project, ["metadata"]));
  await page.reload();
  await approveButton(page).click();
  await expect(removedList(page)).toHaveText(["Earlier versions of the file: removed"]);
});

test("a document can't be approved until its prepared files are read, so the dialog always knows what was removed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  const release = await holdReadFromStart(page, `${await documentId(page, "one-word", "one-word.pdf")}.json`, 1);
  await page.reload();
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await expect(approveButton(page)).toBeDisabled();
  await release();
  await approveButton(page).click();
  await expect(removedList(page)).toHaveText(oneWordRemoved);
});

test("a dialog for an approval that spreads also lists what was removed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await addDocuments(page, letterB);
  await show(page, "one-word.pdf");
  await markText(page, 1, janeRoe, "Person");
  await approveButton(page).click();
  await expect(dialog(page)).toContainText(/hides 2 places in letter-b\.pdf/);
  await expect(removedList(page)).toHaveText(oneWordRemoved);
});

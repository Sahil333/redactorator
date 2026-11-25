import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { failWrites, holdApprovalSearch, holdPreparation, holdRead, holdReadFromStart, holdWrites, restoreWrites, stopWorkerAfter, writeAttempts } from "./fakes";
import {
  aJaneRoe,
  addDocuments,
  approveButton,
  crossPagePdf,
  dropFiles,
  dear,
  encryptedPdf,
  explorer,
  imagePdf,
  inExplorer,
  inkedPixels,
  janeRoe,
  letterA,
  letterB,
  longPdf,
  markText,
  marks,
  maskedImagePdf,
  oneWordPdf,
  openApp,
  openPdf,
  printTypes,
  rotatedCroppedPdf,
  saved,
  showPageList,
  standInForFolderPicker,
  storedNames,
  storedText,
  tablePdf,
  twoPagePdf,
} from "./app";

const projectName = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" });
const projectRow = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name, exact: true }) });

async function goHome(page: Page): Promise<void> {
  await projectName(page).getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

async function rowAction(page: Page, project: string, action: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${project}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

test("PDFs dropped on home become one project, named after the first", async ({ page }) => {
  await openApp(page);
  await dropFiles(page, page.getByRole("main"), [oneWordPdf, twoPagePdf]);

  await expect(projectName(page)).toContainText("one-word");
  await expect(explorer(page).getByRole("button")).toHaveText([/^one-word\.pdf/, /^two-pages\.pdf/]);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/one-word\.pdf/);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
});

test("a chosen folder becomes a project, and files that cannot be added are listed with the reason", async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), "folder-"));
  await copyFile(oneWordPdf, join(folder, "a-letter.pdf"));
  await copyFile(twoPagePdf, join(folder, "b-report.pdf"));
  await copyFile(encryptedPdf, join(folder, "c-locked.pdf"));
  await writeFile(join(folder, "d-notes.txt"), "not a document");
  await openApp(page);

  await page.getByLabel("Choose a folder").setInputFiles(folder);

  await expect(explorer(page).getByRole("button")).toHaveText([/^a-letter\.pdf/, /^b-report\.pdf/]);
  const notAdded = page.getByRole("region", { name: "2 files not added" });
  await expect(notAdded.getByRole("listitem")).toHaveText([
    "c-locked.pdf: This PDF is encrypted. Remove its password in the app that made it, then open it again.",
    "d-notes.txt: This is not a PDF.",
  ]);
});

test("when no chosen file can be added, no project is made", async ({ page }) => {
  await openApp(page);
  await openPdf(page, encryptedPdf);

  await expect(page.getByRole("region", { name: "1 file not added" })).toContainText("encrypted.pdf");
  await expect(page.getByLabel("Choose PDFs")).toBeEnabled();
  expect(await storedNames(page)).toEqual([]);
});

test("files that cannot be saved as a new project say so, still list those that were not added, and leave no project", async ({ page }) => {
  const notes = join(await mkdtemp(join(tmpdir(), "notes-")), "notes.txt");
  await writeFile(notes, "not a document");
  await openApp(page);
  await failWrites(page);

  await page.getByLabel("Choose PDFs").setInputFiles([oneWordPdf, notes]);

  await expect(page.getByRole("alert")).toHaveText("That change could not be saved. Check that the disk has space, then try again.");
  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(["notes.txt: This is not a PDF."]);
  await expect(page.getByLabel("Choose PDFs")).toBeEnabled();
  expect(await storedNames(page)).toEqual([]);
});

test("marks, custom types and appearance survive a reload", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Client");
  await printTypes(page);
  await page.keyboard.press("Escape");
  await saved(page);
  // Settings are saved apart from the project: wait until the label setting is stored.
  await expect.poll(() => storedText(page, ".redactorator/settings.json")).toContain('"label":true');

  await page.reload();
  await goHome(page);
  await page.getByRole("button", { name: "one-word", exact: true }).click();

  await expect(marks(page)).toHaveText([/Jane Roe.*Client · page 1/]);
  await page.getByRole("button", { name: "Appearance" }).click();
  await expect(page.getByLabel("Print the type in each box")).toBeChecked();
});

test("undo and redo a mark, with the buttons and the keys", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(marks(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(marks(page)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(marks(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(marks(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
});

test("documents added to an open project open in tabs, each with its own marks", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");

  await addDocuments(page, twoPagePdf);
  const tabs = page.getByRole("tablist", { name: "Open documents" }).getByRole("tab");
  await expect(tabs).toHaveText([/one-word\.pdf/, /two-pages\.pdf/]);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/two-pages\.pdf/);
  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");
  await expect(marks(page)).toHaveCount(0);

  await explorer(page).getByRole("button", { name: /^one-word\.pdf/ }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/one-word\.pdf/);
  await expect(marks(page)).toHaveText([/Jane Roe/]);

  await page.getByRole("button", { name: "Close two-pages.pdf" }).click();
  await expect(tabs).toHaveText([/one-word\.pdf/]);
});

test("tabs that don't fit scroll with no scrollbar, and the open document's tab comes into view", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await openApp(page);
  const files = [oneWordPdf, twoPagePdf, imagePdf, rotatedCroppedPdf, crossPagePdf, tablePdf, maskedImagePdf, longPdf];
  await openPdf(page, ...files);
  for (const file of files) await explorer(page).getByRole("button", { name: new RegExp(`^${basename(file).replace(".", "\\.")}`) }).click();
  const strip = page.getByRole("tablist", { name: "Open documents" });
  await expect(strip.getByRole("tab")).toHaveCount(files.length);

  // The last one opened is in view, at the far end. Headless Chrome hides every scrollbar, so
  // the strip's own style is what says Chrome would draw none.
  await expect(strip.getByRole("tab", { name: "long.pdf" })).toBeInViewport();
  const shown = await strip.evaluate((element) => ({ overflows: element.scrollWidth > element.clientWidth, scrollbar: getComputedStyle(element).scrollbarWidth }));
  expect(shown).toEqual({ overflows: true, scrollbar: "none" });

  const leftmost = strip.getByRole("tab").first();
  await expect(leftmost).not.toBeInViewport();
  await explorer(page).getByRole("button", { name: new RegExp(`^${(await leftmost.textContent()) ?? ""}`) }).click();
  await expect(leftmost).toBeInViewport();
});

test("the documents list starts shown and the page thumbnails hidden, and each can be toggled", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  const documents = page.getByRole("button", { name: "Documents", exact: true });
  const pages = page.getByRole("button", { name: "Pages", exact: true });
  const thumbnails = page.getByRole("navigation", { name: "Pages" });
  await expect(documents).toHaveAttribute("aria-pressed", "true");
  await expect(explorer(page)).toBeVisible();
  await expect(pages).toHaveAttribute("aria-pressed", "false");
  await expect(thumbnails).toHaveCount(0);

  await pages.click();
  await expect(thumbnails).toBeVisible();
  await documents.click();
  await expect(documents).toHaveAttribute("aria-pressed", "false");
  await expect(explorer(page)).toHaveCount(0);
  await pages.click();
  await expect(thumbnails).toHaveCount(0);
  await documents.click();
  await expect(explorer(page)).toBeVisible();
});

test("projects can be renamed, duplicated, archived and deleted, and delete leaves no files", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await saved(page);
  await goHome(page);

  await rowAction(page, "one-word", "Rename");
  await page.getByRole("textbox", { name: "Project name" }).fill("Harper v. Lindqvist");
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");
  await rowAction(page, "Harper v. Lindqvist", "Duplicate");
  await expect(projectRow(page, "Harper v. Lindqvist (copy)")).toContainText("1 document");

  // The menu works from the keyboard: it opens on its first item, and the arrows move down to Archive.
  await page.getByRole("button", { name: "Actions for Harper v. Lindqvist (copy)" }).press("Enter");
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Archived (1)")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Harper v. Lindqvist", exact: true })).toBeVisible();
  await page.getByText("Archived (1)").click();
  await page.getByRole("button", { name: "Harper v. Lindqvist (copy)", exact: true }).click();
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await goHome(page);

  for (const name of ["Harper v. Lindqvist", "Harper v. Lindqvist (copy)"]) {
    if (name.endsWith("(copy)")) await page.getByText("Archived (1)").click();
    await rowAction(page, name, "Delete");
    const dialog = page.getByRole("dialog", { name: `Delete “${name}”?` });
    await expect(dialog).toContainText("This can't be undone.");
    await dialog.getByRole("button", { name: "Delete project" }).click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  expect((await storedNames(page)).filter((name) => name !== ".redactorator")).toEqual([]);
});

test("a project open in another tab can't be renamed, duplicated, archived or deleted here", async ({ page, context }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  const other = await context.newPage();
  await other.goto("/");
  const refused = "“one-word” is open in another tab. Close it there to change it here.";
  const changes: Record<string, () => Promise<void>> = {
    Rename: async () => {
      await other.getByRole("textbox", { name: "Project name" }).fill("Renamed");
      await other.getByRole("textbox", { name: "Project name" }).press("Enter");
    },
    Duplicate: async () => undefined,
    Archive: async () => undefined,
    Delete: async () => {
      await other.getByRole("dialog", { name: "Delete “one-word”?" }).getByRole("button", { name: "Delete project" }).click();
    },
  };

  for (const [action, finish] of Object.entries(changes)) {
    // A fresh list each time, so each refusal is this action's own.
    await other.reload();
    await rowAction(other, "one-word", action);
    await finish();
    await expect(other.getByRole("alert")).toHaveText(refused);
  }

  await other.reload();
  await expect(other.getByRole("listitem")).toHaveText([/^one-word/]);
  expect((await storedNames(page)).filter((name) => name !== ".redactorator")).toEqual(["one-word"]);
});

test("while chosen files are made into a project, no project can be opened and no folder chosen", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  await goHome(page);
  // Held from here on: the next file's preparation, which keeps the new project being made.
  const release = await holdPreparation(page);
  await page.reload();
  const chooseFolder = page.getByRole("button", { name: "Choose a folder for projects" });
  await expect(page.getByLabel("New project")).toBeEnabled();
  await expect(chooseFolder).toBeEnabled();

  await page.getByLabel("New project").setInputFiles([twoPagePdf]);

  await expect(page.getByRole("button", { name: "one-word", exact: true })).toBeDisabled();
  await expect(chooseFolder).toBeDisabled();
  await release();
  await expect(projectName(page)).toContainText("two-pages");
});

test("files dropped while the projects are still being read are not made into a project", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  await goHome(page);
  // The project list's first read as the page starts is held, so the projects are still being read.
  const release = await holdReadFromStart(page, "project.json", 1);
  await page.reload();
  await dropFiles(page, page.getByRole("main"), [twoPagePdf]);
  await release();
  await expect(page.getByRole("button", { name: "one-word", exact: true })).toBeVisible();

  // Files dropped now make a project, which a project still being made from the first drop would refuse.
  await dropFiles(page, page.getByRole("main"), [crossPagePdf]);

  await expect(projectName(page)).toContainText("cross-page");
  expect((await storedNames(page)).filter((name) => name !== ".redactorator").sort()).toEqual(["cross-page", "one-word"]);
});

test("a change to a project that goes through clears the reason an earlier action failed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await goHome(page);
  await standInForFolderPicker(page, "Empty");
  await page.getByRole("button", { name: "Import a project" }).click();
  await expect(page.getByRole("alert")).toContainText("That folder holds no Redactorator project.");

  await rowAction(page, "one-word", "Rename");
  await page.getByRole("textbox", { name: "Project name" }).fill("Renamed");
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");

  await expect(projectRow(page, "Renamed")).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();
});

test("a project open in another tab is not opened twice", async ({ page, context }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await expect(projectName(page)).toContainText("one-word");

  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "one-word", exact: true }).click();

  await expect(other.getByRole("alert")).toHaveText("“one-word” is open in another tab. Close it there to open it here.");
  await expect(other.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("a project whose file is damaged or from a newer version is listed with the reason, and left as it is", async ({ page }) => {
  await openApp(page);
  const written = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const write = async (folder: string, text: string) => {
      const records = await (await root.getDirectoryHandle(folder, { create: true })).getDirectoryHandle(".redactorator", { create: true });
      const writable = await (await records.getFileHandle("project.json", { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    };
    await write("Broken", "{ not json");
    await write("Future", JSON.stringify({ format: "redactorator-project", version: 99 }));
    return "{ not json";
  });
  await page.reload();

  await expect(page.getByRole("listitem").filter({ hasText: "Broken" })).toContainText("Its project file is damaged, so it can't be opened.");
  await expect(page.getByRole("listitem").filter({ hasText: "Future" })).toContainText("saved by a newer version of Redactorator");
  const kept = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const records = await (await root.getDirectoryHandle("Broken")).getDirectoryHandle(".redactorator");
    return (await (await records.getFileHandle("project.json")).getFile()).text();
  });
  expect(kept).toBe(written);
});

test("a document whose original and working copy are gone from the project says so", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf, twoPagePdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  // The working copy is what is shown; with it gone it would be made again from the original.
  await page.evaluate(async () => {
    const project = await (await navigator.storage.getDirectory()).getDirectoryHandle("one-word");
    await project.removeEntry("two-pages.pdf");
    await (await (await project.getDirectoryHandle(".redactorator")).getDirectoryHandle("pdf-3")).removeEntry("working", { recursive: true });
  });

  await explorer(page).getByRole("button", { name: /^two-pages\.pdf/ }).click();

  await expect(page.getByRole("alert")).toHaveText("two-pages.pdf is missing from the project's folder, so it can't be shown. Add the file again with Add documents.");
  await expect(page.getByRole("img", { name: "Page 1" })).toHaveCount(0);
});

test("Back and Forward move between the projects and an open project, and a reload keeps it open", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await saved(page);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(projectRow(page, "one-word")).toContainText("1 mark");

  await page.goForward();
  await expect(projectName(page)).toContainText("one-word");
  await expect(marks(page)).toHaveText([/Jane Roe/]);

  await page.reload();
  await expect(projectName(page)).toContainText("one-word");
  await goHome(page);
  await page.goBack();
  await expect(projectName(page)).toContainText("one-word");
});

test("a long project name wraps in the delete dialog instead of spilling out", async ({ page }) => {
  // One unbroken word, as a project named after a file often is.
  const name = "Harper_Holdings_International_Limited_v_Lindqvist_and_Partners_Aktiebolag_appeal_2026-0042_final_v3";
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await goHome(page);
  await rowAction(page, "one-word", "Rename");
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");

  await rowAction(page, name, "Delete");

  const dialog = page.getByRole("dialog", { name: `Delete “${name}”?` });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("links to pages, in the marks panel and the page list, scroll the pages and keep the project open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openApp(page);
  await openPdf(page, oneWordPdf, twoPagePdf);
  await markText(page, 1, janeRoe, "Person");
  await page.getByRole("complementary", { name: "Marks" }).getByRole("link", { name: "Jane Roe" }).click();

  await expect(projectName(page)).toContainText("one-word");
  await expect(page.getByRole("img", { name: "Page 1" })).toBeInViewport();

  await explorer(page).getByRole("button", { name: /^two-pages\.pdf/ }).click();
  await showPageList(page);
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Page 2" }).click();

  await expect(page.getByRole("status")).toHaveText("Page 2 of 2");
  await expect(projectName(page)).toContainText("one-word");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("a reload brings back the open tabs and the one shown, with its pages drawn", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf, twoPagePdf);
  await explorer(page).getByRole("button", { name: /^two-pages\.pdf/ }).click();
  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");

  await page.reload();

  await expect(page.getByRole("tablist", { name: "Open documents" }).getByRole("tab")).toHaveText([/one-word\.pdf/, /two-pages\.pdf/]);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(/two-pages\.pdf/);
  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");
  await expect.poll(() => inkedPixels(page.getByRole("img", { name: "Page 1" }))).toBeGreaterThan(100);
});

test("a reload with no tabs open keeps them all closed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf, twoPagePdf);
  await page.getByRole("button", { name: "Close one-word.pdf" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);

  await page.reload();

  await expect(projectName(page)).toContainText("one-word");
  await expect(explorer(page).getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText("Open a document from the list, or drop PDFs here to add them.")).toBeVisible();
});

/** The names of the files in a project's folder, leaving out its records. */
const filesInFolder = (page: Page, folder: string) =>
  page.evaluate(async (name) => {
    const names: string[] = [];
    for await (const [entry, handle] of (await (await navigator.storage.getDirectory()).getDirectoryHandle(name)).entries()) {
      if (handle.kind === "file") names.push(entry);
    }
    return names.sort();
  }, folder);

test("of two lists of the projects read at once, the one started last stays, though the other finishes after it", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await goHome(page);
  // Listed afresh, so no read of the list made on leaving is still under way when the hold starts counting.
  await page.reload();
  await expect(projectRow(page, "one-word")).toBeVisible();
  const rename = async (from: string, to: string) => {
    await rowAction(page, from, "Rename");
    await page.getByRole("textbox", { name: "Project name" }).fill(to);
    await page.getByRole("textbox", { name: "Project name" }).press("Enter");
  };

  // A rename reads the project again, saves it, then lists the projects: that list's read is held.
  const release = await holdRead(page, "project.json", 2);
  await rename("one-word", "First");
  // Saved, and so let go, before the second rename asks for the project's lock.
  await expect.poll(() => storedText(page, "one-word/.redactorator/pdf-3/project.json")).toContain('"name":"First"');
  await rename("one-word", "Second");
  await expect(projectRow(page, "Second")).toBeVisible();
  await release();
  // The held list, read while the project was called "First", lands within a few ticks.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  await expect(projectRow(page, "Second")).toBeVisible();
  await expect(page.getByRole("button", { name: "First", exact: true })).toHaveCount(0);
});

test("a project changed in another tab since the list was shown is opened and changed as it is now", async ({ page, context }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await goHome(page);
  await expect(projectRow(page, "one-word")).toContainText("0 marks");

  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "one-word", exact: true }).click();
  await markText(other, 1, janeRoe, "Person");
  await saved(other);
  await projectName(other).getByRole("link", { name: "Projects" }).click();
  await expect(other.getByRole("heading", { name: "Projects" })).toBeVisible();

  // This tab's list is from before the mark. Renaming must keep the mark, and opening must show it.
  await rowAction(page, "one-word", "Rename");
  await page.getByRole("textbox", { name: "Project name" }).fill("Renamed");
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");
  await expect(projectRow(page, "Renamed")).toContainText("1 mark");
  await page.getByRole("button", { name: "Renamed", exact: true }).click();
  await expect(marks(page)).toHaveText([/Jane Roe/]);
});

test("a file added twice keeps both copies under different names", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await addDocuments(page, oneWordPdf);

  await expect(explorer(page).getByRole("button")).toHaveText([/^one-word\.pdf/, /^one-word \(2\)\.pdf/]);
  expect(await filesInFolder(page, "one-word")).toEqual(["one-word (2).pdf", "one-word.pdf"]);
});

test("a change that cannot be saved says so, and the project stays open until it is saved", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  await failWrites(page);

  await markText(page, 1, janeRoe, "Person");
  await expect(page.getByRole("banner").getByText("Not saved")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(/Your latest changes could not be saved/);
  const attempts = Number(await writeAttempts(page));
  await projectName(page).getByRole("link", { name: "Projects" }).click();
  // Leaving tries to save once more; once that has failed too, the project is still open.
  await expect.poll(async () => Number(await writeAttempts(page))).toBeGreaterThan(attempts);
  await expect(page.getByRole("banner").getByText("Not saved")).toBeVisible();
  await expect(projectName(page)).toContainText("one-word");

  await restoreWrites(page);
  await projectName(page).getByRole("link", { name: "Projects" }).click();
  await expect(projectRow(page, "one-word")).toContainText("1 mark");
});

test("documents that cannot be saved into a project leave no files behind", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  // The second write of the add fails: the first new original is written, then removed again.
  await failWrites(page, 2);

  await addDocuments(page, twoPagePdf, crossPagePdf);

  await expect(page.getByRole("region", { name: "2 files not added" })).toContainText("could not be saved in the project");
  await expect(explorer(page).getByRole("button")).toHaveCount(1);
  expect(await filesInFolder(page, "one-word")).toEqual(["one-word.pdf"]);
});

test("settings saved by a newer version are left alone, and the app says why its defaults are in use", async ({ page }) => {
  const newer = JSON.stringify({ format: "redactorator-settings", version: 99, appearance: { colour: "#123456" } });
  await openApp(page);
  await page.evaluate(async (text) => {
    const records = await (await navigator.storage.getDirectory()).getDirectoryHandle(".redactorator", { create: true });
    const writable = await (await records.getFileHandle("settings.json", { create: true })).createWritable();
    await writable.write(text);
    await writable.close();
  }, newer);
  await page.reload();
  await expect(page.getByRole("alert")).toHaveText(/saved by a newer version of Redactorator/);

  await openPdf(page, oneWordPdf);
  await printTypes(page);
  await page.keyboard.press("Escape");
  await saved(page);

  const kept = await page.evaluate(async () => {
    const records = await (await navigator.storage.getDirectory()).getDirectoryHandle(".redactorator");
    return (await (await records.getFileHandle("settings.json")).getFile()).text();
  });
  expect(kept).toBe(newer);
});

test("undo in labelling mode keeps the link ids typed since", async ({ page }) => {
  await openApp(page, "/?label");
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await markText(page, 1, dear, "Other");
  await page.getByRole("textbox", { name: "Link id for Jane Roe on page 1" }).fill("p1");

  await page.getByRole("button", { name: "Undo" }).click();

  await expect(marks(page)).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Link id for Jane Roe on page 1" })).toHaveValue("p1");
});

test("an address that names a project badly goes back to the projects", async ({ page }) => {
  await page.goto("/#project=%E0%A4%A");

  await expect(page.getByLabel("Choose PDFs")).toBeEnabled();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
});

test("leaving a project while documents are being added waits for them, so they are kept", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  const release = await holdWrites(page);

  await addDocuments(page, twoPagePdf);
  await projectName(page).getByRole("link", { name: "Projects" }).click();
  await release();

  await expect(projectRow(page, "one-word")).toContainText("2 documents");
  expect(await filesInFolder(page, "one-word")).toEqual(["one-word.pdf", "two-pages.pdf"]);
});

test("leaving a project while an approval is worked out waits for it, so it lands", async ({ page }) => {
  const release = await holdApprovalSearch(page);
  await openApp(page);
  // Preparing letter-a.pdf removes nothing, so its approval lands with no dialog.
  await openPdf(page, letterA);
  await markText(page, 1, aJaneRoe, "Person");
  await approveButton(page).click();
  await expect(approveButton(page)).toBeDisabled();

  await projectName(page).getByRole("link", { name: "Projects" }).click();
  await release();

  await expect(projectRow(page, "letter-a")).toContainText("1 of 1 approved");
});

test("leaving a project with the approval heads-up open approves nothing", async ({ page }) => {
  await openApp(page);
  await openPdf(page, letterA, letterB);
  await markText(page, 1, aJaneRoe, "Person");
  await approveButton(page).click();
  await expect(page.getByRole("dialog", { name: /^Approve/ })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(projectRow(page, "letter-a")).toContainText("0 of 2 approved");
  await page.getByRole("button", { name: "letter-a", exact: true }).click();
  await expect(inExplorer(page, "letter-a.pdf")).toContainText("In review");
  await expect(inExplorer(page, "letter-b.pdf")).toContainText("Not started");
});

test("if the engine stops while files are being added, the rest are listed as not added instead of waiting forever", async ({ page }) => {
  await stopWorkerAfter(page);
  await openApp(page);
  await openPdf(page, crossPagePdf, oneWordPdf, twoPagePdf);

  await expect(page.getByRole("region", { name: "2 files not added" }).getByRole("listitem")).toHaveText([
    "one-word.pdf: The PDF engine stopped. Reload the page to try again.",
    "two-pages.pdf: The PDF engine is not running. Reload the page to try again.",
  ]);
});

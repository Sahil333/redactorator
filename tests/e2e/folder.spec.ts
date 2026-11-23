import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { janeRoe, markText, oneWordPdf, openApp, openPdf, saved, standInForFolderPicker, storedNames, storedNamesIn } from "./app";

const card = (page: Page, title: string) => page.getByRole("region", { name: title });
const keepInFolder = (page: Page) => card(page, "Keep your projects in a folder on this computer");
const projectName = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" });
const openProject = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const marks = (page: Page) => page.getByRole("complementary", { name: "Marks" }).getByRole("listitem");
const explorer = (page: Page) => page.getByRole("navigation", { name: "Documents" });

async function goHome(page: Page): Promise<void> {
  await projectName(page).getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

/** Makes a project from one-word.pdf with "Jane Roe" marked, and goes back to the projects. */
async function markedProject(page: Page): Promise<void> {
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await saved(page);
  await goHome(page);
}

/** Makes Chrome ask again before the page may use a picked folder, as it can on a later visit, until the user agrees. */
async function permissionAsksAgain(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let granted = false;
    Reflect.set(FileSystemHandle.prototype, "queryPermission", async () => (granted ? "granted" : "prompt"));
    Reflect.set(FileSystemHandle.prototype, "requestPermission", async () => {
      granted = true;
      return "granted";
    });
  });
}

/** Clears what the browser keeps for the site, as Chrome's "Delete" in its site data settings does. A picked folder, on disk, stays. */
async function clearSiteData(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((done) => {
      const deleting = indexedDB.deleteDatabase("redactorator");
      deleting.onsuccess = done;
      deleting.onerror = done;
    });
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) if (name !== "Picked" && name !== "Brought") await root.removeEntry(name, { recursive: true });
  });
  await page.reload();
}

const openProjectsFolder = (page: Page) => page.getByRole("button", { name: "Open your projects folder" }).click();

/** Makes Chrome refuse the page the picked folder, as when the user blocked file editing for the site. */
async function permissionBlocked(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.set(FileSystemHandle.prototype, "queryPermission", async () => "denied");
    Reflect.set(FileSystemHandle.prototype, "requestPermission", async () => "denied");
  });
}

async function chooseFolder(page: Page): Promise<void> {
  await keepInFolder(page).getByRole("button", { name: "Choose a folder for projects" }).click();
  await expect(keepInFolder(page)).toHaveCount(0);
  await expect(page.getByText(/^Moving your projects/)).toHaveCount(0);
}

test("choosing a folder moves the projects into it, where they open with their marks and review states", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await markedProject(page);

  await chooseFolder(page);
  await expect(page.getByText("Projects are kept in the folder “Picked” on this computer.")).toBeVisible();
  // Nothing is left in the browser's own storage but the picked folder, which stands in for one on disk.
  expect(await storedNames(page)).toEqual(["Picked"]);
  expect(await storedNamesIn(page, "Picked")).toEqual(["one-word"]);
  expect(await storedNamesIn(page, "Picked/one-word")).toEqual([".redactorator", "one-word.pdf"]);

  // Reload: the folder is remembered, and the project opens from it as it was.
  await page.reload();
  await openProject(page, "one-word");
  await expect(explorer(page)).toContainText("In review");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
});

test("while the projects move into a folder, no project opens until the move ends, so none is left behind", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await saved(page);
  const address = new URL(page.url()).hash;
  await goHome(page);
  // From now on every write waits until the test lets it go, so the move stays under way.
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    const released = new Promise<void>((resolve) => Reflect.set(window, "releaseWrites", resolve));
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      await released;
      return original.apply(this, args);
    };
  });

  await keepInFolder(page).getByRole("button", { name: "Choose a folder for projects" }).click();
  await expect(page.getByText(/^Moving your projects/)).toBeVisible();
  await expect(page.getByRole("button", { name: "one-word", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Actions for one-word" })).toBeDisabled();
  // The address names the project while it is being moved, as Back or a link would.
  await page.evaluate((hash) => {
    location.hash = hash;
  }, address);
  await page.evaluate(() => Reflect.get(window, "releaseWrites")());

  // It opens once the move has ended, from the folder, with no "open in another tab" problem.
  await expect(projectName(page)).toContainText("one-word");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await storedNames(page)).toEqual(["Picked"]);
  expect(await storedNamesIn(page, "Picked/one-word/.redactorator")).toContain("project.json");
});

test("a project renamed before it moves gets a folder of its new name", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await markedProject(page);
  await page.getByRole("button", { name: "Actions for one-word" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Letters");
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");
  await expect(page.getByRole("button", { name: "Letters", exact: true })).toBeVisible();

  await chooseFolder(page);
  expect(await storedNamesIn(page, "Picked")).toEqual(["Letters"]);
});

test("after the browser's site data is cleared, opening the projects folder again brings every project back", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await markedProject(page);
  await chooseFolder(page);

  await clearSiteData(page);
  await openProjectsFolder(page);
  await openProject(page, "one-word");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
});

test("a project imported again after site data was cleared isn't doubled when its folder is opened", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await markedProject(page);
  await chooseFolder(page);
  await clearSiteData(page);

  // The project's own folder, imported back into the browser, and then the projects folder chosen.
  await standInForFolderPicker(page, "Picked/one-word");
  await page.getByRole("button", { name: "Import a project" }).click();
  await expect(page.getByRole("button", { name: "one-word", exact: true })).toBeVisible();
  await standInForFolderPicker(page, "Picked");
  await chooseFolder(page);

  await expect(page.getByRole("list").getByRole("button", { name: /^one-word/ })).toHaveCount(1);
  expect(await storedNamesIn(page, "Picked")).toEqual(["one-word"]);
});

test("custom mark types made inside Chrome join the projects folder's own when it is opened again", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Ref A");
  await saved(page);
  await goHome(page);
  await chooseFolder(page);

  await clearSiteData(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Case number");
  await saved(page);
  await goHome(page);
  await chooseFolder(page);

  const customTypes = await page.evaluate(async () => {
    const records = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Picked")).getDirectoryHandle(".redactorator");
    const settings: unknown = JSON.parse(await (await (await records.getFileHandle("settings.json")).getFile()).text());
    return typeof settings === "object" && settings !== null && "customTypes" in settings ? settings.customTypes : undefined;
  });
  expect(customTypes).toEqual(["Ref A", "Case number"]);
});

test("Later hides the folder card until the next visit", async ({ page }) => {
  await openApp(page);
  await markedProject(page);

  await keepInFolder(page).getByRole("button", { name: "Later" }).click();
  await expect(keepInFolder(page)).toHaveCount(0);
  await openProject(page, "one-word");
  await goHome(page);
  await expect(keepInFolder(page)).toHaveCount(0);

  await page.reload();
  await expect(keepInFolder(page)).toBeVisible();
});

test("when Chrome asks again on a later visit, one button reopens the projects folder", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await markedProject(page);
  await chooseFolder(page);

  await permissionAsksAgain(page);
  await page.reload();
  const reopen = card(page, "Reopen your projects folder");
  await expect(reopen).toContainText("Your projects are in “Picked”.");
  await reopen.getByRole("button", { name: "Reopen your projects folder" }).click();
  await expect(reopen).toHaveCount(0);
  await openProject(page, "one-word");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
});

test("when Chrome is not allowed to use the projects folder, Reopen says so", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await markedProject(page);
  await chooseFolder(page);

  await permissionBlocked(page);
  await page.reload();
  await card(page, "Reopen your projects folder").getByRole("button", { name: "Reopen your projects folder" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Chrome didn't allow this page to use “Picked”. Allow it in Chrome's settings for this site, then click Reopen again.",
  );
});

test("one project's own folder is refused as the projects folder", async ({ page }) => {
  await openApp(page);
  await markedProject(page);
  await standInForFolderPicker(page, "one-word");

  await keepInFolder(page).getByRole("button", { name: "Choose a folder for projects" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "“one-word” is one project's own folder. Choose the folder that holds your projects, or a new empty folder.",
  );
  await expect(keepInFolder(page)).toBeVisible();
});

test("a projects folder that has gone says so, and can be chosen again", async ({ page }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await markedProject(page);
  await chooseFolder(page);
  // Moved away in Finder, say: the remembered folder is no longer where it was.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("Picked", { recursive: true });
  });

  await page.reload();
  const missing = card(page, "Your projects folder can't be found");
  await expect(missing).toContainText("“Picked” may have been moved, renamed or deleted.");
  await missing.getByRole("button", { name: "Choose a folder for projects" }).click();
  // The folder chosen again is empty, so home is the empty first screen.
  await expect(missing).toHaveCount(0);
  await expect(page.getByLabel("Choose PDFs")).toBeEnabled();
});

test("a project open in another tab stays in the browser, and moves into the folder on a later visit", async ({ page, context }) => {
  await standInForFolderPicker(page, "Picked");
  await openApp(page);
  await markedProject(page);
  const other = await context.newPage();
  await other.goto("/");
  await openProject(other, "one-word");
  await expect(projectName(other)).toContainText("one-word");

  await chooseFolder(page);
  await expect(page.getByRole("alert")).toHaveText(
    "“one-word” is open in another tab, so it stays inside Chrome for now. Close it there, then reload this page to move it.",
  );
  await other.close();
  await page.reload();
  await openProject(page, "one-word");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  expect(await storedNames(page)).toEqual(["Picked"]);
});

test("Import a project copies in a project folder, which opens with the same marks; one already here comes in as a copy", async ({ page }) => {
  await openApp(page);
  await markedProject(page);
  // A copy of the project's folder, as if brought from another computer.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const copy = async (from: FileSystemDirectoryHandle, into: FileSystemDirectoryHandle) => {
      for await (const [name, entry] of from.entries()) {
        if (entry instanceof FileSystemFileHandle) {
          const writable = await (await into.getFileHandle(name, { create: true })).createWritable();
          await writable.write(await entry.getFile());
          await writable.close();
        } else if (entry instanceof FileSystemDirectoryHandle) await copy(entry, await into.getDirectoryHandle(name, { create: true }));
      }
    };
    await copy(await root.getDirectoryHandle("one-word"), await (await root.getDirectoryHandle("Brought", { create: true })).getDirectoryHandle("From laptop", { create: true }));
  });
  await standInForFolderPicker(page, "Brought/From laptop");

  await page.getByRole("button", { name: "Import a project" }).click();
  // Its folder is named after the project, whatever the picked folder was called.
  await expect(page.getByRole("button", { name: "one-word (2)", exact: true })).toBeVisible();
  expect(await storedNames(page)).toContain("one-word (2)");
  await openProject(page, "one-word (2)");
  await expect(marks(page)).toHaveText([/Jane Roe/]);
  await goHome(page);

  // A folder of projects, and a folder of none, are refused, each with the reason.
  await standInForFolderPicker(page, "Brought");
  await page.getByRole("button", { name: "Import a project" }).click();
  await expect(page.getByRole("alert")).toContainText("That folder holds projects rather than being one.");
  await standInForFolderPicker(page, "Empty");
  await page.getByRole("button", { name: "Import a project" }).click();
  await expect(page.getByRole("alert")).toContainText("That folder holds no Redactorator project.");
});

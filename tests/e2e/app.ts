import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

export const twoPagePdf = new URL("../../fixtures/two-pages.pdf", import.meta.url).pathname;
export const noPagesPdf = new URL("../../fixtures/no-pages.pdf", import.meta.url).pathname;
export const oneWordPdf = new URL("../../fixtures/one-word.pdf", import.meta.url).pathname;
/** A path under the repository, such as a leak-vector entry's fixture, as a file path. */
export const fixturePath = (fixture: string) => new URL(`../../${fixture}`, import.meta.url).pathname;
export const imagePdf = new URL("../../fixtures/image.pdf", import.meta.url).pathname;
export const rotatedCroppedPdf = new URL("../../fixtures/rotated-cropped.pdf", import.meta.url).pathname;
export const encryptedPdf = new URL("../../fixtures/encrypted.pdf", import.meta.url).pathname;
export const editLockedPdf = new URL("../../fixtures/edit-locked.pdf", import.meta.url).pathname;
export const crossPagePdf = new URL("../../fixtures/cross-page.pdf", import.meta.url).pathname;
export const tablePdf = new URL("../../fixtures/table.pdf", import.meta.url).pathname;
export const maskedImagePdf = new URL("../../fixtures/masked-image.pdf", import.meta.url).pathname;
export const longPdf = new URL("../../fixtures/long.pdf", import.meta.url).pathname;
export const tjStringsPdf = new URL("../../fixtures/tj-strings.pdf", import.meta.url).pathname;
export const letterA = new URL("../../fixtures/letter-a.pdf", import.meta.url).pathname;
export const letterB = new URL("../../fixtures/letter-b.pdf", import.meta.url).pathname;
export const logoA = new URL("../../fixtures/logo-a.pdf", import.meta.url).pathname;
export const logoB = new URL("../../fixtures/logo-b.pdf", import.meta.url).pathname;

/** A rectangle in the app's box convention: PDF points, origin top-left. See tests/oracle/README.md. */
export type PointBox = readonly [x0: number, y0: number, x1: number, y1: number];

// Words of one-word.pdf, from tests/oracle/README.md, in the app's box convention.
export const janeRoe: PointBox = [101.3, 99.1, 152.7, 115.6];
export const dear: PointBox = [72, 99.1, 98, 115.6];
// Words of letter-a.pdf and letter-b.pdf.
export const aJaneRoe: PointBox = [72, 79.1, 123.4, 95.6];
export const bStatement: PointBox = [72, 79.1, 126.7, 95.6];
// "Reference 4471" in logo-a.pdf, under no image.
export const reference: PointBox = [96, 328, 200, 346];
// A box over the left 90% of logo-a.pdf's logo (x 100–388, y 100–292), spilling past its other edges.
export const mostOfLogo: PointBox = [90, 90, 359.2, 302];

/** `text` as a regular expression that matches it as written. */
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const explorer = (page: Page) => page.getByRole("navigation", { name: "Documents" });

/** A document's entry in the explorer, with its review and download state. */
export const inExplorer = (page: Page, file: string) => explorer(page).getByRole("button", { name: new RegExp(`^${literally(file)}`) });

/** The open document's marks, in the marks panel. */
export const marks = (page: Page) => page.getByRole("complementary", { name: "Marks" }).getByRole("listitem");

export const approveButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Approve", exact: true });

/** Approves the open document and, when it changes other documents, agrees to the heads-up. */
export async function approve(page: Page, headsUp: RegExp | undefined): Promise<void> {
  await approveButton(page).click();
  if (headsUp !== undefined) {
    const dialog = page.getByRole("dialog", { name: /^Approve/ });
    await expect(dialog).toContainText(headsUp);
    await dialog.getByRole("button", { name: "Approve" }).click();
  }
  await expect(page.getByRole("banner").getByText("Approved", { exact: true })).toBeVisible();
}

/** Opens `file` from the explorer in its tab. */
export async function show(page: Page, file: string): Promise<void> {
  await inExplorer(page, file).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(new RegExp(literally(file)));
}

/** Loads the app at `path` (such as "/?label") and waits until a PDF can be chosen on the home screen. */
export async function openApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByLabel("Choose PDFs")).toBeEnabled();
}

/** Chooses PDFs on the empty home screen, which makes them a new project. */
export async function openPdf(page: Page, ...paths: readonly string[]): Promise<void> {
  await page.getByLabel("Choose PDFs").setInputFiles([...paths]);
}

/** Shows the page thumbnails, which the workbench hides at first. */
export async function showPageList(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
}

/** Adds PDFs to the open project. */
export async function addDocuments(page: Page, ...paths: readonly string[]): Promise<void> {
  await page.getByLabel("Add documents").setInputFiles([...paths]);
}

/** Waits until every change to the open project is stored. */
export async function saved(page: Page): Promise<void> {
  await expect(page.getByRole("banner").getByText(/^(Saving…|Saved)$/)).toHaveText("Saved");
}

/** The names of the entries at the top of the browser's private storage, where projects live. */
export async function storedNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names: string[] = [];
    for await (const name of (await navigator.storage.getDirectory()).keys()) names.push(name);
    return names.sort();
  });
}


/** Counts the dark pixels drawn on a canvas: a page or a thumbnail. */
export async function inkedPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("not a canvas");
    const context = element.getContext("2d");
    if (context === null) throw new Error("the canvas has no 2d context");
    const { data } = context.getImageData(0, 0, element.width, element.height);
    const dark = (channel: number | undefined) => (channel ?? 255) < 128;
    let inked = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i + 3] ?? 0) > 128 && dark(data[i]) && dark(data[i + 1]) && dark(data[i + 2])) inked++;
    return inked;
  });
}

type Point = readonly [x: number, y: number];

/** CSS pixels per point that page `pageNumber` is shown at: pages zoom, and shrink to fit a narrow pane. */
async function pageScale(page: Page, pageNumber: number): Promise<number> {
  const frame = page.locator(`#page-${pageNumber}`);
  await expect(frame.getByRole("img")).toBeVisible();
  return frame.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("The page frame is not an element");
    return element.getBoundingClientRect().width / Number(element.dataset.pointsWide);
  });
}

/** Scrolls the pages so the middle of `points` (on one page, in points) is mid-view, and returns them on screen. */
async function onScreen(page: Page, pageNumber: number, points: readonly Point[]): Promise<[number, number][]> {
  const frame = page.locator(`#page-${pageNumber}`);
  const k = await pageScale(page, pageNumber);
  const mean = (axis: 0 | 1) => (points.reduce((sum, point) => sum + point[axis], 0) / points.length) * k;
  await frame.evaluate((element, { x, y }) => {
    const pane = element.closest("main");
    if (pane === null) throw new Error("The page is not in the pages pane");
    const view = pane.getBoundingClientRect();
    const at = element.getBoundingClientRect();
    pane.scrollBy(at.left + x - (view.left + view.width / 2), at.top + y - (view.top + view.height / 2));
  }, { x: mean(0), y: mean(1) });
  const bounds = await frame.boundingBox();
  if (bounds === null) throw new Error(`Page ${pageNumber} is not on screen`);
  return points.map(([x, y]) => [bounds.x + x * k, bounds.y + y * k]);
}

export async function toScreen(page: Page, pageNumber: number, x: number, y: number): Promise<[number, number]> {
  const [point] = await onScreen(page, pageNumber, [[x, y]]);
  if (point === undefined) throw new Error("No point");
  return point;
}

async function drag(page: Page, pageNumber: number, from: Point, to: Point): Promise<void> {
  const [start, end] = await onScreen(page, pageNumber, [from, to]);
  if (start === undefined || end === undefined) throw new Error("No points");
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(...end, { steps: 5 });
  await page.mouse.up();
}

/** A place on one page, in points: page number, x, y. */
export type PagePoint = readonly [pageNumber: number, x: number, y: number];

/**
 * Drags from one page to a later one as a user would: holding the pointer near the bottom of
 * the pages pane until the target scrolls into view, then moving onto it and letting go.
 */
export async function dragAcrossPages(page: Page, [fromPage, fx, fy]: PagePoint, [toPage, tx, ty]: PagePoint) {
  const [start] = await onScreen(page, fromPage, [[fx, fy]]);
  const pane = await page.locator("main").boundingBox();
  if (start === undefined || pane === null) throw new Error("The pages are not on screen");
  const target = page.locator(`#page-${toPage}`);
  const k = await pageScale(page, fromPage);
  const targetY = async () => ((await target.boundingBox())?.y ?? Infinity) + ty * k;
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height - 10, { steps: 5 });
  await expect.poll(targetY).toBeLessThan(pane.y + pane.height - 100);
  // Out of the scrolling edge, then wait for the pane to stop, so the target stays put.
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2, { steps: 2 });
  let last = Infinity;
  await expect.poll(async () => {
    const now = await targetY();
    const still = now === last;
    last = now;
    return still;
  }).toBe(true);
  const bounds = await target.boundingBox();
  if (bounds === null) throw new Error(`Page ${toPage} is not on screen`);
  await page.mouse.move(bounds.x + tx * k, bounds.y + ty * k, { steps: 5 });
  await page.mouse.up();
}

/** Drags across the text inside `box` with the Select text tool, along its longer side. */
export async function selectText(page: Page, pageNumber: number, [x0, y0, x1, y1]: PointBox): Promise<void> {
  await page.getByRole("button", { name: "Select text" }).click();
  // A page is drawn once it nears the screen, so go to it as a user would.
  await page.locator(`#page-${pageNumber}`).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: `Page ${pageNumber}` })).toBeVisible();
  const [midX, midY] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const along = x1 - x0 >= y1 - y0;
  // A drag selects nothing until the page's text has reached the page, so drag until the picker opens.
  await expect(async () => {
    await drag(page, pageNumber, along ? [x0 + 1, midY] : [midX, y0 + 1], along ? [x1 - 1, midY] : [midX, y1 - 1]);
    await expect(page.getByRole("combobox", { name: "Type for this mark" })).toBeVisible({ timeout: 500 });
  }).toPass();
}

/** Selects the text inside `box`, then picks `type`. */
export async function markText(page: Page, pageNumber: number, box: PointBox, type: string): Promise<void> {
  await selectText(page, pageNumber, box);
  await pickType(page, type);
}

/** Draws `box` with the Draw box tool, then picks `type`. */
export async function drawBox(page: Page, pageNumber: number, [x0, y0, x1, y1]: PointBox, type: string): Promise<void> {
  await page.getByRole("button", { name: "Draw box" }).click();
  await page.locator(`#page-${pageNumber}`).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: `Page ${pageNumber}` })).toBeVisible();
  await drag(page, pageNumber, [x0, y0], [x1, y1]);
  await pickType(page, type);
}

/** Presses Tab until `target` has focus, as a keyboard user would reach it. */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  // WebKit on macOS, like Safari, tabs only to form fields unless Option is held.
  const tab = page.context().browser()?.browserType().name() === "webkit" ? "Alt+Tab" : "Tab";
  for (let presses = 0; presses < 40; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(tab);
  }
  throw new Error("Tab never reached the target");
}

/** Saves the download that `start` sets off to a temporary file, and returns its path. */
export async function saveDownload(page: Page, start: () => Promise<void>): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), start()]);
  const path = join(await mkdtemp(join(tmpdir(), "download-")), download.suggestedFilename());
  await download.saveAs(path);
  return path;
}

/** How the stand-in for Chrome's save dialog ends the next save. */
type SaveOutcome = "save" | "cancel" | "fail";

/**
 * Stands in for Chrome's save dialog, which a test can't drive. "save" keeps the file in the
 * page for `saveFile`; "cancel" ends as a user's cancel does; "fail" fails the write. Like
 * Chrome, it takes a moment to open and refuses a second dialog while one is open.
 */
export async function standInForSaveDialog(page: Page, outcome: SaveOutcome): Promise<void> {
  await page.evaluate((outcome) => {
    Reflect.deleteProperty(window, "savedFile");
    let open = false;
    Reflect.set(window, "showSaveFilePicker", async ({ suggestedName }: { readonly suggestedName: string }) => {
      if (open) {
        Reflect.set(window, "refusedDialogs", Number(Reflect.get(window, "refusedDialogs") ?? 0) + 1);
        throw new DOMException("File picker already active.", "NotAllowedError");
      }
      open = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
      open = false;
      if (outcome === "cancel") throw new DOMException("The user aborted a request.", "AbortError");
      const parts: BlobPart[] = [];
      return {
        createWritable: async () => ({
          write: async (data: BlobPart) => {
            if (outcome === "fail") throw new DOMException("The disk is full.", "QuotaExceededError");
            parts.push(data);
          },
          close: async () => Reflect.set(window, "savedFile", new File(parts, suggestedName)),
          abort: async () => undefined,
        }),
      };
    });
  }, outcome);
}

/** Saves the file that `start` asks Chrome's save dialog for to a temporary file, and returns its path. */
export async function saveFile(page: Page, start: () => Promise<void>): Promise<string> {
  await standInForSaveDialog(page, "save");
  await start();
  await page.waitForFunction(() => Reflect.get(window, "savedFile") instanceof File);
  const saved = await page.evaluate(async () => {
    const file: unknown = Reflect.get(window, "savedFile");
    return file instanceof File ? { name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] } : undefined;
  });
  if (saved === undefined) throw new Error("Nothing was saved");
  const path = join(await mkdtemp(join(tmpdir(), "download-")), saved.name);
  await writeFile(path, Uint8Array.from(saved.bytes));
  return path;
}

export async function pickType(page: Page, type: string): Promise<void> {
  const picker = page.getByRole("combobox", { name: "Type for this mark" });
  await picker.fill(type);
  await picker.press("Enter");
  await expect(picker).toHaveCount(0);
}

/** Turns on the setting that prints each mark's type in its box. */
export async function printTypes(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Print the type in each box").check();
}

/** The checked output's download button: a preview until the document is approved. */
export const downloadButton = (page: Page): Locator => page.getByRole("button", { name: /^Download (preview|cleaned PDF)$/ });

/** Applies the marks, waits for the check to pass, and saves the cleaned file to a temporary file. */
export async function applyAndDownload(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Apply and check" }).click();
  await expect(page.getByText("Checked:")).toBeVisible();
  return saveFile(page, () => downloadButton(page).click());
}

/** Drops files on `target` as a person dragging them from their desktop would. */
export async function dropFiles(page: Page, target: Locator, paths: readonly string[]): Promise<void> {
  const files = await Promise.all(paths.map(async (path) => ({ name: basename(path), data: (await readFile(path)).toString("base64") })));
  const transfer = await page.evaluateHandle((dropped) => {
    const data = new DataTransfer();
    for (const { name, data: base64 } of dropped) {
      data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type: "application/pdf" }));
    }
    return data;
  }, files);
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
}

/**
 * The text of the file at `path` in the browser's private storage, or undefined while it or its
 * folder doesn't exist yet or a write is replacing it, so `expect.poll` can wait for the write to
 * land.
 */
export async function storedText(page: Page, path: string): Promise<string | undefined> {
  return page.evaluate(async (path) => {
    const names = path.split("/");
    const name = names.pop() ?? "";
    try {
      let folder = await navigator.storage.getDirectory();
      for (const each of names) folder = await folder.getDirectoryHandle(each);
      return await (await (await folder.getFileHandle(name)).getFile()).text();
    } catch (error) {
      if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "NotReadableError")) return undefined;
      throw error;
    }
  }, path);
}

/** The JSON file at `path` in the browser's private storage, unchecked. */
export async function storedJson(page: Page, path: string): Promise<unknown> {
  const text = await storedText(page, path);
  if (text === undefined) throw new Error(`${path} is not in the browser's private storage`);
  return JSON.parse(text);
}

/** The id of document `file` in the project kept in `folder`. */
async function documentId(page: Page, folder: string, file: string): Promise<string> {
  const project = await storedJson(page, `${folder}/.redactorator/pdf-3/project.json`);
  const documents: unknown = typeof project === "object" && project !== null ? Reflect.get(project, "documents") : undefined;
  const document: unknown = Array.isArray(documents) ? documents.find((each: unknown) => typeof each === "object" && each !== null && Reflect.get(each, "file") === file) : undefined;
  const id: unknown = typeof document === "object" && document !== null ? Reflect.get(document, "id") : undefined;
  if (typeof id !== "string") throw new Error(`${file} is not in ${folder}'s project`);
  return id;
}

/** The stored name of the working copy preparation made of document `file` in the project kept in `folder`. */
export async function workingCopyName(page: Page, folder: string, file: string): Promise<string> {
  return `${await documentId(page, folder, file)}.not-redacted.pdf`;
}

/** The removal kinds preparing document `file` recorded, as its stored reading lists them. */
export async function removedKinds(page: Page, folder: string, file: string): Promise<unknown[]> {
  const reading = await storedJson(page, `${folder}/.redactorator/pdf-3/text/${await documentId(page, folder, file)}.json`);
  const removed: unknown = typeof reading === "object" && reading !== null ? Reflect.get(reading, "removed") : undefined;
  return Array.isArray(removed) ? removed : [];
}

/**
 * The working copy of document `file` in the project kept in `folder`, saved to a temporary file
 * whose path is returned: what the app shows, marks and writes from.
 */
export async function workingCopy(page: Page, folder: string, file: string): Promise<string> {
  const stored = `${folder}/.redactorator/pdf-3/working/${await workingCopyName(page, folder, file)}`;
  const bytes = await page.evaluate(async (path) => {
    const names = path.split("/");
    const name = names.pop() ?? "";
    let at = await navigator.storage.getDirectory();
    for (const each of names) at = await at.getDirectoryHandle(each);
    return [...new Uint8Array(await (await (await at.getFileHandle(name)).getFile()).arrayBuffer())];
  }, stored);
  const path = join(await mkdtemp(join(tmpdir(), "working-")), `${file}.not-redacted.pdf`);
  await writeFile(path, Uint8Array.from(bytes));
  return path;
}

/** Every file in the browser's private storage, by path. */
export async function storedFiles(page: Page): Promise<Map<string, Uint8Array>> {
  const files = await page.evaluate(async () => {
    const found: [string, number[]][] = [];
    async function walk(folder: FileSystemDirectoryHandle, path: string) {
      for await (const [name, handle] of folder.entries()) {
        if (handle instanceof FileSystemDirectoryHandle) await walk(handle, `${path}${name}/`);
        if (handle instanceof FileSystemFileHandle) found.push([`${path}${name}`, [...new Uint8Array(await (await handle.getFile()).arrayBuffer())]]);
      }
    }
    await walk(await navigator.storage.getDirectory(), "");
    return found;
  });
  return new Map(files.map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
}

/** The files under `folder` on disk, by path relative to it. */
export async function filesIn(folder: string): Promise<Map<string, Buffer>> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const paths = entries.filter((entry) => entry.isFile()).map((entry) => relative(folder, join(entry.parentPath, entry.name)));
  return new Map(await Promise.all(paths.sort().map(async (path): Promise<[string, Buffer]> => [path, await readFile(join(folder, path))])));
}

/** Puts the files under `folder` on disk into the browser's private storage, as a build stored them, then reloads the app to read them. */
export async function loadStorage(page: Page, folder: string): Promise<void> {
  const files = await filesIn(folder);
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    for (const [path, bytes] of files) {
      const names = path.split("/");
      const name = names.pop() ?? "";
      let at = root;
      for (const each of names) at = await at.getDirectoryHandle(each, { create: true });
      const writable = await (await at.getFileHandle(name, { create: true })).createWritable();
      await writable.write(Uint8Array.from(bytes));
      await writable.close();
    }
  }, [...files].map(([path, bytes]): [string, number[]] => [path, [...bytes]]));
  await page.reload();
}

/** The names of the entries in the folder at `path` in the browser's private storage. */
export async function storedNamesIn(page: Page, path: string): Promise<string[]> {
  return page.evaluate(async (path) => {
    let folder = await navigator.storage.getDirectory();
    for (const name of path.split("/")) folder = await folder.getDirectoryHandle(name);
    const names: string[] = [];
    for await (const name of folder.keys()) names.push(name);
    return names.sort();
  }, path);
}

/**
 * Stands in for Chrome's folder picker, which a test can't drive: from now on, and after a
 * reload, it gives the folder at `path` in the browser's private storage, made if need be. Such a
 * folder works as one on disk does.
 */
export async function standInForFolderPicker(page: Page, path: string): Promise<void> {
  const install = (path: string) =>
    Reflect.set(window, "showDirectoryPicker", async () => {
      let folder = await navigator.storage.getDirectory();
      for (const name of path.split("/")) folder = await folder.getDirectoryHandle(name, { create: true });
      return folder;
    });
  await page.addInitScript(install, path);
  if (page.url().startsWith("http")) await page.evaluate(install, path);
}

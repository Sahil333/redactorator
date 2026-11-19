import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

export const twoPagePdf = new URL("../../fixtures/two-pages.pdf", import.meta.url).pathname;
export const noPagesPdf = new URL("../../fixtures/no-pages.pdf", import.meta.url).pathname;
export const oneWordPdf = new URL("../../fixtures/one-word.pdf", import.meta.url).pathname;
export const imagePdf = new URL("../../fixtures/image.pdf", import.meta.url).pathname;
export const rotatedCroppedPdf = new URL("../../fixtures/rotated-cropped.pdf", import.meta.url).pathname;
export const encryptedPdf = new URL("../../fixtures/encrypted.pdf", import.meta.url).pathname;
export const crossPagePdf = new URL("../../fixtures/cross-page.pdf", import.meta.url).pathname;
export const tablePdf = new URL("../../fixtures/table.pdf", import.meta.url).pathname;
export const maskedImagePdf = new URL("../../fixtures/masked-image.pdf", import.meta.url).pathname;

/** A rectangle in the app's box convention: PDF points, origin top-left. See tests/oracle/README.md. */
export type PointBox = readonly [x0: number, y0: number, x1: number, y1: number];

// Words of one-word.pdf, from tests/oracle/README.md, in the app's box convention.
export const janeRoe: PointBox = [101.3, 99.1, 152.7, 115.6];
export const dear: PointBox = [72, 99.1, 98, 115.6];

const CSS_PIXELS_PER_POINT = 96 / 72;

/** Serves `script` in place of the engine worker, to make the engine reply in ways the real one can't on demand. */
export async function fakeEngine(page: Page, script: string): Promise<void> {
  await page.route("**/assets/worker-*.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: script }),
  );
}

/** Runs `prelude` in the real engine worker before its own code, to bend a message on its way in or out. */
export async function wrapEngine(page: Page, prelude: string): Promise<void> {
  await page.route("**/assets/worker-*.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${prelude}\n${await response.text()}` });
  });
}

export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("Open a PDF")).toBeEnabled();
}

export async function openPdf(page: Page, path: string): Promise<void> {
  await page.getByLabel("Open a PDF").setInputFiles(path);
}

/** Counts the dark pixels drawn on a canvas: a page or a thumbnail. */
export async function inkedPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("not a canvas");
    const context = element.getContext("2d");
    if (context === null) throw new Error("the canvas has no 2d context");
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let inked = 0;
    for (let i = 0; i < data.length; i += 4) {
      const opaque = (data[i + 3] ?? 0) > 128;
      if (opaque && (data[i] ?? 255) < 128 && (data[i + 1] ?? 255) < 128 && (data[i + 2] ?? 255) < 128) inked++;
    }
    return inked;
  });
}

type Point = readonly [x: number, y: number];

/** Scrolls the pages so the middle of `points` (on one page, in points) is mid-view, and returns them on screen. */
async function onScreen(page: Page, pageNumber: number, points: readonly Point[]): Promise<[number, number][]> {
  const frame = page.locator(`#page-${pageNumber}`);
  const middle = (points.reduce((sum, [, y]) => sum + y, 0) / points.length) * CSS_PIXELS_PER_POINT;
  await frame.evaluate((element, offset) => {
    const pane = element.closest("main");
    if (pane === null) throw new Error("The page is not in the pages pane");
    const view = pane.getBoundingClientRect();
    pane.scrollBy(0, element.getBoundingClientRect().top + offset - (view.top + view.height / 2));
  }, middle);
  const bounds = await frame.boundingBox();
  if (bounds === null) throw new Error(`Page ${pageNumber} is not on screen`);
  return points.map(([x, y]) => [bounds.x + x * CSS_PIXELS_PER_POINT, bounds.y + y * CSS_PIXELS_PER_POINT]);
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
  const targetY = async () => ((await target.boundingBox())?.y ?? Infinity) + ty * CSS_PIXELS_PER_POINT;
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
  await page.mouse.move(bounds.x + tx * CSS_PIXELS_PER_POINT, bounds.y + ty * CSS_PIXELS_PER_POINT, { steps: 5 });
  await page.mouse.up();
}

/** Drags across the text inside `box` with the Select text tool, along its longer side. */
export async function selectText(page: Page, pageNumber: number, [x0, y0, x1, y1]: PointBox): Promise<void> {
  await page.getByRole("button", { name: "Select text" }).click();
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

/** Applies the marks, waits for the check to pass, and saves the download to a temporary file. */
export async function applyAndDownload(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Apply and check" }).click();
  await expect(page.getByText("Checked:")).toBeVisible();
  return saveDownload(page, () => page.getByRole("button", { name: "Download" }).click());
}

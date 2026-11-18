import { expect, type Page } from "@playwright/test";

export const twoPagePdf = new URL("../../fixtures/two-pages.pdf", import.meta.url).pathname;

export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("Open a PDF")).toBeEnabled();
}

export async function openPdf(page: Page, path: string): Promise<void> {
  await page.getByLabel("Open a PDF").setInputFiles(path);
}

/** Counts pixels on the page canvas that are not white, i.e. that something was drawn on. */
export async function inkedPixels(page: Page): Promise<number> {
  return page.getByRole("img", { name: "Page 1" }).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Page 1 is not a canvas");
    const context = element.getContext("2d");
    if (context === null) throw new Error("Page 1 canvas has no 2d context");
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let inked = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 128 && (data[i + 1] ?? 255) < 128 && (data[i + 2] ?? 255) < 128) inked++;
    }
    return inked;
  });
}

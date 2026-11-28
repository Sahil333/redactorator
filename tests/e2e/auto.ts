// Page helpers for Auto mode's tests.
import { expect, type Locator, type Page } from "@playwright/test";

/** The entry in the top bar that opens the chooser for the project. */
export const profileEntry = (page: Page): Locator => page.getByRole("banner").getByRole("button", { name: "What to look for" });

export const profileChooser = (page: Page): Locator => page.getByRole("dialog", { name: "What should Auto mode look for?" });

/** Opens the chooser for the project from the top bar. */
export async function openProfileChooser(page: Page): Promise<Locator> {
  await profileEntry(page).click();
  const chooser = profileChooser(page);
  await expect(chooser).toBeVisible();
  return chooser;
}

/** Chooses the project's profile: exactly the countries and industries `choices` names, none when it is empty. */
export async function chooseProfile(page: Page, choices: readonly string[]): Promise<void> {
  const chooser = await openProfileChooser(page);
  for (const box of await chooser.getByRole("checkbox").all()) await box.uncheck();
  for (const name of choices) await chooser.getByRole("checkbox", { name, exact: true }).check();
  await chooser.getByRole("button", { name: "Save" }).click();
  await expect(chooser).toHaveCount(0);
}

export const runButton = (page: Page): Locator => page.getByRole("banner").getByRole("button", { name: "Run Auto mode", exact: true });

export const stopButton = (page: Page): Locator => page.getByRole("banner").getByRole("button", { name: "Stop", exact: true });

/** Opens the Run control's menu and picks "For this run only", which opens the chooser for one run. */
export async function chooseForThisRun(page: Page): Promise<Locator> {
  await page.getByRole("banner").getByRole("button", { name: "Run options" }).click();
  await page.getByRole("menuitem", { name: "For this run only" }).click();
  const chooser = profileChooser(page);
  await expect(chooser).toBeVisible();
  return chooser;
}

/** The findings panel, in the marks panel's place while a findings review is open. */
export const findingsPanel = (page: Page): Locator => page.getByRole("complementary", { name: "Found values" });

/** The rows of the findings panel, one per found value. */
export const findingRows = (page: Page): Locator => findingsPanel(page).getByRole("listitem");

/** What a row of the findings panel gives tests: its value's text, its identifier's id and its number of places. */
export async function findingOf(row: Locator): Promise<{ readonly text: string | null; readonly identifier: string | null; readonly places: number }> {
  return { text: await row.getAttribute("data-text"), identifier: await row.getAttribute("data-identifier"), places: Number(await row.getAttribute("data-places")) };
}

/**
 * Records every text the top bar shows from now on, even one that shows only for a moment; the
 * returned function reads them.
 */
export async function recordTopBar(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const banner = document.querySelector("header");
    const seen: string[] = [];
    Reflect.set(globalThis, "topBarTexts", seen);
    if (banner !== null) new MutationObserver(() => seen.push(banner.textContent ?? "")).observe(banner, { subtree: true, childList: true, characterData: true });
  });
  return async () => {
    const seen: unknown = await page.evaluate(() => Reflect.get(globalThis, "topBarTexts"));
    return Array.isArray(seen) ? seen.filter((text) => typeof text === "string") : [];
  };
}

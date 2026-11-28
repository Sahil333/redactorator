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

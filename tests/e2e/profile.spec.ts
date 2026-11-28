import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { approvalLands, approve, approveButton, janeRoe, markText, oneWordPdf, openApp, openPdf, saved, storedJson } from "./app";
import { chooseProfile, openProfileChooser, profileChooser, profileEntry } from "./auto";
import { holdApprovalSearch } from "./fakes";

const projectFile = "one-word/.redactorator/pdf-3/project.json";

async function storedProfile(page: Page): Promise<unknown> {
  await saved(page);
  const project = await storedJson(page, projectFile);
  return typeof project === "object" && project !== null ? Reflect.get(project, "profile") : undefined;
}

const choices = ["United States", "United Kingdom", "India", "Canada", "Australia", "Finance", "Legal", "Medical"];

test("a new project has no profile; the chooser starts with nothing selected and lists what each choice adds", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  expect(await storedProfile(page)).toBeUndefined();

  const chooser = await openProfileChooser(page);

  await expect(chooser.getByRole("group", { name: "Countries" }).getByRole("checkbox")).toHaveCount(5);
  await expect(chooser.getByRole("group", { name: "Industries" }).getByRole("checkbox")).toHaveCount(3);
  for (const name of choices) {
    const box = chooser.getByRole("checkbox", { name, exact: true });
    await expect(box).not.toBeChecked();
    await expect(box).toHaveAccessibleDescription(/^Adds: \S/);
  }
  await expect(chooser.getByRole("checkbox", { name: "Finance" })).toHaveAccessibleDescription("Adds: BIC, LEI, ISIN, CUSIP, Crypto wallet address");
  await expect(chooser.getByRole("checkbox", { name: "Medical" })).toHaveAccessibleDescription(
    "Adds: Provider tax ID (US), Health insurance member ID, Insurance claim number, Prescription number",
  );
  // India's pack is the longest; every one of its identifiers is named, none hidden behind a control.
  await expect(chooser.getByRole("checkbox", { name: "India" })).toHaveAccessibleDescription(/Aadhaar, .*, ABHA number$/);
  await expect(chooser.getByText("Adds: Aadhaar,")).toBeVisible();
  await expect(chooser).toContainText("Every run looks for Payment card, IBAN, Email, Phone and Date of birth, whatever you choose.");
});

test("the chooser takes focus and gives it back, and Escape leaves the profile as it was", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
  await profileEntry(page).focus();
  await page.keyboard.press("Enter");

  const chooser = profileChooser(page);
  await expect(chooser.getByRole("checkbox", { name: "United States" })).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");

  await expect(chooser).toHaveCount(0);
  await expect(profileEntry(page)).toBeFocused();
  expect(await storedProfile(page)).toBeUndefined();
});

test("the chooser can be saved with nothing selected, and the stored answer survives a reload", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);

  await chooseProfile(page, []);

  await expect(profileEntry(page)).toBeFocused();
  expect(await storedProfile(page)).toEqual({ countries: [], industries: [] });

  await chooseProfile(page, ["India", "United States", "Finance"]);
  expect(await storedProfile(page)).toEqual({ countries: ["us", "in"], industries: ["finance"] });

  await page.reload();
  const chooser = await openProfileChooser(page);
  for (const name of choices) {
    const box = chooser.getByRole("checkbox", { name, exact: true });
    if (["India", "United States", "Finance"].includes(name)) await expect(box).toBeChecked();
    else await expect(box).not.toBeChecked();
  }
});

test("setting the profile puts no document back in review and makes no undo step", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await approve(page, undefined);
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();

  await chooseProfile(page, ["United Kingdom", "Legal"]);

  expect(await storedProfile(page)).toEqual({ countries: ["uk"], industries: ["legal"] });
  await expect(page.getByRole("banner").getByText("Approved", { exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();
});

test("a profile set while an approval is worked out is refused, and the chooser says why", async ({ page }) => {
  const release = await holdApprovalSearch(page);
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await approveButton(page).click();
  await expect(approveButton(page)).toBeDisabled();

  const chooser = await openProfileChooser(page);
  await chooser.getByRole("checkbox", { name: "Canada" }).check();
  await chooser.getByRole("button", { name: "Save" }).click();

  await expect(chooser.getByRole("alert")).toHaveText("A document is being approved. Try again once the approval is done.");
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Cancel" }).click();
  await release();
  await approvalLands(page, undefined);
  expect(await storedProfile(page)).toBeUndefined();
});

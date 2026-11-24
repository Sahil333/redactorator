// A session that writes every kind of stored change: the golden test compares what it stores
// with what today's build stored, and the network test watches it for connections.
import { expect, type Page } from "@playwright/test";
import {
  applyAndDownload,
  approve,
  crossPagePdf,
  dear,
  dragAcrossPages,
  drawBox,
  janeRoe,
  logoA,
  logoB,
  markText,
  mostOfLogo,
  oneWordPdf,
  openApp,
  openPdf,
  pickType,
  saved,
  show,
} from "./app";

export async function goldenSession(page: Page): Promise<void> {
  // Labelling mode, for link ids. Two copies of one-word.pdf share its name.
  await openApp(page, "/?label");
  await openPdf(page, oneWordPdf, oneWordPdf, crossPagePdf, logoA, logoB);

  await show(page, "one-word.pdf");
  await markText(page, 1, janeRoe, "Person");
  await show(page, "logo-a.pdf");
  await drawBox(page, 1, mostOfLogo, "Other");
  await show(page, "cross-page.pdf");
  await page.getByRole("button", { name: "Select text" }).click();
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  // From "Jane" at the end of page 1 to "Roe," on page 2, over the running header and footer.
  await dragAcrossPages(page, [1, 237, 107], [2, 96, 87]);
  await pickType(page, "Person");

  await show(page, "one-word.pdf");
  await page.getByRole("button", { name: "Change type of Jane Roe on page 1" }).click();
  await pickType(page, "Other");
  await page.getByRole("textbox", { name: "Link id for Jane Roe on page 1" }).fill("p1");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Redo" }).click();

  await show(page, "logo-a.pdf");
  await approve(page, /hides 3 places in logo-b\.pdf/);
  await show(page, "one-word.pdf");
  await approve(page, /one-word \(2\)\.pdf/);

  await show(page, "one-word (2).pdf");
  await markText(page, 1, dear, "Client");
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByText("White", { exact: true }).click();
  await page.keyboard.press("Escape");

  await show(page, "logo-b.pdf");
  await applyAndDownload(page);
  await page.getByRole("button", { name: "Back to editing" }).click();

  await saved(page);
  await page.reload();
  await show(page, "one-word.pdf");
  await markText(page, 1, dear, "Other");
  await saved(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
}

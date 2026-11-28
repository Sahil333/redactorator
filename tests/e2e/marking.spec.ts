import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./coverage";
import { addType, dear, drawBox, janeRoe, markText, oneWordPdf, openApp, openPdf, pickType, selectText, toScreen, type PointBox } from "./app";

const picker = (page: Page) => page.getByRole("combobox", { name: "Type for this mark" });
const marksPanel = (page: Page) => page.getByRole("complementary", { name: "Marks" });
const row = (page: Page, text: string) => marksPanel(page).getByRole("listitem").filter({ hasText: text });
const NOTHING = "rgba(0, 0, 0, 0)";

const background = (element: Locator) => element.evaluate((each) => getComputedStyle(each).backgroundColor);

async function open(page: Page): Promise<void> {
  await openApp(page);
  await openPdf(page, oneWordPdf);
}

async function hoverOn(page: Page, [x0, y0, x1, y1]: PointBox): Promise<void> {
  await page.mouse.move(...(await toScreen(page, 1, (x0 + x1) / 2, (y0 + y1) / 2)));
}

test("dragging a new selection while the type picker is open replaces the first one", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  await expect(picker(page)).toBeFocused();

  await selectText(page, 1, dear);
  await pickType(page, "Other");

  await expect(marksPanel(page).getByRole("listitem")).toHaveCount(1);
  await expect(marksPanel(page)).toContainText("Dear");
});

test("clicking outside the type picker, or tabbing out of it, makes no mark", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  await marksPanel(page).click({ position: { x: 20, y: 300 } });
  await expect(picker(page)).toHaveCount(0);

  await selectText(page, 1, janeRoe);
  await picker(page).press("Tab");
  await expect(picker(page)).toHaveCount(0);

  await expect(marksPanel(page)).toContainText("Select text or draw a box");
  // With no marks, Preview still checks the file, which then downloads as preparation left it.
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeEnabled();
});

test("a click inside the type picker keeps it open and its keys working", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);

  await picker(page).locator("..").click({ position: { x: 3, y: 3 } });

  await expect(picker(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
});

test("moving through the type list with the arrow keys keeps the chosen type in view", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  const list = page.getByRole("listbox", { name: "Types" });

  // From Person down to Other, the last of the general types, below the list's fold.
  await pressUntilSelected(page, "ArrowDown", list.getByRole("option", { name: "Other", exact: true }));
  await expect(list.getByRole("option", { name: "Other", exact: true })).toBeInViewport();

  // Up from the top goes round to the last identifier, at the foot of the list.
  await pressUntilSelected(page, "ArrowUp", list.getByRole("option", { name: "Person", exact: true }));
  await picker(page).press("ArrowUp");
  await expect(list.getByRole("option", { name: "Prescription number", selected: true })).toBeInViewport();
});

// The schema's 14 general types, then each pack's new identifiers under the pack's name.
const generalTypes = ["Person", "Address", "Email", "Phone", "Date of birth", "Government ID", "Financial account", "Payment card", "IP address", "Credential", "URL", "Signature", "Photo", "Other"];
const packGroups: readonly (readonly [string, number, string])[] = [
  ["Used everywhere", 1, "IBAN"],
  ["United States", 11, "SSN"],
  ["United Kingdom", 8, "National Insurance number"],
  ["India", 14, "Aadhaar"],
  ["Canada", 6, "SIN"],
  ["Australia", 7, "TFN"],
  ["Finance", 5, "BIC"],
  ["Legal", 3, "Court case number (US)"],
  ["Medical", 4, "Provider tax ID (US)"],
];

/** The options outside any group: the general types, the user's own and the "Add" row. */
const ungrouped = (list: Locator) => list.locator(":scope > [role=option]");

async function expectGroups(list: Locator, names: readonly string[]): Promise<void> {
  const groups = list.getByRole("group");
  await expect(groups).toHaveCount(names.length);
  for (const [index, name] of names.entries()) await expect(groups.nth(index)).toHaveAccessibleName(name);
}

async function expectGroupedTypes(list: Locator): Promise<void> {
  await expect(ungrouped(list)).toHaveText(generalTypes);
  await expectGroups(
    list,
    packGroups.map(([name]) => name),
  );
  for (const [name, count, first] of packGroups) {
    const options = list.getByRole("group", { name, exact: true }).getByRole("option");
    await expect(options).toHaveCount(count);
    await expect(options.first()).toHaveText(first);
  }
  // The six general types that are also identifiers are listed once, among the general types.
  for (const shared of ["Email", "Phone", "Date of birth", "Payment card", "IP address", "URL"]) await expect(list.getByRole("option", { name: shared, exact: true })).toHaveCount(1);
}

async function pressUntilSelected(page: Page, key: "ArrowDown" | "ArrowUp", option: Locator): Promise<void> {
  for (let presses = 0; presses < 80 && (await option.getAttribute("aria-selected")) !== "true"; presses++) await picker(page).press(key);
  await expect(option).toHaveAttribute("aria-selected", "true");
}

test("the type picker lists the general types, then each pack's identifiers under its name, for a new mark and for a mark's type", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  const list = page.getByRole("listbox", { name: "Types" });
  await expectGroupedTypes(list);

  // The arrow keys move from the general types into the first group, and from one group into the next.
  for (let step = 0; step < generalTypes.length; step++) await picker(page).press("ArrowDown");
  await expect(list.getByRole("group", { name: "Used everywhere" }).getByRole("option", { name: "IBAN", selected: true })).toBeInViewport();
  await picker(page).press("ArrowDown");
  await expect(list.getByRole("group", { name: "United States" }).getByRole("option", { name: "SSN", selected: true })).toBeInViewport();
  await picker(page).press("Enter");
  await expect(row(page, "Jane Roe")).toContainText("SSN · page 1");

  await marksPanel(page).getByRole("button", { name: "Change type of Jane Roe on page 1" }).click();
  await expectGroupedTypes(list);
  await expect(list.getByRole("option", { name: "SSN", selected: true })).toBeInViewport();
});

test("typing in the type picker filters across the groups", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  const list = page.getByRole("listbox", { name: "Types" });

  await picker(page).fill("passport");
  await expectGroups(list, ["United States", "United Kingdom", "India", "Canada", "Australia"]);
  await expect(list.getByRole("option")).toHaveText([
    "Passport number (US)",
    "Passport number (UK)",
    "Passport number (India)",
    "Passport number (Canada)",
    "Passport number (Australia)",
    "Add “passport” as a new type",
  ]);
  await expect(list.getByRole("option", { name: "Passport number (US)", selected: true })).toBeVisible();

  await picker(page).press("ArrowDown");
  await expect(list.getByRole("option", { name: "Passport number (UK)", selected: true })).toBeVisible();
  await picker(page).press("Enter");
  await expect(row(page, "Jane Roe")).toContainText("Passport number (UK) · page 1");
});

test("a typed name equal to a built-in type's name, in any case, is not added as a new type", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  const list = page.getByRole("listbox", { name: "Types" });

  await picker(page).fill("EMAIL");
  await expect(list.getByRole("option")).toHaveText(["Email"]);
  await picker(page).fill("ssn");
  await expect(list.getByRole("option")).toHaveText(["SSN"]);
  await expect(list.getByRole("option", { name: "SSN", selected: true })).toBeVisible();
  await picker(page).press("Enter");
  await expect(row(page, "Jane Roe")).toContainText("SSN · page 1");

  // SSN is still the built-in type alone: nothing was added beside it.
  await selectText(page, 1, dear);
  await picker(page).fill("ssn");
  await expect(list.getByRole("option")).toHaveText(["SSN"]);
});

test("a typed name that is part of a built-in type's name is added through its own row, and Enter alone picks the match", async ({ page }) => {
  await open(page);
  const list = page.getByRole("listbox", { name: "Types" });

  await selectText(page, 1, janeRoe);
  await picker(page).fill("Case number");
  await expect(list.getByRole("option")).toHaveText(["Court case number (US)", "Add “Case number” as a new type"]);
  await expect(list.getByRole("option", { name: "Court case number (US)", selected: true })).toBeVisible();
  await picker(page).press("Enter");
  await expect(row(page, "Jane Roe")).toContainText("Court case number (US) · page 1");

  await selectText(page, 1, dear);
  await picker(page).fill("Case number");
  await picker(page).press("ArrowDown");
  await expect(list.getByRole("option", { name: "Add “Case number” as a new type", selected: true })).toBeVisible();
  await picker(page).press("Enter");
  await expect(row(page, "Dear")).toContainText("Case number · page 1");
  await expect(row(page, "Dear")).not.toContainText("Court");

  // A type the user added is picked by its whole name, even listed below a type whose name holds it.
  await marksPanel(page).getByRole("button", { name: "Change type of Jane Roe on page 1" }).click();
  await addType(page, "Card");
  await marksPanel(page).getByRole("button", { name: "Change type of Dear on page 1" }).click();
  await picker(page).fill("card");
  await expect(list.getByRole("option")).toHaveText(["Payment card", "Card"]);
  await expect(list.getByRole("option", { name: "Card", exact: true, selected: true })).toBeVisible();
  await picker(page).press("Enter");
  await expect(row(page, "Dear")).toContainText("Card · page 1");
  await expect(row(page, "Dear")).not.toContainText("Payment");
});

test("clicking away from a mark's type picker keeps its type", async ({ page }) => {
  await open(page);
  await markText(page, 1, janeRoe, "Person");
  await marksPanel(page).getByRole("button", { name: "Change type of Jane Roe on page 1" }).click();
  await expect(picker(page)).toBeFocused();

  await page.locator("#page-1").click({ position: { x: 400, y: 600 } });

  await expect(picker(page)).toHaveCount(0);
  await expect(marksPanel(page)).toContainText("Person · page 1");
});

test("double-clicking a word marks the whole word", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();

  await page.mouse.dblclick(...(await toScreen(page, 1, 140, (janeRoe[1] + janeRoe[3]) / 2)));
  await pickType(page, "Person");

  await expect(marksPanel(page).getByRole("link", { name: "Roe," })).toBeVisible();
});

test("a mark shows its type on its top-left corner only while it's looked at, so the tag hides no text", async ({ page }) => {
  await open(page);
  await markText(page, 1, janeRoe, "Person");

  // A new mark shows its type.
  const tag = page.locator("#page-1").getByText("Person", { exact: true });
  await expect(tag).toBeVisible();
  const [left, top] = await toScreen(page, 1, janeRoe[0], janeRoe[1]);
  const at = await tag.boundingBox();
  expect(Math.abs((at?.x ?? 0) - left)).toBeLessThan(4);
  expect(Math.abs((at?.y ?? 0) + (at?.height ?? 0) - top)).toBeLessThan(4);

  // Pointing elsewhere hides it; pointing at the mark, or at its row in the marks panel, shows it.
  await hoverOn(page, dear);
  await expect(tag).toHaveCount(0);
  await hoverOn(page, janeRoe);
  await expect(tag).toBeVisible();
  await hoverOn(page, dear);
  await expect(tag).toHaveCount(0);
  await row(page, "Jane Roe").hover();
  await expect(tag).toBeVisible();
});

test("hovering a mark highlights its row, and hovering a row highlights the mark", async ({ page }) => {
  await open(page);
  await markText(page, 1, janeRoe, "Person");
  const markBox = page.locator("#mark-1");
  await hoverOn(page, dear);
  const plain = await background(markBox);

  await hoverOn(page, janeRoe);
  await expect.poll(() => background(row(page, "Jane Roe"))).not.toBe(NOTHING);
  await hoverOn(page, dear);
  await expect.poll(() => background(row(page, "Jane Roe"))).toBe(NOTHING);

  await row(page, "Jane Roe").hover();
  await expect.poll(() => background(markBox)).not.toBe(plain);
});

test("a mark's link in the marks panel brings the mark itself into view, even at the foot of a long page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await open(page);
  await drawBox(page, 1, [72, 740, 200, 770], "Other");
  const pane = page.locator("main");
  await pane.evaluate((element) => element.scrollTo(0, 0));
  const mark = page.locator("#mark-1");
  await expect(mark).not.toBeInViewport();

  await row(page, "Box").getByRole("link").click();
  await expect(mark).toBeInViewport();
});

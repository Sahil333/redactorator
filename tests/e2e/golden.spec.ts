// fixtures/golden/ holds what the build of commit fc0649f stored: `project/` is the storage the
// session left, and `expected/` and `expected-old/` the four stored files with ids and dates as
// placeholders. A change must store the same bytes. GOLDEN_UPDATE=1 records them again.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { markText, openApp, reference, saved, show } from "./app";
import { goldenSession } from "./goldenSession";

const golden = new URL("../../fixtures/golden/", import.meta.url).pathname;
const recording = process.env.GOLDEN_UPDATE === "1";

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const isoDate = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/** Every file in the browser's private storage, by path. */
async function storedFiles(page: Page): Promise<Map<string, Uint8Array>> {
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

/** Replaces `value` by the placeholder `kind` numbered in order of first appearance. */
function numbered(seen: Map<string, string>, value: string, kind: string): string {
  const known = seen.get(value);
  if (known !== undefined) return known;
  const placeholder = `<${kind}-${seen.size + 1}>`;
  seen.set(value, placeholder);
  return placeholder;
}

/**
 * The four stored files of the one project in `stored`, with ids and dates as placeholders, by
 * name: project.json, then settings.json, then each document's reading named by its id's placeholder.
 */
function goldenForm(stored: ReadonlyMap<string, Uint8Array>): Map<string, string> {
  const ids = new Map<string, string>();
  const dates = new Map<string, string>();
  const mask = (text: string) => text.replace(uuid, (id) => numbered(ids, id, "id")).replace(isoDate, (date) => numbered(dates, date, "date"));
  const text = (bytes: Uint8Array) => mask(new TextDecoder().decode(bytes));
  const records = [...stored].filter(([path]) => /^[^/]+\/\.redactorator\/project\.json$/.test(path));
  expect(records, "one project is stored").toHaveLength(1);
  const settings = stored.get(".redactorator/settings.json");
  if (settings === undefined) throw new Error("No settings are stored");
  const form = new Map([
    ["project.json", text(records[0]?.[1] ?? new Uint8Array())],
    ["settings.json", text(settings)],
  ]);
  const readings = [...stored].flatMap(([path, bytes]) => {
    const reading = /^[^/]+\/\.redactorator\/(text|images)\/(.+)\.json$/.exec(path);
    // Named without the placeholder's angle brackets, which some file systems refuse.
    return reading === null ? [] : [[`${reading[1]}/${mask(reading[2] ?? "").slice(1, -1)}.json`, text(bytes)] satisfies [string, string]];
  });
  for (const [name, content] of readings.sort(([a], [b]) => a.localeCompare(b))) form.set(name, content);
  return form;
}

/** The files under `folder`, by path relative to it. */
async function filesIn(folder: string): Promise<Map<string, Buffer>> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const paths = entries.filter((entry) => entry.isFile()).map((entry) => relative(folder, join(entry.parentPath, entry.name)));
  return new Map(await Promise.all(paths.sort().map(async (path): Promise<[string, Buffer]> => [path, await readFile(join(folder, path))])));
}

async function writeFolder(folder: string, files: ReadonlyMap<string, string | Uint8Array>): Promise<void> {
  await rm(folder, { recursive: true, force: true });
  for (const [path, content] of files) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), content);
  }
}

/** Records `form` as the expected files in `folder` when recording; otherwise compares it with them. */
async function matchesGolden(form: ReadonlyMap<string, string>, folder: string): Promise<void> {
  if (recording) {
    await writeFolder(join(golden, folder), form);
    return;
  }
  const expected = new Map([...(await filesIn(join(golden, folder)))].map(([path, bytes]) => [path, bytes.toString("utf8")]));
  expect(Object.fromEntries(form)).toEqual(Object.fromEntries(expected));
}

test("a session stores the same bytes as today's build", async ({ page }) => {
  await goldenSession(page);

  const stored = await storedFiles(page);
  if (recording) await writeFolder(join(golden, "project"), stored);
  await matchesGolden(goldenForm(stored), "expected");
});

test("a project stored by today's build opens, and is stored again in the same bytes", async ({ page }) => {
  const project = await filesIn(join(golden, "project"));
  await openApp(page);
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    for (const [path, bytes] of files) {
      const names = path.split("/");
      const name = names.pop() ?? "";
      let folder = root;
      for (const each of names) folder = await folder.getDirectoryHandle(each, { create: true });
      const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await writable.write(Uint8Array.from(bytes));
      await writable.close();
    }
  }, [...project].map(([path, bytes]): [string, number[]] => [path, [...bytes]]));
  await page.reload();

  await page.getByRole("button", { name: "cross-page", exact: true }).click();
  await show(page, "logo-a.pdf");
  await markText(page, 1, reference, "Other");
  await saved(page);

  await matchesGolden(goldenForm(await storedFiles(page)), "expected-old");
});

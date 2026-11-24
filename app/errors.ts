// The sentence a user sees for each error code the app shows.
import type { EngineError, ErrorCode } from "../engine/api/errors";

const sentences: Partial<Record<ErrorCode, (data: (key: string) => string) => string>> = {
  "worker-not-running": () => "The PDF engine is not running. Reload the page to try again.",
  "unexpected-reply": () => "The PDF engine sent something unexpected. Reload the page to try again.",
  "unreadable-reply": () => "The PDF engine sent something unreadable. Reload the page to try again.",
  "worker-stopped": () => "The PDF engine stopped. Reload the page to try again.",
  "projects-read-failed": () => "Your projects could not be read. Reload the page to try again.",
  "open-elsewhere": (data) => `“${data("name")}” is open in another tab. Close it there to ${data("doing")} here.`,
  "project-gone": (data) =>
    `“${data("name")}” has changed or gone since this list was shown, perhaps in another tab. The list is up to date now; try again.`,
  "settings-damaged": () => "Your settings could not be read, so the defaults are in use. Changing a setting saves new ones.",
  "settings-newer": () =>
    "Your settings were saved by a newer version of Redactorator, so the defaults are in use and changes are not saved. Reload the page to get the newer version.",
  "left-behind": (data) =>
    `“${data("name")}” is open in another tab, so it stays inside Chrome for now. Close it there, then reload this page to move it.`,
  "not-moved": (data) => `Some projects could not be moved into “${data("name")}”, so they stay inside Chrome for now. Reload the page to try again.`,
  "one-project": (data) => `“${data("name")}” is one project's own folder. Choose the folder that holds your projects, or a new empty folder.`,
  "folder-not-chosen": () => "That folder could not be used for your projects. Reload the page, then choose it again.",
  "folder-not-allowed": (data) =>
    `Chrome didn't allow this page to use “${data("name")}”. Allow it in Chrome's settings for this site, then click Reopen again.`,
  "settings-save-failed": () => "Your settings could not be saved. Check that the disk has space, then change the setting again.",
};

/** What to tell the user about `error`: the worker's own sentence, or the app's; undefined for one the app never shows. */
export function errorText(error: EngineError | undefined): string | undefined {
  if (error === undefined) return undefined;
  return error.message ?? sentences[error.code]?.((key) => String(error.data?.[key] ?? ""));
}

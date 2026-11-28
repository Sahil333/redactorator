// The sentence a user sees for each error code the app shows.
import type { EngineError, ErrorCode } from "../engine/api/errors";

// Refusals name a 0-based page; people count pages from 1.
const shownPage = (data: (key: string) => string) => Number(data("page")) + 1;

const sentences: Partial<Record<ErrorCode, (data: (key: string) => string) => string>> = {
  "mark-lost": (data) => `A mark on page ${shownPage(data)} no longer matches the page. Mark it again.`,
  "extra-text-removed": (data) => `Cleaning would also remove unmarked text next to a mark on page ${shownPage(data)}. The extra letters are highlighted.`,
  "text-moved": (data) => `Other text on page ${shownPage(data)} would move in the cleaned file. This PDF can't be cleaned here yet.`,
  "partly-covered-drawing": (data) => `A box on page ${shownPage(data)} covers part of a drawing. Cover the whole drawing with a margin around it, or remove the box.`,
  "check-failed": (data) =>
    data("page") === "" ? "The cleaned file failed a check. This PDF can't be cleaned here yet." : `The cleaned file failed a check on page ${shownPage(data)}. This PDF can't be cleaned here yet.`,
  "apply-failed": () => "The marks could not be applied. Preview again.",
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
  "change-failed": () => "That change could not be saved. Check that the disk has space, then try again.",
  "import-projects": () =>
    "That folder holds projects rather than being one. To keep your projects there, choose it as your projects folder instead. To import one project, pick that project's own folder.",
  "import-missing": () => "That folder holds no Redactorator project. Choose the folder that holds a project's documents and its .redactorator folder.",
  "import-damaged": () => "That project's file is damaged, so it can't be imported.",
  "import-newer": () => "That project was saved by a newer version of Redactorator. Reload the page to get it, then import the project again.",
  "import-failed": () => "That project could not be copied in. Check that the disk has space, then import it again.",
  "not-pdf": () => "This is not a PDF.",
  "unsupported-form": () => "This PDF is an XFA form, which can't be cleaned here. Save it as an ordinary PDF in the app that made it, then add it again.",
  "prepare-failed": () => "This PDF can't be prepared for cleaning here.",
  "unreadable-file": () => "This file could not be read. Choose it again.",
  "add-save-failed": () => "This file could not be saved in the project. Check that the disk has space, then add it again.",
  "add-search-failed": () =>
    "This file could not be searched for the project's hidden values, so it wasn't added. Reload the page, then add it again.",
  "add-while-approving": () => "This file wasn't added while a document was being approved. Add it again once the approval is done.",
  "add-while-applying": () => "This file wasn't added while a document was being previewed. Add it again once the preview is done.",
  "original-missing": (data) => `${data("file")} is missing from the project's folder, so it can't be shown. Add the file again with Add documents.`,
  "save-failed": () => "Your latest changes could not be saved. Check that the disk has space; the next change tries again.",
  "approval-failed": () => "The documents' text could not be read, so nothing was approved. Reload the page and approve again.",
  "detector-not-started": () => "Auto mode could not start. Try again.",
  "recognizer-failed": () => "Auto mode could not load its rules. Try again.",
  "detector-failed": () => "Auto mode stopped because of an error.",
};

/** What to tell the user about `error`: the worker's own sentence, or the app's; undefined for one the app never shows. */
export function errorText(error: EngineError | undefined): string | undefined {
  if (error === undefined) return undefined;
  return error.message ?? sentences[error.code]?.((key) => String(error.data?.[key] ?? ""));
}

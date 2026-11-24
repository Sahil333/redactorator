import type { ReaderErrorCode, WriterErrorCode } from "../model/errors";

/** Codes the PDF-worker client gives on its own; the worker never sends them. The first five are where the wire's `bad-message` arose. */
export type PdfClientErrorCode = "worker-stopped" | "worker-not-running" | "unexpected-reply" | "unreadable-reply" | "unknown-request" | "stale-handle";

/** Why a command failed, or what went wrong: the app maps each code, with its data, to a sentence (app/errors.ts). */
export type ErrorCode =
  | ReaderErrorCode
  | WriterErrorCode
  // The PDF worker could not read a request, passed on with the worker's own sentence.
  | "bad-message"
  | PdfClientErrorCode
  // The Library's.
  | "projects-read-failed"
  | "open-elsewhere"
  | "project-gone"
  | "settings-damaged"
  | "settings-newer"
  | "left-behind"
  | "not-moved"
  | "one-project"
  | "folder-not-chosen"
  | "folder-not-allowed"
  | "settings-save-failed"
  | "change-failed"
  | "import-projects"
  | "import-missing"
  | "import-damaged"
  | "import-newer"
  | "import-failed"
  // Why a chosen file was not added.
  | "not-pdf"
  | "unreadable-file"
  | "add-save-failed"
  | "add-search-failed"
  | "add-while-approving"
  // The open document's original is not in the project's folder.
  | "original-missing"
  // The project's latest changes could not be saved: `close`'s result while the Session stays open.
  | "save-failed"
  // The documents' readings could not be had or searched, so nothing was approved.
  | "approval-failed"
  // Refusals the app never shows: it disables the control from the state, or never sends the command.
  | "busy-moving"
  | "busy-creating"
  | "no-store"
  | "open-here"
  | "session-open"
  | "session-closed"
  | "unknown-project"
  | "unknown-document"
  | "unknown-mark"
  | "page-text-missing"
  | "empty-target"
  | "empty-box"
  | "worker-not-ready"
  | "busy-adding"
  | "busy-approving"
  | "busy-applying"
  | "no-plan";

export interface EngineError {
  readonly code: ErrorCode;
  /** Values the sentence names, such as a project's or a folder's name. */
  readonly data?: Readonly<Record<string, string | number>>;
  /** A sentence the PDF worker composed, passed through unchanged. */
  readonly message?: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: EngineError };

/** A chosen file that was not added, and why. DOC-4: nothing is left out silently. */
export interface Refusal {
  readonly file: string;
  readonly error: EngineError;
}

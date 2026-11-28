# engine/api

## Overview

The engine's public contract. This folder holds only types. The app, or a
script, drives the engine through them: one `Engine` object, commands grouped
by role (`Library` and `Session`), one immutable `EngineState`, and the error
codes that every command result can carry. The implementation lives in
`engine/core`, and `engine/host-browser` builds it for a browser page.

The fallow boundary rules in `.fallowrc.json` (`{ "from": "api", "allow": ["model", "storage"] }`)
limit this folder to importing [engine/model](../model/README.md) and
[engine/storage](../storage/README.md).

## Interface

### `facade.ts`

- `Engine` has these members:
  - `getState()`
  - `subscribe(listener)`, which returns an unsubscribe function
  - `library`
  - `session()`
- `Library` has three groups:
  - `projects`: `refresh`, `create`, `open`, `rename`, `duplicate`, `archive`, `remove`
  - `folders`: `check`, `switchTo`, `importFrom`. `check` resolves to
    `"usable"`, or `"one-project"` when the folder is itself one project's
    folder. `switchTo` resolves to the `leftBehind` project names, which stay
    because they are open in another tab.
  - `settings`: `update`
- `Session` is one open, locked project. It has these groups:
  - `marks`: `add`, `retype`, `remove`, `keepHere`
  - `history`: `undo` and `redo`, per document
  - `approval`: `plan`, `confirm`, `cancel`. `plan` lands the approval at once
    (`{ landed: true }`) when it changes nothing beyond the document's review
    state. Otherwise it resolves to `{ landed: false, plan }`, and the plan
    waits in the state for `confirm` or `cancel` (`facade.ts:Session.approval`).
  - `documents`: `add`, `markDownloaded`
  - `viewer`: `open`, `render`, `pageText`, `images`
  - `detection`: `run` (with an optional profile for this run only) and
    `stop`, per document: Auto mode's run. `run` resolves once the run has
    started, or with its refusal, after the document's stored page texts are
    read
  - `findings`: `setTicked`, `choose`, `setEdges`, `confirm`, `close` and
    `dismissNotice`, per document and finding key: its findings review
  - `profile`: `set`, the countries and industries Auto mode looks for
  - `output`: `apply`, `bytes`, `discard`
  - `labelling`: `link`, `exportGroundTruth`

  It also has `flush()`, `close()` and `projectId`. `flush()` resolves to a
  `boolean`, not a `Result`: `true` when every change so far was written
  (`facade.ts:Session.flush`).
- `TargetInput` is the text pieces from `selectionPieces`, or a drawn box.
- `SettingsChange` is a partial `appearance`.
- `IncomingFile` has `name`, `path`, `type` and `read()`.

### `state.ts`

- `EngineState` holds `revision`, `worker` status, `problems`, `library` and an
  optional `session`.
- `LibraryState` holds `place` (`none`, `browser`, or `folder` with a name),
  `phase` (`none | loading | ready | moving | opening`), `projects` (undefined
  until the first list lands), `settings`, `creating`, and the `can` gate for
  the Library's commands.
- `Problem` and `ProjectSummary` (readable or `unreadable: "damaged" | "newer"`).
- `SessionState` holds `project`, `folder`, the `save` status, `operation`
  (including `"updating"`, while documents are prepared again for this
  build), `approval`, the `open` and `output` handles, `can`, `reach`,
  `newFrom`, `documentStatus`: per document, its removed kinds, the ids of
  its lost marks, and the code it failed to prepare again with, if it did,
  and `detection`: per document, its `DocumentDetection`. The operation
  `"marking"` runs while confirmed findings become marks. The project's
  `profile` is part of `project`.
- `DocumentStatus`.
- `DocumentDetection`: a document's `run` (`idle`, or `running` with the page
  being searched of how many), its open findings review's `findings` and the
  pages not searched, a `notice` about its last run or its dropped findings
  review, `nextUndo` (an edit, or a confirmed findings review with its
  counts), and `can` (`run`, `stop`, `confirm`, `close`, `dismiss`).
- `DocumentHandle` and `ApprovalPlan`, which counts `unmarkedFindings`: the
  found values of the document's open findings review, which stay in the file.

### `errors.ts`

- `ErrorCode` is the union of:
  - `ReaderErrorCode` and `WriterErrorCode` from [engine/model](../model/README.md);
  - `bad-message`;
  - `PdfClientErrorCode`;
  - the Library, add-file, save and approval codes;
  - `original-missing`, when the open document's original is not in the
    project's folder;
  - `busy-updating`, while documents are prepared again, and for an approval
    of a document whose prepared files are not read yet;
  - `busy-adding`, `busy-approving`, `busy-applying` and `busy-marking`, while
    another operation runs: the app shows them where no state disables the
    control, as when setting the profile or for a dropped file;
  - `DetectionErrorCode` from [engine/model](../model/README.md): why a run of
    Auto mode ended as failed;
  - the refusal codes that the app never shows.
- `PdfClientErrorCode`: `worker-stopped`, `worker-not-running`,
  `unexpected-reply`, `unreadable-reply`, `unknown-request`, `stale-handle`.
- `EngineError` has `code`, and optionally `data` (values its sentence names,
  and where a refusal applies: a 0-based `page` and `boxes`) and `message`.
- `Result<T>` is `{ ok: true, value }` or `{ ok: false, error }`.
- `Refusal` is a file that was not added, with the reason.

## Invariants

These are contracts stated in the type docs. The implementation in
`engine/core` must keep them.

- The engine state is one immutable value. It stays the same object until
  something changes, and `revision` rises on every change
  (`state.ts:EngineState`).
- Commands report failure through `Result<T>` and an `ErrorCode`. The one
  exception is `flush()`, which resolves to `false` when a change did not land.
  The app maps each code, with its `data`, to a sentence. `message` carries a
  sentence that the PDF worker composed, unchanged (`errors.ts:EngineError`).
- Adding, approving, applying, marking confirmed findings and updating
  documents run one at a time (`state.ts:SessionState.operation`). A run of
  Auto mode is not an operation: one runs at a time in a project.
- Viewer results (pixels, page text, images) never enter the state
  (`facade.ts:Session.viewer`).
- The cleaned output's bytes stay inside the engine. `output.bytes()` releases
  them for Download (`state.ts:SessionState.output`, `facade.ts:Session.output`).
- `marks.add` is refused with `stale-handle` once its handle no longer belongs
  to the open document (`facade.ts:Session.marks.add`).
- Retyping a mark retypes every mark of the same value, because a value has one
  type (`facade.ts:Session.marks.retype`).
- No chosen file is left out silently. Each file that is not added comes back
  as a `Refusal` (`errors.ts:Refusal`, DOC-4).
- `IncomingFile.read()` is called only for PDFs, one file at a time, in order
  (`facade.ts:IncomingFile`).
- `close()` saves every change before it releases the project. If the save
  fails, the Session stays open and the result is `save-failed`
  (`facade.ts:Session.close`).

## Side Effects

- None at runtime. The folder exports only types and interfaces.

## Verification

- Run: `pnpm test`. It includes `tsc -p engine/api` and
  `pnpm exec fallow architecture --boundaries`.

# Session

## Overview

The open Session: one project held open for editing. `openSession` builds the
`Session` API (marks, history, approval, documents, viewer, detection,
findings, profile, output, labelling, flush, close) over a project record. Every command passes the gate first; the
state it reads and changes is the `SessionParts` reduced by the
[slices](./slices/README.md) from `SessionChange` records, and the asynchronous
work is done by the [effects](./effects/README.md). The selectors turn the
parts into the published `SessionState`.

## Interface

- `facade.ts`
  - `openSession(host, opening, hold, onClosed): OpenSession`: the Session over
    `opening.project`, holding the `LockHold` until it closes.
  - `OpenSession`: `session`, `store`, `folder`, `parts`.
  - `SessionHost`: what the engine root gives a Session: `state()`,
    `dispatch(from, change, ...effects)`, `client` (`PdfClient`), `detection`
    (`DetectionClient`), `intake` and `addCustomType`.
- `changes.ts`
  - `SessionChange`: the union of every change to the Session's state
    (mark commands, `undo`/`redo`/`restored`, approval, adding, `downloaded`,
    opening, applying, `outputDiscarded`, saving and closing records, and Auto
    mode's: a run, a findings review, notices and `profileSet`).
    `downloaded` is sent by `documents.markDownloaded` and `outputDiscarded`
    by `output.discard` (`facade.ts:openSession`).
  - `Edits`: a document's `marks` and kept-visible `shown` list.
  - `OutputTag`: what a cleaned file was written from (`document`, `edits`,
    `appearance`).
- `gate.ts`
  - `gate(view, command, document?)`: the `ErrorCode` a command is refused
    with now, or `undefined`.
  - `SessionView`: `worker`, `settings` and `parts`, as the gate and selectors
    read them.
- `selectors.ts`
  - `sessionState(view, folder)`: the Session's part of the published state,
    including `can`, `reach`, `newFrom` and, per document, `detection`.
  - `validOutput(view)`: the output while it still matches what it was written
    from.
  - `canStep(view, document, direction)`: whether undo or redo has a snapshot.
- Subdirectories
  - [Slices](./slices/README.md): pure reducers for `SessionParts`.
  - [Effects](./effects/README.md): opening, applying, approving, adding,
    readings, saving, and Auto mode's runs, findings reviews and profile.

## Invariants

- Every command goes through `allowed`, which returns `session-closed` once
  this Session is no longer the open one, then the `gate` code
  (`facade.ts:openSession`, `allowed`, `view`).
- The gate checks in order: closing (`session-closed`), an unknown document
  (`unknown-document`), an update or prepared files not read yet
  (`busy-updating`), a run on a document that could not be prepared (its
  reader error code), approval, another running operation, Auto mode (a run or
  a findings review), the PDF worker's status (`worker-not-ready`), and an
  apply with nothing open (`stale-handle`) (`gate.ts:gate`).
- While approval plans or waits for its heads-up, every command that changes
  the project record, and every other operation, is refused, so the plan
  always lands on the record it was made from (`gate.ts:waitsForApproval`,
  `gate.ts:approving`). Opening another document is allowed behind the
  heads-up but not while planning.
- `history`, `open`, `apply`, `approve`, `findings.confirm` and `profile.set`
  are refused while an apply runs, documents are added or findings are
  confirmed (`gate.ts:oneOperation`, `busy`); `documents.add` has its own codes
  (`gate.ts:addRefused`). `findings.close` is refused only while findings are
  confirmed (`gate.ts:running`).
- One run at a time in a project: a second run is refused with
  `busy-detecting`, and so is approving the document a run is on. On a
  document whose findings review is open, hand marking, undo, redo and a new
  run are refused with `findings-open`; on one with none open, every
  `findings` command but `dismissNotice` is refused with `no-findings`
  (`gate.ts:detecting`).
- `detection.run` is refused with `no-profile` when the project has no profile
  and the run names none (`effects/detect.ts`).
- While documents are prepared again for this build, `add`, `mark`, `history`,
  `open`, `apply`, `approve`, `confirm`, `addDocuments` and `markDownloaded`
  and Auto mode's commands are refused with `busy-updating`
  (`gate.ts:waitsForUpdate`). `approve`, `detection.run` and the `findings`
  commands are also refused with it for a document whose prepared files are
  not read yet: the approval dialog lists what preparing it removed, and Auto
  mode reads its page texts (`gate.ts:waitsForPrepared`).
- When the Session becomes the open one, `begin` reads each document's
  prepared files in the tag folder, places its marks again on that text, and
  starts the update when the project was just migrated or any document's
  files are missing or damaged (`facade.ts:begin`). Closing waits for the
  update.
- `history`, `apply` and `approve` need the PDF worker started; a mark needs
  only the page text the Session holds and is refused only while the worker is
  starting; `documents.add` is refused with `worker-not-ready` once the worker
  has stopped (`gate.ts:needsWorker`, `gate.ts:waitsForWorker`).
- `history.undo` and `redo` dispatch only when `canStep` finds a snapshot;
  otherwise they return success and change nothing (`facade.ts:openSession`,
  `step`, `selectors.ts:canStep`).
- An output is valid only while the open document, its edit count and the
  appearance (by identity) match its tag, and the PDF worker has not stopped
  (`selectors.ts:validOutput`). `output.bytes` returns `stale-handle` otherwise
  (`facade.ts`, `output.bytes`).
- `marks.add` refuses a handle that is not the open one (`stale-handle`) and a
  text piece whose offsets fall outside its page's text, or a box that is empty
  or off the document's pages (`facade.ts:fits`, `facade.ts:targetOf`).
- Every change to the project record is dispatched through `change`, which
  schedules a save (`facade.ts:openSession`, `change` with `saving.changed`).
- Closing lets a running add or approval plan land first, cancels a plan
  waiting for its heads-up, and releases the lock only after the save
  succeeds; a failed save dispatches `closeFailed` and keeps the Session open
  (`facade.ts:close`).
- `keepHere` acts only on a mark whose value has a key (`facade.ts`,
  `marks.keepHere`, `markKey`).

## Side Effects

- Project storage through `Store`: the project record is saved on every
  record change, and originals, texts and images are read and written by the
  effects (see [effects](./effects/README.md)).
- PDF worker calls through `SessionHost.client` (`PdfClient`), made by the
  effects. `SessionHost.detection` makes none yet: until the detection worker
  exists, `createEngine` gives the Session the stand-in `notStarted`.
- Dispatches `SessionChange` records to the engine root through
  `SessionHost.dispatch`.
- `SessionHost.addCustomType` adds a mark type the user typed to the settings
  (`facade.ts:rememberType`).
- `LockHold.release()` and `onClosed()` run once a close's save succeeds
  (`facade.ts:close`).
- No network requests are made in this directory or its subdirectories.

## Verification

- Run: `pnpm test`

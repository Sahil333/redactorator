# Session slices

## Overview

The pure reducers for the open Session's part of the engine state. Each slice
takes its part and a `SessionChange` (from [`../changes.ts`](../changes.ts)) and
returns the next part, in most slices the same object when nothing changed
(see Invariants for where `history` differs). `session` in
`index.ts` combines the slices into `SessionParts`. No slice reads storage, calls
the PDF worker or dispatches; the effects in [`../effects`](../effects/README.md)
and the facade do that.

## Interface

- `index.ts`
  - `SessionParts`: `record: HistoryPart<MarksPart>`, `operation: OperationPart`,
    `viewer: ViewerPart`, `output: OutputPart | undefined`,
    `approval: ApprovalPart | undefined`, `documents: DocumentsPart`,
    `detection: DetectionPart`, `findings: FindingsPart`.
  - `firstParts(project)`: the parts of a freshly opened Session.
  - `session(parts, change)`: the combined reducer; returns `parts` itself when
    every slice returns its part unchanged.
- `history.ts`
  - `HistoryPart<P>`: `present` (the wrapped part) and `steps`, a per-document
    map of `past` and `future` `Edits` snapshots.
  - `history(inner, undoable)`: wraps a slice with per-document undo and redo.
  - `withNoHistory(present)`, `stepsOf(part, document)`.
- `marks.ts`
  - `MarksPart`: `project` (the project record as saved) and `edits`, a
    per-document edit counter.
  - `firstMarks(project)`, `marks(part, change)`.
- `operation.ts`
  - `OperationPart`: `operation`, `save` (typed from `SessionState` in
    `engine/api/state`) and `closing`.
  - `firstOperation` (`idle`, `saved`, not closing), `operation(part, change)`.
- `viewer.ts`
  - `ViewerPart`: `handle` of the document open in the PDF worker and its
    page `texts`.
  - `firstViewer`, `viewer(part, change)`.
- `output.ts`
  - `OutputPart`: `tag` (`OutputTag`), the cleaned file's `bytes`, and `shown`
    (`DocumentHandle`).
  - `output(part, change)`.
- `approval.ts`
  - `ApprovalPart`: the `plan` waiting for its heads-up, the record it was
    worked out `from`, and the `project` record it makes.
  - `approval(part, change)`.
- `documents.ts`
  - `DocumentsPart`: per document, its removed kinds, lost marks and failed
    preparation, set by `documentPrepared` and `preparationFailed`.
  - `firstDocuments`, `documents(part, change)`.
- `detection.ts`
  - `DetectionPart`: per document, its run of Auto mode and the notice about
    its last run that is not stored.
  - `firstDetection`, `detection(part, change)`: `runStarted` sets the run
    running on page 1; each `pageSearched` moves it to the next page; `runEnded`
    removes it; `noticeSet` sets the notice, which the next `runStarted`
    clears.
- `findings.ts`
  - `FindingsPart`: per document with an open findings review, its
    `OpenFindings`: the run's id, hits and pages not searched, the user's
    changes by finding key, and the resolver's findings.
  - `firstFindings`, `findings(part, change)`: `findingsOpened` opens a
    findings review, `findingsResolved` replaces its findings, and
    `findingsClosed` ends it.

## Invariants

- Slices are pure. `index.ts:session`, `operation.ts:operation` and
  `viewer.ts:viewer` return their input part when the change does not affect
  it. `history.ts:history` does so only for a change that is neither undoable
  nor `approved`: an undoable change always records a snapshot and returns a
  new part, even when the wrapped slice changed nothing, and `approved` always
  returns a new part.
- `markAdded` also drops the lost marks it `replaces`, which the facade
  works out: the document's lost marks of the same letters on a page the new
  mark shares (`facade.ts:markedAgain`; CUJ 7).
- Only `markAdded`, `markRetyped`, `markRemoved` and `keptHere` are undoable
  (`index.ts:isUndoable`). `linked` is labelling data: it is not undone, does
  not count as an edit and leaves the document's review state alone
  (`marks.ts:edited`, `marks.ts:withEdits` with `kind: "label"`).
- An undoable change records a snapshot of the document's `marks` and `shown`
  before it, clears that document's redo, and keeps at most `HISTORY_LIMIT`
  (100) snapshots per document (`history.ts:history`).
- Undo and redo reach the wrapped slice only as a `restored` change
  (`history.ts:step`). Restoring keeps each mark's current `linkId`
  (`marks.ts:restored`).
- `approved` removes the undo and redo history of every document it changed,
  and `reanchored` that of its document, as the snapshots hold offsets this
  build no longer reads (`history.ts:history`).
- `reanchored` replaces a document's marks without counting an edit or
  changing its download state; an approved document whose marks or working
  copy changed goes back to `in-review` (`marks.ts:reanchored`). It changes
  the project record, so it is saved (`operation.ts:changesRecord`).
- `updateStarted` and `updateFinished` set and clear the operation
  `"updating"`; `updateStarted` also drops the output, whose working copy may
  be made again (`operation.ts`, `output.ts`).
- An `edit` sets the document's `review` to `"in-review"` and its `download` to
  `"changed"` unless it is `"none"`; a mark on a value drops that value from the
  document's kept-visible `shown` list (`marks.ts:withEdits`). A `restored`
  change, so an undo or redo, is applied as an `edit` and does the same
  (`marks.ts:restored`).
- `markRetyped` and `markRemoved` act on every mark of the same item, matched
  by `itemKey`; `keptHere` removes every mark whose `itemKey` is the key and
  adds the key to `shown` (`marks.ts:edited`).
- `downloaded` sets the document's `download` to `"downloaded"`; it is not an
  edit, is not undoable and does not raise the edit counter (`marks.ts:marks`).
  It changes the project record, so it is saved
  (`operation.ts:changesRecord`).
- Each document's edit counter rises on every edit, `restored`, `approved`
  (for each changed document) and `documentsAdded` (`marks.ts:marks`,
  `marks.ts:counted`). The facade's output validity check compares against it.
- Every change that alters the project record sets `save` to `"saving"`
  (`operation.ts:changesRecord`, `operation.ts:saveAfter`); `saved` and
  `saveFailed` set `"saved"` and `"failed"`.
- `operation` moves only on the changes listed in `operation.ts:operationAfter`
  (for example `planned` to `"confirming"`, `applyStarted` to `"applying"`,
  `findingsApplying` to `"marking"`, `findingsApplied` back to `"idle"`).
- `profileSet` sets the project's profile. It is not an edit: it is not
  undone, raises no edit counter and leaves every review state alone. It and
  `findingsApplied` change the project record, so they are saved
  (`marks.ts:marks`, `operation.ts:changesRecord`).
  `closeStarted` sets `closing`; `closeFailed` clears it
  (`operation.ts:closingAfter`).
- The output is dropped on `opening`, `applyStarted` and `outputDiscarded`
  (`output.ts:output`). The waiting approval ends on `approved`,
  `approvalFailed` and `approvalCancelled` (`approval.ts:approval`).
- A page text is kept only when its `handle` is the one open
  (`viewer.ts:viewer`, `pageTextLoaded`).

## Side Effects

- None. The slices only build new state objects.

## Verification

- Run: `pnpm test`

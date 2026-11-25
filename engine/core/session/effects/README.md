# Session effects

## Overview

The asynchronous work behind the Session's commands: opening a document in the
PDF worker, applying (writing the cleaned file), planning and confirming an
approval, adding documents, reading stored readings, preparing documents again
for this build, and saving the project record. Each effect receives its
dependencies (store, folder, PDF client, the gate's `allowed`, `view`,
`dispatch` and `change`, and for adding, `intake`, which reads the chosen files
and has the PDF worker prepare them) from
[`../facade.ts`](../facade.ts), and reports what happened as `SessionChange`
records that the [slices](../slices/README.md) reduce.

## Interface

- `open.ts`
  - `viewerOf(host)`: builds `Session["viewer"]` with `open`, `render`,
    `pageText` and `images`.
  - `staleHandle`: the `stale-handle` error result, shared with `apply.ts` and
    the facade.
- `apply.ts`
  - `applyOutput(view, client, dispatch)`: writes and checks the open
    document's cleaned file through `PdfClient.apply`, passing a refusal's
    code and data through. A document with a lost mark (`documentStatus`) is
    refused as `mark-lost`, naming its first page, before the worker is asked.
- `plan.ts`
  - `approvalOf(host)`: builds `Session["approval"]` (`plan`, `confirm`,
    `cancel`) plus `settled()`. A plan waits for the heads-up when it changes
    other places, or when the document's removed kinds (`documentStatus`)
    hold one no earlier approval of it listed; otherwise it lands at once.
- `add.ts`
  - `adderOf(host)`: builds `documents.add` plus `settled()`.
- `readings.ts`
  - `ReadingSource`: `store`, `folder`, `failed(document)` (it could not be
    prepared again) and `unavailable()` (a reading is missing or damaged).
  - `documentReadings(source, documents)`: each document's reading (page texts
    and images) from the tag folder; documents whose original is gone, or that
    could not be prepared again, are left out.
  - `imagesOf(source, document)`: a document's placed images.
  - `findPlaces(client, keys, documents)`: every place `PdfClient.match` finds
    each key in each document's text.
- `reprepare.ts`
  - `updaterOf(host)`: `update()` prepares again, one document at a time,
    every document whose tag-folder files are missing or damaged, then saves;
    `settled()`. It is the only code that prepares a document again.
  - `preparedFilesOf(store, folder, document)`: its text, removed kinds and
    working copy from the tag folder, or undefined when one is missing or
    damaged.
  - `anchorDocument(host, document, files, workingChanged)`: dispatches
    `documentPrepared`, and `reanchored` when its marks moved or its working
    copy changed.
- `save.ts`
  - `saver({ store, folder, latest, dispatch })`: returns `flush()` and
    `changed()` for one Session's project record.

## Invariants

- Every command built here first asks the gate through `allowed(...)` and
  returns its refusal unchanged (`viewerOf`, `approvalOf`, `adderOf`).
  `apply.ts:applyOutput` does not call the gate; the facade calls
  `allowed("apply")` before it and passes the allowed view
  (`facade.ts:openSession`, `output.apply`).
- Opens are numbered; an open overtaken by a newer one never dispatches
  `opened`. It returns `staleHandle` when it is overtaken after reading the
  working copy or after `PdfClient.open` answers; a failed read or a worker
  error is returned as is, even when a newer open has started
  (`open.ts:viewerOf`, `latest`, `isLatest`).
- Opening reads the document's working copy, never the user's file. A
  document that could not be prepared again is refused with `prepare-failed`;
  one whose working copy is missing starts the update and returns
  `busy-updating`, or `original-missing` when its original is gone too.
- Each page's text is fetched once per open document and cached as a promise
  (`open.ts:viewerOf`, `texts`, `pageText`).
- `images` returns success with no value when reading the images throws, so
  the images are only not shown as such (`open.ts:viewerOf`, `images`).
- `render` of `"output"` refuses when there is no valid output, and drops a
  page that arrives after the output went out of date (`open.ts:render`,
  `current`, using `selectors.ts:validOutput`).
- The cleaned file is tagged with the document, its edit count and the
  appearance at the time the apply started, so a change made during the write
  leaves the output out of date (`apply.ts:applyOutput`, `OutputTag`). The
  edits written are `document.marks.flatMap(toEdits)`.
- An approval lands only on the project record it was worked out from: `run`
  and `confirm` dispatch `approvalFailed` when the current record differs
  (`plan.ts:approvalOf`). A plan with no changes elsewhere and nothing changed
  in the approved document lands at once without a heads-up (`plan.ts:run`).
- `confirm` and `cancel` act only on the waiting plan whose `planId` matches;
  otherwise they return `no-plan` (`plan.ts:waiting`).
- Adding searches for the project's hidden values before writing any file, so
  no document joins without them spread in; a failed search or write refuses
  every chosen file and adds none (`add.ts:run`, `add-search-failed`,
  `add-save-failed`). Any other failure, such as `intake` rejecting, also
  refuses every chosen file with `add-save-failed` (`add.ts:adderOf`).
- Project saves run one after another, so an older project never lands after
  a newer one; changes made during a save are saved together next, and a failed
  save is retried by the next change or flush (`save.ts:saver`, `writing`,
  `queued`, `unsaved`).
- A reading is never read again from the original here: a missing or damaged
  one starts the update and throws `ReadingUnavailable`, so nothing is
  approved (`readings.ts:readingOf`). A document whose original is gone has no
  reading.
- `findPlaces` throws `ReadingUnavailable` when the PDF worker returns an error
  (`readings.ts`).
- The update re-anchors each document's marks on the text it now has
  (`model/textAnchor.ts:reanchor`). `workingChanged` is true when the working
  copy's SHA-256 or its removed kinds differ from those stored before, and
  always when none was stored, as on the first open under a new tag. A
  document that fails dispatches `preparationFailed` and the rest carry on.
  Once it is done, the open document is opened again when its working copy was
  made again (`facade.ts`, `updated`).

## Side Effects

- Storage reads through `Store` (via `engine/core/stored/projects`):
  `readWorking` and `findOriginal` (`open.ts`), `readTexts`, `readImages` and
  `findOriginal` (`readings.ts`, `reprepare.ts`).
- Storage writes through `Store`: `saveProject` (`save.ts`), `writeOriginals`
  (`add.ts`), and `savePrepared` (`reprepare.ts`), all into the tag folder.
- PDF worker calls through `PdfClient`: `open`, `text`, `render` (`open.ts`),
  `apply` (`apply.ts`), `prepare` (`reprepare.ts`) and `match`
  (`readings.ts:findPlaces`, used by `add.ts` and `plan.ts`).
- Dispatches `SessionChange` records to the engine state, including
  `opening`, `opened`, `pageTextLoaded`, `applyStarted`, `applied`,
  `applyFailed`, `planning`, `planned`, `approved`, `approvalFailed`,
  `approvalCancelled`, `addStarted`, `documentsAdded`, `addFailed`, `saved`,
  `saveFailed`, `updateStarted`, `updateFinished`, `documentPrepared`,
  `preparationFailed` and `reanchored`.
- No network requests are made in this directory.

## Verification

- Run: `pnpm test`

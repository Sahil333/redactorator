# engine/model

## Overview

The engine's shared data model and the pure functions over it. It defines the
types for documents, pages, text, images, marks, projects and settings, the
parsers that turn `unknown` values (worker messages, stored JSON) into those
types, and the rules for selecting text, matching values and spreading hidden
values between a project's documents. The UI and the PDF worker both use these
functions, so a text mark is boxed the same way on screen and in the file
(`pageText.ts` header comment).

The fallow boundary rules in `.fallowrc.json` (`{ "from": "model", "allow": [] }`)
forbid this folder from importing any other engine zone. The only file it reads
from outside `engine/` is the dataset schema,
`dataset/ground-truth.schema.json` (imported by `markTypes.ts` and
`groundTruth.ts`). `tsconfig.json` extends `engine/tsconfig.base.json`, which
compiles with `lib: ["ES2024"]` and no DOM types. The only platform globals
available are the ones declared in `engine/globals.ts`.

## Interface

### Branded primitives and guards

- `brand.ts`: `Brand<T, Name>`, a nominal-typing helper.
- `guards.ts`: `isRecord`, `isPositiveNumber`, `isOffset`, `isText`, and
  `parseAll(values, parse)`. `parseAll` returns `undefined` when the input is
  not an array or when any element fails to parse.
- `geometry.ts`: `PageIndex` (zero-based), `Points` (PDF points in MuPDF page
  space: origin top-left, y grows down, rotation and crop box applied), `Box`,
  `Matrix`, `isPageIndex`, `isPoints`, `isMatrix`, `pointBox`, `parseBox`.

### Document and reading types (`document.ts`)

- `Appearance` (redaction colour as `#rrggbb`, and whether the box carries a `[TYPE]` label).
- `PageModel` and `DocumentModel` (at least one page).
- `PageChar` and `PageText`. A character's index in `PageText.chars` is its offset.
- `PlacedImage` (page, placement `matrix`, `aspect`, 64-bit difference-hash `fingerprint`).
- `Reading` (each page's text plus the images, as stored for a project).
- `Edit` (a text range with the letters it was made on, or a box, with a label).
- `Source` (`"original"`, the document's working copy, or `"output"`).
- `ReaderTag` (a format's name and a number, like `pdf-3`), `isReaderTag` and
  `readerTag`.
- `RemovalKind` and `removalKinds`: what preparing a document removed, by
  kind, never what or how much.
- `Pixels` (RGBA bytes).

### Error codes (`errors.ts`)

- `ReaderErrorCode`: `open-failed`, `encrypted`, `text-failed`, `render-failed`,
  `unsupported-form`, `prepare-failed`.
- `WriterErrorCode`: `apply-failed`, `check-failed`, `mark-lost`,
  `extra-text-removed`, `text-moved`, `partly-covered-drawing`.
- `DetectionErrorCode`: `detector-not-started`, `recognizer-failed`,
  `detector-failed`, why a run of Auto mode ended as failed.

### Auto mode (`findings.ts`, `detection.ts`, `identifiers.ts`, `resolver.ts`)

The contracts of docs/designs/auto-mode.md, Technical Plan, section 3, and the
resolver.

- `findings.ts`: `EvidenceKind`, `EvidenceLevel`, `Evidence`, `Hit`,
  `FindingPlace`, `Candidate`, `Finding`, and `FindingChange`, what the user
  changed in an open findings review.
- `detection.ts`: `Country` and `countries`, `Industry` and `industries`,
  `PackId`, `packOrder` (which breaks a tie between two identifiers with equal
  evidence), `packNames`, `Profile`, `profilePacks(profile)` (the packs a run
  loads, `universal` always first), and `RunRecord`.
- `identifiers.ts`: `identifierPacks`, each of the 65 identifier type ids and
  its pack.
- `resolver.ts`: `resolve({ hits, marks, rejected, changes })`, the findings
  of one ended run, in the six steps of the design. A hit is left out where a
  text mark of its own key overlaps it, and when its key is rejected. Hits on
  one span are one finding's candidates, one per identifier, the default
  first: the stronger evidence, then the pack order, then the order of the
  hits (the order of the rules). Places that share a key are one finding. The
  user's changes apply by key; findings whose values became one are joined,
  and a place where the value as changed is marked is left out. Strongest
  evidence first, then by first place. It reads no page text. The caller
  passes the marks without the lost ones.

### Parsers (`parse.ts`)

- `parseEdit`, `parseAppearance`, `parseDocumentModel`, `parsePageText`,
  `parsePlacedImage`, `parseReading`, `parseRemovalKind`, `isFingerprint`. Each returns the typed
  value, or `undefined` when the input does not fit.

### Page text helpers (`pageText.ts`)

- `bounds`, `sharesColumns`, `readingOrder`, `rangeBoxes`, `rangeText`,
  `contains`, `charAt`, `wordAt`.

### Selection (`selection.ts`)

- `Position`, `Selection`, `Texts`, `Run`, `TextPieceRange`.
- `sorted`, `pageText`, `shown`, `lines`.
- `selectionPieces(texts, first, last)` returns a range per page, or `"page-text-missing"`.
  Line and block ends are trimmed from either side of each range.
- `textTarget(texts, pieces)` returns a `TextTarget`, `"page-text-missing"` or `"empty-target"`.
  Each piece gets its letters, read with `rangeText`; `TextPieceRange` has
  neither boxes nor letters, so the app never supplies them.

### Keeping marks on their letters (`textAnchor.ts`)

- A text piece's letters and boxes are its identity; its offsets only point at
  them in the text as this build reads it.
- `lostPieces(target, texts)`: the pieces whose `rangeText` at their offsets is
  not their letters, or that have none.
- `reanchor(target, texts)`: each lost piece placed again, or `"lost"`. Among
  the characters whose centres fall inside the piece's boxes, from the first to
  the last, the one range that reads as its letters is its new offsets; with
  none, or more than one, the mark is lost. There is no tolerance constant.
- `migratePieces(target, oldTexts)`: fills the letters of pieces stored before
  pieces kept them: a one-piece mark's are the mark's text, the others' are
  read at their offsets in the older build's text, or left empty, so lost.

### Marks and mark types

- `markTypes.ts`: `MarkType`, `MarkTypeOption`, `builtInMarkTypes` (read from
  the schema's `$defs.generalType.oneOf`, then `$defs.identifierType.oneOf`),
  `generalTypeIds`, `customMarkType`, `customTypeName`, `markTypeLabel`.
- `marks.ts`: `TextPiece` (with `text`, its letters), `MarkTarget`, `TextTarget`, `Mark`, `nextId`,
  `markKey`, `itemKey`, `markPages`, `boxesOn`, `firstPage`, `markName`,
  `toEdits`.

### Value matching (`match.ts`)

- `keyOf(value)` gives a value's normalised key. Case is folded, NFKC is
  applied, spacing is collapsed, joiners between the digit groups of a number
  are dropped, and punctuation is trimmed from both ends.
- `Found` and `findAll(pages, keys)`.

### Images (`images.ts`)

- `ImageAnchor`, `anchorOf`, `placesOnCopies`, `imageKey`, `fingerprintOf`,
  `MIN_IMAGE_SIDE`, `GRID_COLUMNS`, `GRID_ROWS`.

### Projects (`project.ts`)

- `DocumentId`, `isDocumentId`, `newDocumentId`.
- `reviewStates` / `ReviewState` and `downloadStates` / `DownloadState`.
- `ProjectDocument`, `HiddenValue`, `Project`, `Settings`, `defaultSettings`.
  A project's optional `profile` is what Auto mode looks for; a document's
  `rejected` holds the keys of values Auto mode does not offer again there.

### Spreading hidden values (`spread.ts`)

- `Reach`, `reachOf`, `newFrom`.
- `TextPlace`, `Change`, `changed`.
- `hiddenTextKeys`, `keysToFind`.
- `Approval`, `approve(project, id, readings, textPlaces, removed)`.
- `spreadToAdded(project, added, readings, textPlaces)`.

### Ground truth (`groundTruth.ts`)

- `DocumentFacts`, `countries`, `formats`, `splits`.
- `groundTruth(marks, facts, sha256)` and the `GroundTruth` type.

## Invariants

- The parsers never throw on bad input. Each returns `undefined` instead.
  `parseAll` fails the whole list when one element fails (`guards.ts:parseAll`).
- `parseBox` rejects non-finite coordinates and any box with `x0 > x1` or
  `y0 > y1` (`geometry.ts:parseBox`). `pointBox` returns `undefined` when a
  coordinate is not finite.
- A `PageChar` whose `c` is `"\n"` marks the end of a line or block and has
  `box: undefined`. Every other character has a box. `parse.ts:parsePageChar`
  enforces both rules.
- `parseEdit` accepts a text edit only when `start < end`, with both offsets
  non-negative integers (`parse.ts:parseEdit`).
- `parsePlacedImage` requires a fingerprint of exactly 16 lowercase hex digits
  (`parse.ts:isFingerprint`).
- `markKey` is `undefined` in two cases: a box that is not anchored to an image,
  and text whose `keyOf` is empty. `itemKey` falls back to `mark:<id>`
  (`marks.ts:markKey`, `marks.ts:itemKey`).
- Text keys are lower-cased, so they never collide with image keys, which start
  with `"Image "` (`images.ts:imageKey`).
- `findAll` reports a match only on word boundaries, so "Roe" never matches
  inside "Monroe". Each page is searched separately, so a match never crosses
  pages. A line end keeps the digits on either side apart
  (`match.ts:findAll`, `match.ts:joinerUnits`).
- A box is anchored to an image only when at least half of the box's area lies
  on that image (`images.ts:anchorOf`). An image counts as a copy of the anchor's
  image when two conditions hold (`images.ts:isCopy`):
  - the fingerprints differ in at most `MAX_DIFFERING_BITS` (10) bits;
  - the aspect ratios differ by at most a factor of `MAX_ASPECT_RATIO` (1.1).
- `fingerprintOf` returns `undefined` when an image's 9 × 8 grey grid has a
  contrast below `MIN_IMAGE_CONTRAST` (12), so such an image is not listed
  (`images.ts:fingerprintOf`).
- Nothing spreads until a document is approved (`spread.ts` header). `approve`
  has these effects (`spread.ts:approve`):
  - The approved document becomes `review: "approved"`, and its marks are cleared of `isNew`.
  - Every other document that the approval changes goes back to `review: "in-review"`, and its added or retyped marks have `isNew: true`.
  - A document whose `download` was `"downloaded"` becomes `"changed"` if the approval changes it.
  - Before anything spreads, each box mark of the approved document that is not
    anchored yet is anchored to the image it lies mostly on (`spread.ts:anchored`).
  - A hidden value stops being hidden when the approved document had it but no
    longer marks it and does not keep it visible. "Had it" means the value is
    found in the document's text, or the value came from this document. The
    value leaves `project.hidden`, its marks are dropped from every document, and
    each dropped mark counts in `Change.shown` (`spread.ts:approve`,
    `spread.ts:keptMarks`).
  - The approved document's `removedSeen` becomes the `removed` kinds it was
    given, and `Approval.removed` holds those not in its `removedSeen` before,
    which the approval dialog lists.
  - `approve` returns `undefined` for an unknown document id.
- When a selection runs over a page edge, `selectionPieces` leaves out running
  headers and footers. A running block repeats on a neighbouring page within
  `RUNNING_PLACE` (3) pt and reads the same there, ignoring digits. A running
  block that holds an end of the selection is kept. A page left with nothing
  gets no range (`selection.ts:runningBlocks`, `selection.ts:pieceRange`).
- Spreading skips a place that an existing mark already covers: text by its
  range, boxes within `BOX_TOLERANCE` (0.5 pt). It also skips values that a
  document keeps visible through `shown` (`spread.ts:placeMark`,
  `spread.ts:spreadInto`).
- `spreadToAdded` sets an added document to `"in-review"` when it has any marks,
  and to `"not-started"` otherwise (`spread.ts:spreadToAdded`).
- `groundTruth` always writes `schema_version: 1`, `box_unit: "pt"` and an empty
  `hidden_occurrences`. Its `countries`, `formats` and `splits` options come
  from the schema itself, so a file the app writes passes the schema
  (`groundTruth.ts`). Text marks that share type, text and link id share one
  entity, and each box mark is its own entity (`groundTruth.ts:groundTruth`).
- The docstring of `markName` says the marked text it returns is shown only in
  the marks list and never sent anywhere (`marks.ts:markName`).

## Side Effects

- `project.ts:newDocumentId` calls `crypto.randomUUID()`. It throws `"No id"` if
  the result is not a valid `DocumentId`.
- Every other export is a pure function or a type. Nothing in this folder does
  I/O, makes network requests, or holds state between calls.

## Verification

- Run: `pnpm test`. It includes `tsc -p engine/model` and
  `pnpm exec fallow architecture --boundaries`. The unit tests that sit beside
  this folder are `images.test.ts`, `match.test.ts` and `spread.test.ts`.

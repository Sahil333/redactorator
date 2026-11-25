# engine/pdf/prepare

## Overview

Preparation makes a document's **working copy** from the file the user picked,
once, when the file is added and again only when the reader tag changes
(docs/designs/pdf-leak-suite.md, part 1). The app shows, reads, marks and
writes from the working copy; the user's file is never changed. The working
copy keeps what a reader sees on screen or in print, and nothing else.

## Interface

- `index.ts`: `prepareDocument(bytes)` returns `{ preparedBytes, reading,
  removed }` or `{ code, message? }`. `removed` lists the kinds removed
  (`RemovalKind`), sorted, with no repeats, never what or how much. It runs
  the nine steps:
  1. open and refuse: an encrypted file that needs a password, one with no
     pages, and a form only XFA draws, with no widget on any page
     (`unsupported-form`; a hybrid form is flattened); record `old-revisions`;
  2. to 4. `annotations.ts`: `flattenAnnotations(document, removed)`;
  5. and 6. `page.ts`: `cleanContent(document, removed)` and
     `removeOutside(document, removed)`;
  7. `../allowlist.ts:stripToAllowlist`;
  8. the save with `garbage=4,compress,encrypt=none`;
  9. `check.ts`: `preparedWell(original, working)`.
- `layers.ts`: `layersOf(document)`, whether optional content is off in the
  default configuration, by ISO 32000-2 8.11.2: an OCG by `/OFF`, `/ON` and
  `/BaseState`, an OCMD by its `/P` rule. A `/VE` expression throws.
- `reopen.ts`: `reopen(document, options)` saves, frees and opens the result;
  `open(bytes)` opens bytes as a PDF.

## Invariants

- **Any failure refuses.** Any exception, an unplaced object in the
  allowlist, or a failed step 9 returns `prepare-failed`. Nothing is kept in
  part.
- **Hidden annotations go before flattening.** Step 2 deletes annotations and
  widgets with the Hidden flag, with NoView and not Print, or on a layer that
  is off, and every Redact and Popup annotation, since flattening would show
  them. MuPDF lists no link among a page's annotations: links stay until step
  7 deletes the page's `Annots`, and step 2 records `links` from the page's
  own `Annots`.
- **Flattening is checked.** MuPDF's `bake` hides its own failures, so after
  step 4 a page with any annotation or widget left refuses the document.
- **Saved bytes are copied.** `saveToBuffer(...).asUint8Array()` is a view
  into MuPDF's memory, which moves as it grows, so every save is copied
  (`.slice()`) before it is opened again.
- **Step 8 saves the document step 7 resolved.** Stock MuPDF 1.28.6's garbage
  collection writes a stream as a bare dictionary, without its data, when its
  dictionary holds a reference and anything else holds that dictionary;
  MuPDF.js keeps every `PDFObject` it resolves for good, and step 7 resolves
  every object. Patch 0005 fixes it (`vendor/mupdf/README.md`), so step 8
  saves without reopening first. Its `compress` compresses the streams step 7
  wrote again from their decoded bytes, which MuPDF holds until that save.
- **Kinds the filter removes are found before it runs.** One device pass in
  `page.ts:contentKinds` records `hidden-layers` (a layer that is off is used,
  by `beginLayer`, or named in `/OC` by a resource), `marked-content` (the
  resources hold properties other than layers, or a content stream the filter
  rewrites names `/ActualText`, `/Alt` or `/E`: the page's own, a form's, a
  tiling pattern's, a soft mask's group or a Type 3 glyph's, read as the PDF
  lexer reads names, `#xx` escapes and NUL included) and `unshown-image-pixels`
  (an image drawn while a clip is in force, or reaching past the page).
- **Step 6 keeps what crosses the edge.** Its four areas run from the visible
  page's edges outwards and never overlap it, so text and drawing parts wholly
  outside go, and those that cross the edge stay.
- **Step 9 compares drawn letters.** Every letter the original shows inside
  its visible page must be in the working copy at the same place, read with
  `READING_OPTIONS`; letters flattening added are not compared. Then
  `checkStructure` runs.
- **Boundaries** (`.fallowrc.json`): zone `pdf-prepare` may import `model`
  and `pdf` only, so it answers with model codes (`ReaderErrorCode`).

## Side Effects

- Allocates MuPDF (WebAssembly) memory, freed before `prepareDocument`
  returns. No network, storage or DOM access.

## Verification

- `tests/e2e/leak-suite.spec.ts` adds each leak vector's fixture and has the
  outside checker judge the working copy it stores, or the export of its
  mark. `pnpm test` runs it.

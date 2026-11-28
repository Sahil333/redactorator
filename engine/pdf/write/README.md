# engine/pdf/write

## Overview

The PDF write path. It turns the user's edits into MuPDF redactions on a fresh
copy of the document's working copy, which preparation made from the user's
file ([../prepare/README.md](../prepare/README.md)), deletes the text, image pixels and wholly
covered vector paths under each mark, draws the boxes (and optional labels),
strips metadata, saves the file as a single revision without encryption, then
re-opens the result and checks it (the gate). When it refuses the file it
throws `WriteRefused`, with a code and where it applies, never document text.
Other errors propagate as plain errors. Either way no output is returned.

The only caller is `engine/pdf/apply.ts` (see [../README.md](../README.md)). A document with
no edits never reaches this folder: `apply.ts` checks the working copy's
structure and posts it unchanged.

## Interface

Public entry (`index.ts`):

- `writeAndCheck(original: mupdf.PDFDocument, bytes: Uint8Array, edits: readonly Edit[], appearance: Appearance): { bytes: Uint8Array<ArrayBuffer>; output: mupdf.PDFDocument }`
  writes the cleaned file and checks it. On success the caller owns `output`
  and must `destroy()` it. `original` is the open working copy, `bytes` its
  bytes.
- `WriteRefused` (class, extends `Error`, from `common.ts`): `code`, a
  `WriterErrorCode` (`engine/model/errors.ts`), and `data?: { page?: PageIndex; boxes?: readonly Box[] }`
  (`RefusalData`). The app words each code (`app/errors.ts`).
- `openPdf(bytes)`, re-exported from `common.ts`: opens `bytes.slice(0)` as a
  `PDFDocument`, or throws `WriteRefused("apply-failed")` when they don't open
  as one. It opens the written output, the input bytes (`redact.ts:redact`)
  and, in `apply.ts`, the copy of a working copy downloaded unchanged.

Used inside the folder:

- `common.ts`: `Redaction { box, textArea, printed }`.
- `redact.ts`: `redactionsByPage(original, edits): Map<PageIndex, Redaction[]>`,
  `redact(bytes, byPage, appearance): Uint8Array<ArrayBuffer>`.
- `check.ts`: `check(original, output, byPage, appearance): void` (RED-3).
  It reads glyphs with `../glyphs.ts:glyphsOf` and `READING_OPTIONS`.

`Edit` and `Appearance` come from `engine/model/document.ts`. `Box` and
`PageIndex` come from `engine/model/geometry.ts`.

## Invariants

- **Delete, then cover.** For each page, `redact.ts:redact` first applies
  Redact annotations over each `textArea` with `REDACT_TEXT_REMOVE`. It then
  applies them over each `box` with `REDACT_IMAGE_PIXELS` and
  `REDACT_LINE_ART_REMOVE_IF_COVERED`, deletes the empty `/Annots` array the
  applied annotations leave, and only then `drawBoxes` paints the filled boxes.
- **Line art is removed only when wholly covered, and a partial cover is
  refused.** MuPDF removes each part of a path (each move step) whose bounds
  a box contains. Its bounds for a stroke include the miter allowance, up to
  the miter limit times half the line width, so a box must reach that far past
  a stroked line to cover it. The gate refuses with `partly-covered-drawing` a
  part a box overlaps unless it is a single axis-aligned rectangle (move, three
  lines, close) or a single straight line (move, line), and any part still
  wholly under a box other than our own boxes (`check.ts:partlyCoveredDrawing`).
- **Text area is the ink, not the font box.** A text edit's `textArea` is the
  letters' ink band from `readText(...).ink`, so that removal does not reach
  into closely set neighbouring lines (`common.ts:Redaction.textArea`,
  `redact.ts:textAreas`).
- **A text mark's box stops at the next line's letters.** Its box starts as the
  letters' full font height, which on lines set closer than that reaches the
  letters of the line above or below. Before writing, each such box is trimmed
  clear of the letters no mark removes (read with `READING_OPTIONS`), never
  into its own `textArea`, so it hides nothing the file keeps
  (`redact.ts:trimmed`; `tight-lines.pdf`).
- **The guard: marks must match the text.** If a text edit runs past the
  page's characters, its letters there (`rangeText`) are not its `text`, it
  covers no line boxes, or its line boxes and ink bands differ in count,
  `textAreas` throws `WriteRefused("mark-lost", { page })`. If an edit names a
  page past `countPages()`, `redactionsByPage` throws a plain `Error`. In both
  cases the write stops.
- **Every write starts from the bytes given.** `openPdf` opens
  `bytes.slice(0)`, and `redact` works on its own document, which it destroys
  in `finally`. The `original` document is only read
  (`redactionsByPage`, `check`).
- **Labels are sanitised.** `printed` is `[` + the label in upper case + `]`,
  with each character outside WinAnsi (Latin-1 printable) replaced by `?`
  (`redact.ts:inWinAnsi`). The label is written as a PDF hex string
  (`pdfString`) in Helvetica/WinAnsiEncoding under the resource name
  `/RedactLabel`. The font is added only when `appearance.label` is on.
- **How boxes and labels are drawn.** `drawBoxes` fills each box with
  `appearance.colour`. The label ink is black when the fill's luminance is
  above 140, white otherwise. The label's font size is the smaller of
  0.7 × box height and the size at which its Helvetica AFM widths
  (`redact.ts:HELVETICA_WIDTHS`, 600 for other characters) fill 0.9 × box
  width; it is centred in the box (`redact.ts:typePlace`).
- **Marks may overlap, and a label is never printed under another box.** A
  redaction whose label's letters would lie under another redaction's box
  prints none: its `printed` is empty (`redact.ts:typesInTheClear`). The
  letters are taken as the label's width, from 0.74 × its font size above the
  baseline to 0.2 × below it, the reach of Helvetica's brackets. The check
  reads a printed letter at the centre of its font box, which MuPDF puts
  0.39 × the font size above the baseline, inside that reach. So nested marks
  both print nothing, a wide box whose middle is clear still prints, and
  boxes that only touch, or overlap along an edge as closely set lines do,
  print as before. Every box is still drawn, and everything under it removed
  (`tests/e2e/overlapping-marks.spec.ts`).
- **Existing page content is isolated.** `drawBoxes` wraps the page's existing
  `Contents` in `q`/`Q`, so a graphics state it leaves set cannot move the
  boxes. The boxes are drawn through the inverse of the page transform.
- **Metadata removed.** `redact` deletes the trailer `Info`, `Root/Metadata`,
  and every page's `Metadata`. It saves with
  `"garbage=4,compress,encrypt=none"`: a full rewrite, one revision, objects
  nothing refers to are dropped, and there is no encryption. Patch 0005 keeps
  a stream's data through that save even when its dictionary is held
  elsewhere (`vendor/mupdf/README.md`).
- **Checks before return (fail closed).** `check.ts:check` throws
  `WriteRefused` in any of these cases, in this order:
  - `check-failed`: the output fails the shared structural check
    (`../structure.ts:checkStructure`: one unencrypted revision, no
    annotations, no form, no key outside the allowlist);
  - on each redacted page, comparing the working copy's letters with the
    output's (`../glyphs.ts`):
    - `extra-text-removed`, with the boxes of the letters: a non-whitespace
      letter no `textArea` touches is gone from its baseline
      (`missingGlyphs`). A letter counts as touched when a `textArea`
      overlaps its `body` or contains its centre;
    - `text-moved`: such a letter is only elsewhere on its baseline
      (`movedGlyphs`);
  - `check-failed`, with the page: a non-whitespace glyph overlaps a box with
    its `body` and its centre is not inside any box, or the glyphs centred in
    a box, without whitespace, differ from its label (or from nothing when
    labels are off or the box prints none) (`textUnderBoxes`); or an image or image mask under a box
    is not one uniform value across the pixels the box overlaps
    (`imagesUnderBoxes`, `blankUnder`). The `body` runs only from the
    baseline up to 0.7 × font size (`geometry.ts:bodyOf`);
  - `partly-covered-drawing`, with the page and the box: the drawing rule
    above.

  An error raised while judging an image or a path inside MuPDF's device
  counts as a failure (`check-failed`).
- **Which errors are `WriteRefused`.** Any other throw propagates as a plain
  `Error`: from `withPage`, `glyphsOf` or `page.run`, or "A box is not a
  finite size" from `geometry.ts:around`, and from MuPDF during `redact`.
  `apply.ts` reports these as `apply-failed`. Both stop the write.
- **Scope of the check.** `check` judges letters, images and drawings only on
  pages present in `byPage`; the structural check covers the whole file.
- **The output is destroyed on failure.** `writeAndCheck` destroys `output` if
  `check` throws, then re-throws.
- **Boundary.** `.fallowrc.json` zone `pdf-write` may import only `model` and
  `pdf`. Within `engine/pdf`, only `apply.ts` (zone `pdf-apply`) may import this
  folder.
- Any change to how this code writes output needs a leak fixture judged by the
  outside checker in `tests/oracle/` (AGENTS.md).

## Side Effects

- Allocates MuPDF (WebAssembly) documents, pages, pixmaps, structured text
  and devices, and frees each one in `finally`. The exception is the `output`
  returned on success. The `PDFAnnotation`s from
  `page.createAnnotation("Redact")` and the `PDFObject`s created or fetched in
  `drawBoxes`, `redact` and `check` are never destroyed explicitly.
- Mutates only the private copy opened in `redact`. It adds Redact
  annotations, the content streams, the `/RedactLabel` font and, if missing,
  `Resources`/`Font` dictionaries, and deletes the empty `/Annots`.
- No network, storage or DOM access.

## Verification

- Run: `pnpm test` (this includes `tsc -p engine/pdf`, the
  `fallow architecture --boundaries` check, and the Python oracle in
  `tests/oracle/`). The refusals are judged in `tests/e2e/preview.spec.ts`.

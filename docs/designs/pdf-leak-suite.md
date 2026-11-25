# Phase 3: the PDF leak suite

*   **Author:** Sahil Chaddha
*   **Status:** Proposed (revised after review and re-audit, 2026-11-25)
*   **Date:** 2026-11-25

--------------------------------------------------------------------------------

## Overview

Redactorator removes personal data from documents in the browser, and nothing
a user loads leaves the browser. Today a cleaned PDF has:
- the marked text deleted;
- image pixels under each box blanked;
- the document's top-level metadata removed;
- every other part of the file copied through unchanged.

Phase 3 of the [Implementation Plan](../Implementation-Plan.md) changes what
an export keeps. It keeps the page content a reader sees on screen or in
print, and removes every other part of the file. From what it keeps, it
removes what the user marked. Two kinds of unmarked hidden text are known to
stay, and the design says so:
- invisible OCR text over a scanned picture (left to the OCR phase, #6);
- text that is drawn but not seen, such as white on white, covered or clipped
  text (#34).

When the app cannot clean a file, it refuses that file with a reason the user
can act on, and the other files in the project can still be exported.

The phase also makes marks stable: **a mark never removes the wrong text**,
however a later version of the app reads the page.

Each case is checked on a list of the ways a PDF can leak, built from the PDF
specification, with a synthetic test file for each. An outside checker that
shares no code with the app judges every one.

## Terms

- **Spreading:** when a user marks a value, the app finds the same value
  elsewhere in the document and in the project's other documents, and marks
  it there too.
- **Carrier:** any part of a PDF that can hold text or data. Examples are page
  content, form fields, annotations, bookmarks, metadata, attachments and
  layers.
- **Working copy:** the cleaned-for-marking copy of a document that
  preparation makes from the original (part 1). The original is never
  changed.
- **Reader tag:** one string, such as `pdf-3`. It names the exact way this
  build prepares and reads PDFs, including the MuPDF build. A different tag
  means the working copy and page text must be rebuilt.
- **Gate:** the in-app check (`engine/pdf/write/check.ts` and the
  preparation check). It runs MuPDF only, refuses a bad output, and checks the
  writer's own promises. It is not a second verifier.
- **Guard:** the gate's check that a text mark's stored letters are still at
  its offsets.
- **Lost mark:** a text mark whose stored letters are no longer at its
  offsets, and that re-anchoring could not place. The user marks it again.
- **Ink band:** the part of a letter's height that has ink, used as the area
  text redaction removes. It is narrower than the font's full height.
- **`Edit`:** what the core sends the worker for each mark: a page and offsets
  for text, or a page and box.
- **`TextPiece`:** the part of a text mark on one page: its offsets, its boxes
  (one per line) and, from Phase 3, its text.
- **Fallow zone:** a folder the repo's boundary tool (`fallow architecture
  --boundaries`, configured in `.fallowrc.json`) treats as a unit with
  allowed imports.
- **Outside checker (the "oracle"):** `tests/oracle/`, the Python program that
  judges exported files in tests. It shares no code with the app or MuPDF.

## The Problem

A PDF carries much more than what a reader shows on the page. Any of these can
hold the name or number the user just marked:
- metadata on the document, on pages and on images;
- form fields with their names, tooltips and default values;
- comments and their authors;
- bookmarks and links;
- attachments and scripts;
- accessibility tags and alternative text;
- digital signatures with the signer's certificate;
- layers that are switched off, and text placed off the page;
- photos that carry camera data, or image parts cropped out of view;
- earlier versions of the file.

Today all of these pass through to the output. A user who marks "Jane Roe" on
the page can send a file that still names Jane Roe in a form field, a comment
author, a bookmark or a hidden layer. The black box makes it look clean, and
nothing tells them otherwise.

The early users are CPAs and other professionals who send cleaned copies to
someone else. Their files are the hard cases:
- fillable tax forms;
- bank and payroll statements;
- signed returns and engagement letters;
- scans with an OCR text layer.

They need two promises:
- what they send holds no personal data they did not choose to leave in, apart
  from the known exceptions named in the Overview;
- when a file cannot be cleaned, the app says why, and sends nothing for that
  file.

There are three smaller problems behind this:
- **Marks can drift.** A text mark is stored as character positions in the
  page's text. If a later version of the app reads text differently, those
  positions point at other letters: the app removes the wrong text and keeps
  the value. Nothing detects this today.
- **Some partial covers leak.** A box that only partly covers part of a
  vector drawing, such as a signature drawn as one long stroke, leaves that
  stroke whole in the file under the box.
- **Refusals don't help the user.** The current messages can mislead. One
  says text "would move" when it would in fact be removed. Every refusal says
  "apply again", which cannot help when the check refuses.

## Goals

*   **Keep what a reader sees, remove the rest.** Every exported PDF keeps
    only what is needed to draw its pages on screen or in print, on every
    page, including documents with no marks. Removed kinds (Appendix A has the
    full list):
    - metadata on the document, pages, images and other objects;
    - image camera data (EXIF, XMP, thumbnails inside the image);
    - thumbnails, scripts and actions, attachments;
    - bookmarks, links, named destinations, page labels;
    - accessibility tags, ActualText and alternative text;
    - comment text and authors, form-field names, tooltips and defaults;
    - signature data and certificates;
    - hidden annotations and widgets, and pending redactions from other tools;
    - content on layers that are off, and content outside the page;
    - private application data, and earlier revisions.
*   **From what is kept, remove only what was marked.**
    - Visible form values, visible annotations (including screen-only and
      print-only ones) and signature stamps are made part of the page first.
      Every value stays visible, and only marked values are removed.
    - Invisible OCR text over a page picture is kept, with marked values
      removed.
*   **Blank image parts that are not shown:** pixels outside the page, or
    hidden by a clip, the same way pixels under a box are blanked.
*   **Show what was removed.** Before the user approves a document, the
    approval dialog lists the kinds of content removed from it, each kind
    once per document. It shows kinds only, never values or counts.
*   **Refuse with a reason, one document at a time.** The refusal table in
    part 6 lists every refusal with its sentence and what the user can do. The
    main ones are:
    - a form drawn only by XFA, refused when the file is added (a hybrid
      form, XFA beside normal fields, is flattened like any other);
    - a box that only partly covers a part of a drawing that is not a single
      rectangle or straight line, with a message asking the user to cover it
      fully;
    - redacting a mark that would also remove unmarked letters next to it.
      The extra letters are highlighted on the page, and the message holds no
      document text;
    - a lost mark.

    A refusal never stops the other documents in a project.
*   **A mark never removes the wrong text.** A mark's stored text and boxes
    are its identity, and its character positions are worked out again when
    the app reads text differently. A mark that cannot be placed is lost, and
    its document is refused until the user marks it again. This is tested by
    unit tests, and by browser tests on storage written by an older build.
*   **Check every listed case.** The leak-vector list is built by walking the
    PDF specification's object types, and its end is defined (part 9). Every
    entry has:
    - a synthetic fixture;
    - a browser test;
    - an outside-checker check that fails on the uncleaned fixture.

    A meta-test fails when an entry is missing any of these.
*   **A checker that can judge every case.** The outside checker:
    - decodes every standard stream filter and string encoding;
    - checks the file's structure;
    - finds drawings under boxes;
    - checks letters by position where text has no Unicode map;
    - renders pages with pypdfium2, which shares no code with MuPDF.
*   **Stay small.**
    - The app keeps one PDF engine, MuPDF. Its gate checks the writer's own
      promises and is not a second verifier.
    - PDF-specific work stays in `engine/pdf/`, and `engine/model/` stays
      format-neutral for later formats.
    - Stored files are only ever added, never replaced, so an older build
      still opens the project as it last saw it.

## Non-Goals

*   **Keeping working features in the output:** fillable forms, links,
    bookmarks, attachments, accessibility tags and a valid digital signature.
    A cleaned copy is made to be read and printed, not edited.
*   **Cutting a vector drawing at the box edge.** MuPDF already removes each
    part of a drawing that lies wholly under a box. A partly covered part that
    is a single rectangle or straight line stays. Any other partly covered
    part is refused.
*   **A second PDF reader in the app** (PDF.js or other).
*   **The per-export certificate** (PRD RED-4), moved to v1.
*   **Finding text that is drawn but not seen:** white on white, covered by a
    shape or image, or clipped away. It stays as page text with marked values
    removed. Tracked in
    [Sahil333/redactorator#34](https://github.com/Sahil333/redactorator/issues/34).
*   **OCR text layers whose boxes don't match the page picture.** The owner
    left this to the OCR phase on 25 Nov 2026. It is listed under Risks.
    Tracked in
    [Sahil333/redactorator#6](https://github.com/Sahil333/redactorator/issues/6).
*   **Keeping print-only behaviour.** Print-only annotations are made part of
    the page, so they also show on screen.
*   **User settings for what to keep.** The app makes these decisions, and the
    approval dialog only reports them.
*   **Searching removed parts of the file for marked values at run time.**
    They are removed, so there is nothing to search.
*   **Re-checking files exported before Phase 3.**
*   **Rewriting the file ID, or re-subsetting fonts.** A font may still hold
    the shapes of letters it no longer draws.
*   **Batch export.** Downloads stay one document at a time.

## What preparation promises

The boundary of what preparation cleans (owner, 25 Nov 2026).

*   **Removed:**
    - every key in the object graph outside the allowlist (Appendix A.1);
    - content that is hidden or outside the page: off layers, outside the
      crop box, unshown image pixels;
    - annotations and forms, flattened where they are visible, and deleted
      otherwise;
    - metadata inside JPEG and JPEG 2000 data (Appendix A.2);
    - marked-content properties in content streams (ActualText, alternative
      and expansion text).
*   **Kept as they are, by decision:** the bodies of fonts, colour profiles
    (ICC profiles, their description and copyright strings included), CMaps
    and the data of other image codecs. Software makes them, and drawing
    needs them; that a font subset shows which characters were used is
    already accepted (Non-Goals). This covers:
    - text inside an ICC profile (`desc`, `cprt`), comments in Type 4
      functions and CMaps, and ToUnicode entries for codes no page uses;
    - JBIG2 extension segments, the bodies of the JPEG segments that draw an
      image (DNL, DHP, EXP), the J2K header markers other than COM, and the
      bodies of JP2's `ftyp` and `colr` boxes;
    - names a font or CMap carries, such as `FontName`, `BaseFont`,
      `FontFamily`, `CharSet`, `Panose`, `CMapName`, `Registry` and
      `Ordering`, where they are kept keys of the object graph;
    - the other free text kept keys can hold (owner, 25 Nov 2026; slice 5
      answer 2): the names content uses for its fonts, graphics states,
      colour spaces, patterns and shadings; glyph names in an encoding's
      `Differences` and a Type 3 font's `CharProcs`; colorant names in
      `Separation` and `DeviceN` colour spaces, a `DeviceN`'s `Colorants`
      and a type 5 halftone; an image's `Intent`; an `Indexed` palette;
      transfer, black-generation, undercolour-removal and halftone functions
      given as names; and the first string of the file's `ID`.

    Each free-text kept key has a leak entry expecting `"kept"`, whose test
    shows the value is still in the working copy (part 9). Step 5's filter
    names an image XObject anew, so that resource name is not kept.
*   **Refused:** what preparation can't decode or place safely, as Appendix
    A.1 and A.2 and the refusal table in part 6 list.

A finding about data inside a kept body is out of scope unless it shows
data the user wrote reaching that body.

## Probe Findings

Probes ran on 25 Nov 2026 against the vendored MuPDF.js 1.28.6. They used
synthetic PDFs, built in the session scratchpad, that hold every case below.
No real document was used. The probe scripts become the first fixtures
(Detailed item 29).

*   **Today the app cannot select form values or annotation text.** MuPDF's
    text extraction (`toStructuredText`) reads only the page's own content. A
    filled field's value ("Jane Roe") and a typed note show on the page, but
    they are not in the app's text, so they can't be marked or spread. A user
    can only cover them with a drawn box.
*   **Flattening (`bake`) works, with two problems.**
    - **What it does:** it copies each annotation's and widget's look into the
      page content and removes the form (`/AcroForm`). After a save with
      garbage collection, these are gone: field names, tooltips, default
      values, hidden widgets, comment pop-up text and comment authors. A field
      with no stored look ("reader draws it") is given one and flattened. Text
      already on the page keeps its exact position. Flattened text joins the
      page text after the page's own text.
    - **Problem 1, it reveals hidden content.** An annotation on a layer that
      is switched off is flattened into always-visible content. Hidden
      annotations must therefore be deleted *before* flattening.
    - **Problem 2, stale page objects.** After flattening, the page objects
      already open still list the old annotations. The document has to be
      saved and opened again before redaction runs.
    - **A signed signature widget keeps its stamp** (patch spike, below).
*   **Text extraction replaces letters with ActualText.** If a passage is
    tagged "this reads as X", the app's text today is X, not the letters drawn
    on the page. The option `ignore-actualtext` reads the drawn letters.
    Phase 3 removes ActualText, so the reading uses that option.
*   **Text outside the crop box is skipped by default.** With
    `mediabox-clip=no`, extraction also returns text off the page, or in the
    gap between the crop box and the media box. MuPDF 1.28.6 warns that
    `mediabox-clip` is deprecated; `clip=no` sets the same flag.
*   **Layers.** MuPDF reports each layer and whether it is on. Text extraction
    skips layers that are off. A device sees where a layer begins and ends, but
    not what is inside. Switching a layer on in memory is not saved into the
    file. Redacting the area of off-layer text removes it, but also removes
    anything visible in that area. No MuPDF.js call removes content by layer.
*   **Save options.**
    - `clean` removes comments from page content.
    - `sanitize` also removes resources a page lists but never draws.
    - Neither removes marked-content properties (ActualText, alternative
      text), layer names, or content on layers that are off.
*   **Reused drawings.** Redacting a form XObject on page 1 leaves page 2's use
    of the same XObject untouched, because MuPDF makes a private copy for
    page 1. The value on page 2 is removed only by a mark on page 2, which
    spreading provides.
*   **Drawings under a box.**
    - A rectangle (`re`) comes out of `Path.walk` as move, three lines, close.
    - A straight line comes out as move, line.
    - One path made of many squares is one walk with several move steps.
    - `REDACT_LINE_ART_REMOVE_IF_COVERED` judges each part (each move step)
      separately. A box over one square of a three-square path removed that
      square and kept the other two. A partly covered part is kept whole.
*   **Image metadata.** Metadata segments can be cut from a JPEG's raw stream
    bytes without re-encoding, and the image still decodes. A JFIF APP0
    segment can carry a thumbnail, so only Adobe's APP14 is kept (Appendix A).
*   **Pixels outside the shown area.**
    - A redaction area placed outside the page blanks the pixels of an image
      that reaches past the page edge, and leaves its on-page pixels as they
      were.
    - An image hidden by a clip *inside* the page is different: redacting that
      area blanks every image there, including visible ones under it.
*   **Invisible text.** A device sees invisible (render mode 3) text through
    `ignoreText` and visible text through `fillText`. Text extraction returns
    both.

### The patch spike (slice 1)

The spike ran on 25 Nov 2026, on synthetic PDFs only. Patch 0003 builds, and
`vendor/mupdf/upstream/0003-repro.mjs` passes all its checks: each option on
its own, and the three together with `clean,sanitize` as step 5 runs them.
Every checked page renders byte for byte as before the save.

The patch also edits code the app runs today: image redaction's pixel code
moved into two helpers, the content filter that text redaction uses gained
branches that only the new options turn on, and the layer rule fix below.
- **The writer's output is unchanged.** A differential probe ran the calls of
  `engine/pdf/write/redact.ts` on one synthetic page with MuPDF before and
  after patch 0003. The page reaches every branch the patch edits on that
  path:
  - images in RGB, CMYK, Indexed and Separation colour spaces, an image mask,
    a soft-masked image, the 1 x 1 masked image, a JPEG and an inline image;
  - an image wholly covered, and one with two boxes;
  - text in `Tj` and `TJ`, inside marked content, a layer that is off, a
    clip and a Type 3 font.

  The two outputs are byte for byte the same, apart from the file ID that
  every save makes anew.
- **The existing tests still pass.** The oracle-judged browser tests of image
  redaction (`image.pdf` and `masked-image.pdf` in
  `tests/e2e/redact.spec.ts`) pass on the rebuilt MuPDF.
- **The layer rule fix changes what MuPDF draws and reads, not what it
  writes.** The writer never asks what is hidden: with no usage,
  `pdf_is_ocg_hidden` treats everything as shown. Text extraction and the
  view do change for files with `/P /AllOn` or `/AnyOff` rules.
- **Oracle-judged fixtures cover the edited branches** (the owner's call,
  25 Nov 2026: only the fixtures slice 1's changes need, before slice 2).
  `tests/oracle/leak-vectors.json` holds twelve entries, run by
  `tests/e2e/leak-suite.spec.ts`:
  - image redaction in CMYK, Indexed and Separation colour spaces, through a
    one-pixel image's soft mask, and in an inline image
    (`fixtures/image-spaces.pdf`);
  - text redaction inside marked content with and without a property list,
    after marked-content points, inside a clip, on a layer that is on, and
    in a form XObject (`fixtures/marked-text.pdf`);
  - a value on a `/P /AnyOff` rule that is met, which MuPDF used to hide, so
    the user could not mark it (`fixtures/layer-rules.pdf`).

  Two boxes on one image take one entry's single mark twice, so that case
  is a browser test in `tests/e2e/redact.spec.ts`. Two edited branches have
  no entry, and the differential probe covers both: Type 3 glyph
  procedures, which redaction never filters (it runs with `recurse = 0`,
  skipping patterns, soft masks and Type 3 fonts), and text on a layer that
  is off, which the app cannot show or mark today. A further browser test
  checks that content on a `/P /AllOn` rule that is not met is no longer
  drawn. Both layer tests fail on the unpatched MuPDF.
  The outside checker now also reads CMYK, Indexed, Separation and inline
  images.
  The stencil-mask branch was already judged (`signatures.pdf`).
- **The text the content filter drops is judged too** (owner, 25 Nov 2026).
  Seven entries, with no mark, plant a value in `fixtures/content-strings.pdf`
  where no reader draws it: a BDC's ActualText, Alt and E, a DP's
  properties, an extra key in an inline image's dictionary, a comment, and
  an unknown operator's operand inside BX/EX. Slice 1's stand-in,
  `tests/e2e/preparation-saves.spec.ts`, put the fixture through step 5's
  and step 8's saves; from slice 2 the leak suite adds it to the app and the
  outside checker judges the working copy it stores with `absent` and
  `rendered`: every value is gone and the page draws the same.
  Step 5's own file still holds the replaced content stream, unreferenced,
  until step 8 drops it; step 8's file is what is stored (owner, 25 Nov
  2026). The oracle's `rendered` check (pypdfium2) came forward from
  slice 5 for this. Hidden
  `/AllOn` content now stays in today's output unmarked, like any content on
  a layer that is off, until slice 2's preparation drops it.

*   **What the patch touches.** `source/pdf/pdf-op-filter.c` (hidden layers
    and marked content), `source/pdf/pdf-clean.c` (pixel blanking, next to
    image redaction, whose pixel code it now shares through two helpers),
    `source/pdf/pdf-write.c` (the save options), `source/pdf/pdf-layer.c` (a
    fix, below), `source/pdf/pdf-imp.h`, and `include/mupdf/pdf/interpret.h`
    and `document.h`. Each option runs the sanitize filter, so it implies
    `sanitize`.
*   **`drop-hidden-oc` works as designed.** The filter sets the interpreter's
    usage to "View", so it hides exactly what MuPDF hides when drawing. Text
    after hidden text in the same text object keeps its place. How it
    behaves at the edges:
    - **A hidden clipping path is kept, painting nothing**, because MuPDF
      still clips with it when drawing. Its outline stays in the file.
    - **Hidden text in a clipping render mode** (`Tr` 4 to 7) is removed.
      As when redaction removes such text, the filter then clips away
      everything after it until the next `Q`. Visible text lost this way
      makes step 9 refuse the document.
    - **Content that is off only for viewing** (a group whose `/Usage`
      says off for View but on for Print) is dropped.
    - **An OCMD with a `/VE` expression** counts as visible, as MuPDF draws
      it, so its content stays and the user sees it.
*   **MuPDF judged two layer rules wrongly, and the patch fixes them.**
    `pdf_is_ocg_hidden` treated `/P /AllOn` as on whenever any group was on,
    and `/P /AnyOff` as off whatever the groups were. The view showed, and
    `drop-hidden-oc` would have kept, content that should be hidden. Step 2
    judges annotations by the specification, so the two would have
    disagreed. The patch now tests every group as ISO 32000-2 8.11.2.2
    defines, and a rule with no groups has no effect. This also changes what
    the app draws for such files. The owner keeps it (25 Nov 2026).
*   **`drop-mc-properties` works as designed**, and also turns a `DP` with
    properties into an `MP`. Inline `DP` properties are content-stream data
    that step 7's allowlist cannot reach. The owner confirmed this (25 Nov
    2026).
*   **`blank-unshown-pixels` works as designed.** It finds the clips with
    MuPDF's own drawing: a device pass records every image placement and the
    clips in force there, and the draw device then paints each image's shown
    area in its own pixels. Clips that are not rectangles (a triangle in the
    repro) blank exactly. A pixel counts as shown if it shows on screen or in
    print, so a print-only annotation keeps its image's pixels. Images with
    identical data are treated as one, which can only leave more pixels. How
    it behaves at the edges:
    - **The shown area is widened by one pixel**, so smooth scaling at a clip
      edge looks the same.
    - **Images drawn inside a tiling pattern** count as fully shown.
    - **Images inside Type 3 glyphs** are not seen, and stay as they are.
    - **A soft-mask group** counts as a rectangular clip at its bounds.
    - **A blanked image is stored with Flate**, as image redaction stores
      it. A blanked JPEG grows: five half-hidden 300 dpi scans went from
      1.2 MB to 4.4 MB after step 8. Images with 16 bits per component come out with 8,
      and indexed images in their base colour space, as with redaction.
    - **Pixels placed only in hidden content** are kept until
      `drop-hidden-oc`, in the same save, drops the placement. The image is
      then used nowhere, and step 8's garbage collection removes it.
    - **An image MuPDF cannot load** (an unknown colour space, say) cannot be
      blanked, so the save fails and step 5 refuses the document. An image
      whose data does not decode is drawn blank by MuPDF, and its data is
      replaced by those blank pixels.
*   **A signed signature widget keeps its stamp when flattened.** MuPDF calls
    a signature signed when its `/V` is a `/Sig` dictionary, and never
    re-synthesises a signed widget's look. After `bake`, the stamp "Digitally
    signed by Jane Roe" is page content and page text, and renders exactly
    as before. After a `garbage=4` save, the `/Sig` dictionary and the form
    are gone. An **unsigned** signature widget renders differently: MuPDF
    draws its own "sign here" look on screen, but `bake` flattens the stored
    look. So the working copy can look different from the original view in
    that box.
*   **`bake` hides its own failures.** `pdf_bake_document` catches any error,
    abandons its operation, and returns as if it worked. Slice 2 has to
    check, after step 4, that no annotation or widget is left, and refuse
    the document if one is.
*   **A drawing wholly outside the page that turns a corner is kept** by step
    6. `REDACT_LINE_ART_REMOVE_IF_COVERED` removes a part only when its bounds
    fit inside one redaction area. A line from (-50, 10) to (10, -50), and an
    L-shaped stroke round the bottom-left corner, lie wholly outside the page
    but fit inside neither the left nor the bottom area, so both stay in the
    file. Their bounds also overlap the page, so no test on bounds can tell
    them from a drawing that shows. A square inside the corner, a square
    left of the page, and a glyph past the corner are removed. The owner
    accepts this (Risks).
*   **`UserUnit` is applied by `page.getBounds()`.** A 612 x 792 page with
    `/UserUnit 2` has bounds [0 0 1224 1584], so step 6's areas in page space
    are right.
*   **`saveToBuffer(...).asUint8Array()` is a view into MuPDF's memory**, and
    goes stale when that memory grows. Opening it again needs a copy first
    (`.slice()`).

### Slice 2 (preparation, reading, storage and anchoring)

Found while building slice 2, on 25 Nov 2026, on synthetic PDFs, apart
from the refusal counts in the NFRs.

*   **MuPDF's garbage collection drops the data of a stream whose dictionary
    is held elsewhere.**
    In MuPDF 1.28.6, a save with `garbage` can write a stream as a plain
    dictionary, without its data. `renumberobjs` calls `pdf_update_object`,
    which gives the object a fresh xref entry with no stream offset. Step 7
    resolves every object, so the 1 x 1 image of `image-spaces.pdf` came out
    empty, and step 9 refused the file. Slice 2 saved (step 7a, with
    `compress`) and opened the result again before step 8. Slice 3 found that
    the conditions first written here were wrong: neither a read of the data
    nor a change of number is needed. Patch 0005 fixed it, and step 7a was
    removed (slice 3 Probe Findings).
*   **The trailer's `Encrypt` stays until step 8.** A file with an empty open
    password keeps its encryption through steps 4 and 5, and MuPDF goes on
    encrypting what it writes until step 8's `encrypt=none`. With the key
    deleted in step 7, step 9 refused `edit-locked.pdf`, so the allowlist
    keeps it without walking it (Appendix A.1).
*   **MuPDF lists no link among a page's annotations.** `getAnnotations()`
    leaves out `Link` annotations and `bake` keeps them, so step 2 records
    `links` from the page's own `/Annots`, and step 7 deletes them with the page's `/Annots`.
    The check after step 4 looks at what MuPDF lists, so links do not refuse
    a file.
*   **`blank-unshown-pixels` also blanks pixels the image's own soft mask
    hides.** In `masked-image.pdf` the pixels outside the mask's circle came
    out white in the working copy; the page draws the same. Tests that judge
    those pixels judge them against the working copy now, and the page
    against the original with `rendered`.
*   **PDFium differs from MuPDF in two ways the outside checker meets.** It
    draws an annotation on a layer that is off, which the specification and
    MuPDF hide, so that annotation's area is a declared exception to
    `rendered`. And it draws form fields only once its form environment is
    started: `rendered` called no `init_forms()` before, so it never saw a
    field; it does now. Flattened fields then differ only in how PDFium
    smooths their text, so their areas are exceptions too.
*   **`PDFObject.Null` throws on `get` and `resolve`.** A lookup that may
    miss goes through a key path, which stops at the first missing object
    (`engine/pdf/objects.ts`). An explicit `null`, as an element of a
    `/DecodeParms` array for a filter with no parameters, throws the same
    way, so the allowlist asks `isNull()` before it resolves a value
    (`null-elements.pdf`).
*   **Step 8's save keeps bytes after a stream's end of data.** A Flate
    image with `Tail 4400 9901` after its zlib data kept it through
    preparation, and the outside checker's raw scan, which dropped what
    follows a zlib stream's end, did not see it (`data-after-end.pdf`;
    answer 10). MuPDF does not throw on a damaged Flate stream: it decodes
    what it can, and a file with one prepared.
*   **`sanitize` loses a text state a form inherits.** In MuPDF 1.28.6's
    filter (`source/pdf/pdf-op-filter.c`), text-state changes such as `Tc`
    wait as pending until text is drawn, and are sent only inside a text
    object (`filter_flush`, under `p->in_BT`). A page that sets `3.9 Tc` for
    its text, then resets it in an empty `BT 0 Tc ET` before drawing a form
    XObject, loses the reset: the empty text object is never written, and
    `pdf_filter_Do_form` does not send it either. The form, filtered on its
    own from the default text state, then drops its own `0 Tc` as
    redundant, so its text is drawn with the inherited spacing. In the IRS
    1040 instructions this spreads the "TIP" and "CAUTION" icon labels past
    their icons' bounds, where they are clipped; step 9 sees the letters
    lost or moved and refuses the file. A one-page synthetic file shows it
    (a form's "Form text" spread by 3.9 points a letter). The writer runs
    the same filter, so an export can be refused the same way. Patch 0004
    sends the pending text state before a form is drawn (slice 2 answer 11;
    Detailed item 1b).
*   **Three cases checked at the end of slice 2.** Resources a page inherits
    from a page-tree node did not leak: step 5 gives each page its own
    filtered resources, and the originals did not survive. A shading
    pattern's `/ExtGState`, which MuPDF never applies, kept text and an
    ActualText in its soft mask group, so step 7 now deletes it
    (`shading-graphics-state.pdf`). A JPEG XObject naming its filter with an
    inline image's abbreviated `/F` kept its EXIF, as step 7 deleted `/F` as
    a file specification and left the JPEG bytes as samples, so a stream
    with `/F` as a name or an array, or with `/DP`, now refuses the file
    (`abbreviated-stream-keys.pdf`).
*   **Step 5's filter reaches every content stream a page uses.** It removed
    the marked-content properties in a tiling pattern, a Type 3 glyph and a
    soft mask's group, and those in page content written with a `#xx` escape
    or ended by a NUL. Only the kind went unrecorded, until the scan before
    step 5 covered the same streams (part 1, "What was removed";
    `marked-*.pdf`).
*   **MuPDF reads abbreviated filter names on any stream.** A JPEG XObject
    under `/DCT`, or `[/FlateDecode /DCT]`, drew, and kept its EXIF through
    preparation until step 7 read the names in full (Appendix A.2). An
    inline JPEG's EXIF did not survive step 5, which rewrites inline images.

### Slice 3 (the writer and the gate)

Found while building slice 3, on 25 Nov 2026, on synthetic PDFs only.

*   **The garbage-save bug is real in stock MuPDF, and patch 0005 fixes it.**
    It was reproduced on the 1.28.6 tag built with no patches (built here in
    the pinned Emscripten image), and on the vendored build with patches 0001
    to 0004, with the same results. A local rebuild of 0001 to 0004 the same
    way matched `SHA256SUMS` byte for byte. `vendor/mupdf/upstream/0005-repro.mjs`
    holds the cases.
    - **When it happens.** A save with `garbage` of 2 or more loses the data
      of a stream when all of these hold:
      - the stream was read from the file and has not been changed in this
        session;
      - its dictionary holds an indirect reference itself;
      - something besides the xref holds that dictionary while the save runs.

      No read of its data, no edit and no change of its number are needed;
      `garbage=1` keeps it.
    - **Why.** `renumberobj` edits a dictionary in place when the xref holds
      its only reference, and an edit made during a save leaves the object's
      entry, with its stream offset, where it was. A shared dictionary is
      copied instead, and `pdf_update_object` files the copy in a new, empty
      entry of the incremental xref section, with no stream offset or buffer.
    - **How the app met it.** In MuPDF.js 1.28.6 every `PDFObject` keeps its
      `pdf_obj` twice and `destroy()` drops it once, so one `resolve()` holds
      the dictionary for good. Step 7 resolves every object.
    - **Upstream.** Master (b20db02b9, 23 Nov 2026) has the same C path. It
      fixed the MuPDF.js double keep in b8d579fee (10 Nov 2026), which alone
      does not help while a handle is live. MuPDF bug 709830 (UNCONFIRMED)
      reaches the same lines through `garbage=3`'s second pass.
    - **The fix.** Patch 0005 moves the object's own entry into the
      incremental section before `pdf_update_object` (Detailed item 1c). It
      fixes 709830's case too.
    - **The app today.** Step 7a is removed (owner, 25 Nov 2026), so step 8
      saves the document step 7 resolved, with every object it resolved still
      held, and patch 0005 alone keeps their streams.
      - Without 7a, the 0001 to 0004 build refused `image-spaces.pdf` and
        `grey-soft-masks.pdf` at step 9. With 0005, every fixture prepared to
        a working copy of the same size as with 7a, with no stream left a
        dictionary and none over 64 bytes without a filter: step 8's
        `compress` compresses the streams step 7 wrote again.
      - The WebAssembly heap peak did not change: 344 MB for 5 half-hidden
        scans and 66 MB for 20 shown ones, with and without 7a.
      - The writer resolves no stream before its save. A probe that wrote a
        box on every fixture through the 0001 to 0004 build lost no stream.
        Leak entry `kept-soft-masked-image-when-written` judges a kept image
        with a soft mask after a write.
*   **MuPDF bounds a stroke with its miter allowance.** For
    `REDACT_LINE_ART_REMOVE_IF_COVERED`, a stroked part's bounds reach up to
    the miter limit times half its width past its points, so with the default
    limit of 10, a 1.5 pt signature stroke needs a box 7.5 pt past it to be
    removed. The gate grows strokes by half their width only (part 6), so a
    box short of the allowance leaves the part whole, and the gate refuses it
    as `partly-covered-drawing`: it fails closed (`signature-stroke.pdf`).
*   **A font whose letters are declared taller than drawn loses neighbours.**
    MuPDF's redaction removes a letter whose box, from its font's descender to
    its ascender and shrunk by a tenth, meets an area. With `/Ascent 1000
    /Descent -1000` on lines 13 pt apart, removing "Jane" on one line also
    removed "name" above it, which no mark touches: the gate's
    `extra-text-removed` (CUJ 8; `tall-letter-boxes.pdf`).
*   **A rewritten image gets MuPDF's own colour profile.** Image redaction
    and `blank-unshown-pixels` decode an image into a pixmap in MuPDF's
    device colour space, blank pixels and store a new image
    (`pdf-clean.c`, `pdf_add_image`). With colour management built in, that
    space is an ICC one, so `pdf_add_colorspace` writes
    `[/ICCBased …]` with MuPDF's built-in profile: sRGB for a `DeviceRGB`
    image, its CMYK profile for `DeviceCMYK`. This has been so since before
    Phase 3, in the writer and, since slice 1, in preparation. The samples
    are unchanged, as the `pixels` check shows, and MuPDF draws the same.
    PDFium draws an RGB image within 8 levels, but the kept half of a CMYK
    one up to 23 levels apart in a channel (`image-spaces.pdf`). The owner
    accepts it (25 Nov 2026; Risks).

### Slice 5 (the rest of the leak suite)

Found while building slice 5, on 25 Nov 2026, on synthetic PDFs only.

*   **Preparation keeps free text in 28 of 30 kept places probed.** A file
    with a value in each kept key that can hold free text went through
    `prepareDocument`. Gone: an image XObject's resource name, which step 5's
    filter names anew, and the second string of the file's `ID`, which
    MuPDF writes anew on every save. Every other value stayed; the owner
    keeps them by decision ("What preparation promises"; `kept-names.pdf`).
*   **MuPDF bounds a stroke by its miter limit times its full width.** A
    slanted line or a corner drawn 0.5, 1.5 and 2 pt wide was removed only
    by a box clearing its points by 5, 15 and 20 pt, ten times its width.
    In MuPDF 1.28.6's `source/fitz/path.c`, `adjust_rect_for_stroke` grows a
    stroke's bounds by half its width times twice the miter limit, as "miter
    limit is expressed in terms of the linewidth"; a part with no width or
    no height, a horizontal or vertical line, grows by half its width only.
    The slice 3 finding above gives half that. Nothing leaks, as the
    gate grows a stroke by half its width and refuses a part it finds wholly
    under a box that MuPDF kept, and the refusal asks for a margin; the
    leak entries' boxes clear their strokes by ten times their width
    (`drawings.pdf`).
*   **pdfminer reads a standard font with its own widths.** A font named
    `Helvetica` that declares other `/Widths` is placed by MuPDF with the
    declared widths and by pdfminer with Helvetica's, so the two readers put
    its letters in different places. `wide-letter-boxes.pdf` names its font
    otherwise, with a descriptor of its own, so both take the declared
    widths.
*   **Two A.1 and A.2 rules can't be reached by a file.** No array the walk
    reaches can hold a PostScript XObject, the only role we delete, so "a
    role we delete met as an array element" has no case. A JP2 file with no
    `jp2c` box is refused at step 5, where MuPDF fails to read it wherever it
    sits, before step 7's rule for it; it has a refusal entry
    (`refused-jp2-without-codestream`).
*   **A font declared wider than it is drawn is cleaned.** MuPDF removes a
    letter by its declared box, and a word's own boxes meet no neighbour
    side by side, so marking "Jane" in such a font removes it and keeps the
    rest in place (`letters-declared-wider`). Only taller boxes reach other
    lines (`tall-letter-boxes.pdf`, CUJ 8).

## Decisions Made During Drafting and Review

*   **Where preparation happens (25 Nov 2026):** once per document, cached.
    - A document is prepared when it is added, and again only when the reader
      tag changes. Preparation deletes hidden annotations, then flattens,
      cleans page content, removes off-page content, strips by allowlist and
      cuts image metadata.
    - The working copy is saved in the project folder.
    - The app renders it, reads its text, marks it, spreads over it and
      writes from it.
    - Print-only annotations are flattened like the rest, so they show in the
      view and in the output, and their text can be marked.
*   **Content on layers that are off (25 Nov 2026):** removed by a third
    vendored MuPDF patch. It is one of three content-filter options (part 5).
*   **Pixels hidden by a clip (25 Nov 2026):** blanked by the same patch.
*   **ActualText and alternative text in page content (25 Nov 2026):** removed
    by the same patch.
*   **Stored data (25 Nov 2026):** files are only added, never replaced. Each
    reader tag gets its own folder (part 3). `project.json` stays version 3,
    and an older build still opens the project as it last saw it.
*   **Owner answers to the review (25 Nov 2026):**
    1. Issue #6 waits for the OCR phase.
    2. Partly covered drawings: MuPDF removes every part wholly under a box,
       and the app refuses only a partly covered part that is not a single
       rectangle or straight line.
    3. A refresh that changes an approved document sends it back to review.
    4. The approval dialog lists kinds only, with no counts.
    5. The outside checker reuses pdfminer's stream decoders.
    6. A document with no marks downloads as its working copy, unchanged,
       after the gate passes.
    7. Re-anchoring is not an edit: it only moves a document back to review.
    8. Duplicating a project copies the whole `.redactorator/` folder.
    9. The allowlist is a full allowlist by role (Appendix A.1), not a
       structure allowlist with value rules.
*   **Owner answers during slice 2 (25 Nov 2026):**
    1. The allowlist's role table is generated from the PDF Association's
       Arlington PDF Model (Apache 2.0), from the roles reachable from the
       trailer through the keys we keep, rather than written by hand. It stays
       a full allowlist by role: unknown keys are deleted, and an object with
       no role refuses the file. Our own decisions, the keys we keep and the
       kind each deleted key records, stay hand-written (Appendix A.1). The
       model's TSVs are vendored at one pinned commit, as build-time data;
       nothing fetches them at run time.
    2. A catalog `/Names` dictionary records a kind per tree it holds: `links`
       for `Dests`, `attachments` for `EmbeddedFiles`, `scripts-actions` for
       `JavaScript`, and `app-data` for any other tree.
    3. `marked-content` is also recorded when a page's or form XObject's
       decoded content holds the name `/ActualText`, `/Alt` or `/E`, found by a
       byte scan that matches whole names only. Inline property lists are what
       the resource rule misses; over-reporting is acceptable, missing one is
       not.
    4. Slice 2 brings the outside checker's `image-metadata` and `structure`
       checks forward, adds one leak entry per preparation rule path, and
       judges entries with no mark on the working copy the app stores. The
       entries for each free-text key and each refusal stay in slice 5.
    5. The keys the design's rules left undecided in the generated table:
       - deleted as `app-data`: the graphics state's `HTO`, `HTP` and Apple's
         `AAPL:` keys, every halftone's `HalftoneName`, a form's or pattern's
         `XUID` and `GTS_` keys, the model's `Blackls1` alias of `BlackIs1`,
         and DeviceN's `MixingHints`;
       - kept: a ToUnicode CMap stream's `Type`, `CMapName`, `CIDSystemInfo`,
         `WMode` and `UseCMap`, the specification's own CMap keys;
       - PostScript XObjects are deleted and recorded as `app-data`, not
         refused (leak entry `postscript-xobject`);
       - `Crypt` filter parameters (`FilterCrypt`) refuse the file as
         `prepare-failed`.
    6. The outside checker's `structure` check reads the same vendored
       Arlington data, with its own walker over the TSVs and its own
       keep-or-delete decisions written separately in Python, sharing no
       code with the app.
    7. Only a form drawn by XFA alone is refused. A hybrid form, whose XFA
       sits beside widgets MuPDF draws, prepares: its fields are flattened,
       and the whole form, XFA included, is deleted and recorded as
       `form-data` (`hybrid-xfa.pdf`, whose XFA datasets hold a value).
    8. A soft mask's one-channel colour space that reads as grey
       (`CalGray`, an ICC profile with `/N 1`, `[/DeviceGray]`) is rewritten
       as `DeviceGray` (`grey-soft-masks.pdf`, judged by `rendered`); any
       other array colour space is still refused (Appendix A.1).
    9. The lossless filters ahead of an image filter are undone, the image
       cut, and kept under its image filter alone
       (`[/ASCII85Decode /DCTDecode]`, `[/AHx /JPXDecode]`;
       `image-prefilters.pdf`).
    10. Bytes after a stream's end of data: a probe showed step 8's save
        keeps them, so step 7 writes every kept stream under lossless
        filters alone again from its decoded bytes, and the outside checker's
        raw scan reads past a zlib stream's end (`data-after-end.pdf`).
    11. The sanitize filter's lost text state (Probe Findings) is fixed by a
        patch 0004 to MuPDF, with a leak entry on a synthetic fixture
        (Detailed item 1b).
    12. "What preparation promises" sets the boundary: kept bodies (fonts,
        colour profiles, CMaps, other image codecs) are kept as they are by
        decision, and a finding inside one is out of scope unless user data
        reaches it. Review findings on kept bodies are closed against it.

*   **Owner answers during slice 3 (25 Nov 2026):**
    1. The garbage-save bug is real in stock MuPDF; patch 0005 fixes it, and
       preparation's step 7a, a save and reopen before step 8, is removed.
    2. Patch 0005 does not change `READER_TAG`: it changes how files are
       saved, not how they are read (part 2).
    3. Marking a lost mark's word again replaces the lost mark (part 4).
    4. The partly covered drawing sentence asks for a margin, as MuPDF
       removes a stroke only when the box clears its miter allowance (part 6).
    5. A refused Preview's highlight can be dismissed (part 8). `mark-lost`
       naming the mark's first page is accepted.
    6. A rewritten image keeps MuPDF's own ICC profile, as before Phase 3
       (Risks).

*   **Owner answers during slice 4 (25 Nov 2026):**
    1. The approval dialog lists each removed kind once per document: an
       approval that lands saves the document's removed kinds in
       `project.json`, and a later approval lists only others (part 8).
    2. The golden storage files `expected/project.json` and
       `expected-old/project.json` are recorded again for the new field.

*   **Owner answers during slice 5 (25 Nov 2026):**
    1. The meta-test is strict: every leak check must fail on an entry's
       uncleaned fixture, except `structure`, which may pass there where the
       fixture holds only kept keys, as a guard on what the app writes; an
       entry expecting a clean output needs at least one leak check that
       fails. `kept-soft-masked-image-when-written` gains the marked CMYK
       region's `pixels`, and `form-inherits-text-state` is dropped:
       `form-inherits-text-state-when-written` adds the same fixture, so
       step 9 would refuse a moved text when it is added.
    2. The free text kept keys can hold is kept as it is, by decision ("What
       preparation promises"). Each such key has an entry expecting
       `"kept"`, whose `kept` check shows the value is still in the working
       copy.
    3. The leak-vector list has one refusal entry per refusal a synthetic
       file reaches: `unsupported-form`, `encrypted`, `open-failed`,
       `extra-text-removed`, `partly-covered-drawing`, and one
       `prepare-failed` entry per refusal rule. `text-moved`,
       `check-failed` and `apply-failed`, reached only through the fake
       worker, and `mark-lost`, reached only through edited stored text,
       stay in `preview.spec.ts` and `anchoring.spec.ts`.

## Critical User Journeys (CUJs)

### CUJ 1: A filled tax form is cleaned and stays readable

*   **Given**: A fillable PDF tax form with typed values. One field holds the
    client's name, and the form's fields have names like `client_name`.
*   **When**: The user marks the client's name on the page, previews the
    document, approves it and downloads it.
*   **Then**:
    - every other value still shows on the page and prints;
    - the client's name is gone from the page text and from every part of the
      file;
    - field names, tooltips and the form itself are gone, and the form is no
      longer fillable;
    - the approval dialog listed "Form data: made part of the page".

### CUJ 2: A signed engagement letter

*   **Given**: A PDF with a digital signature and a visible signature stamp
    reading "Digitally signed by Jane Roe".
*   **When**: The user marks "Jane Roe" in the stamp and in the body, approves
    and downloads.
*   **Then**:
    - the stamp shows on the page with the name removed;
    - the signature data and the signer's certificate are gone from the file;
    - the approval dialog listed "Digital signature: removed; the cleaned file
      is not signed".

### CUJ 3: A partly covered vector signature

*   **Given**: A project with several documents. One has a signature on page 2,
    drawn as one long vector stroke.
*   **When**: The user draws a box over most of the signature and previews.
*   **Then**:
    - nothing is exported for that document;
    - the message says a box on page 2 covers part of a drawing, and asks the
      user to cover the whole drawing with a margin around it, or remove the
      box;
    - the user enlarges the box and previews again, and the drawing is gone
      from the file;
    - the other documents could still be exported throughout.

### CUJ 4: Hidden content the user never saw

*   **Given**: A PDF with a layer that is switched off, holding a line of page
    text with a client's phone number, and a bookmark titled with the
    client's name.
*   **When**: The user opens it, marks nothing, previews, approves and
    downloads.
*   **Then**:
    - the approval dialog listed "Hidden layer content: removed" and
      "Bookmarks: removed";
    - the output has neither;
    - the page looks the same as before.

### CUJ 5: Marks survive an app update

*   **Given**: A project saved by a build that read text one way. It holds
    marks, including one spread from another document.
*   **When**: A new build, which reads text differently, opens the project,
    and the user downloads a document.
*   **Then**:
    - the app shows "Updating documents…" once, while it rebuilds each
      document for the new build;
    - every mark still sits on the same words;
    - the downloaded file has the marked values removed and the unmarked text
      in place, as the outside checker confirms;
    - the older build, if reopened, still sees the project as it was.

### CUJ 6: A form that cannot be cleaned

*   **Given**: A PDF built as an XFA form only, with no normal form fields.
*   **When**: The user adds it to a project.
*   **Then**: It is refused right away with a message saying this kind of form
    cannot be cleaned here, before the user spends time marking it.

### CUJ 7: A mark that could not be placed after an update

*   **Given**: As in CUJ 5, but the new build reads one marked word with
    different letters.
*   **When**: The project opens, and the user previews that document.
*   **Then**:
    - the mark's row in the marks panel shows "Mark again";
    - the preview is refused with "A mark on page 4 no longer matches the
      page. Mark it again.";
    - after the user marks the word again, the preview passes.

### CUJ 8: A mark that would also remove a neighbouring letter

*   **Given**: A page whose font declares letters wider than they are drawn.
*   **When**: The user marks a word and previews.
*   **Then**:
    - nothing is exported for that document;
    - the message says cleaning would also remove unmarked text next to a mark
      on page 1;
    - the extra letters are highlighted on the page, and the message holds no
      document text.

## Technical Plan (Architecture)

### 0. The shape of it

Phase 3 adds one new step, **preparation**, at the front of a PDF's life in a
project. It changes what the rest of the engine works on: from the file the
user picked to a **working copy** derived from it.

```text
                  when a file is added, or when the reader tag changes
 original.pdf ──► worker: prepareDocument (engine/pdf/prepare)
  (kept as is)        │
                      ├──► working copy   .redactorator/pdf-3/working/<id>.not-redacted.pdf
                      ├──► page text      .redactorator/pdf-3/text/<id>.json  (+ removed kinds)
                      └──► image list     .redactorator/pdf-3/images/<id>.json
                                 │
        ┌────────────────────────┼────────────────────────────┐
        ▼                        ▼                            ▼
  view: render the        marks: select, spread,       approval dialog:
  working copy            re-anchor over page text     list removed kinds
                                 │
                                 ▼
                     Preview: redact the working copy,
                     run the gate, download (engine/pdf/write)
```

The original is never changed (PRD "Safety"). It stays in the project as the
source the working copy is rebuilt from. Everything the user sees, marks and
downloads comes from the working copy, so the view, the text and the output
all come from the same bytes. Preparation runs once, not on every open.

### 1. Preparation (`engine/pdf/prepare/`)

`prepareDocument(original bytes)` returns either a refusal code, or the
working bytes, the page reading and the set of removed kinds. It runs once per
document in the worker: when the file is added, and again only when the
reader tag changes. Export never repeats any of it. Export only redacts the
working copy (part 6).

The order of the steps matters:
- Flattening turns annotations into page content, so the steps that clean page
  content (5 and 6) come after it, to reach that content too.
- Stripping (step 7) comes after it as well, because flattening needs the
  form's fonts and fields, which stripping removes.

1. **Open and refuse.**
   - The existing `load` refuses files with no pages, and encrypted files
     that need a password to open. A file with an empty open password, such
     as an edit-locked one, opens and is prepared; step 8 drops its
     encryption.
   - New: a catalog `/AcroForm` with an `/XFA` entry and no widget on any
     page, a form only XFA draws, is refused as `unsupported-form`. A hybrid
     form, whose XFA sits beside widgets MuPDF draws, is prepared: step 3
     flattens its fields, and the form, XFA included, is deleted and
     recorded as `form-data` (slice 2 answer 7; `hybrid-xfa.pdf`).
   - If the file has more than one revision (`countVersions() > 1`), record
     the kind `old-revisions`.
2. **Delete annotations that must not be flattened:**
   - annotations with the Hidden flag, or with NoView and not Print;
   - annotations on a layer that is off;
   - hidden widgets;
   - `Redact` and `Popup` annotations.

   Link annotations are not deleted here, as MuPDF does not list them among
   a page's annotations (slice 2 Probe Findings): this step records `links`
   from the page's own `/Annots`, and step 7 deletes them with it.

   **What "on a layer that is off" means.** A layer is an OCG (Optional
   Content Group); a rule about layers is an OCMD (Optional Content Membership
   Dictionary). An annotation's `/OC` names one or the other.
   - **An OCG** is off when it appears in the default configuration's `/OFF`
     list (`/OCProperties/D/OFF`), or when that configuration's `/BaseState`
     is `/OFF` and the OCG is not in its `/ON` list. A `/BaseState` of
     `/Unchanged` counts as on.
   - **An OCMD** is judged by its `/P` rule (`AnyOn` by default, or `AllOn`,
     `AnyOff`, `AllOff`) over its layers, under those defaults. Its `/OCGs`
     may be a single dictionary or an array.
   - **A free-form `/VE` expression** in an OCMD refuses the document as
     `prepare-failed`, rather than being guessed at, wherever preparation
     judges a layer: an annotation's `/OC` here, and before step 5 a page's
     or form's `/Properties` and an XObject's `/OC`. The layer rules live in
     `prepare/layers.ts`, which steps 2 and 5 share.

   Without this step, flattening would make hidden annotations visible (probe
   finding).
3. **Flatten** with `PDFDocument.bake(true, true)`. It copies every remaining
   annotation's and widget's look into the page, and removes the form tree.
4. **Save and reopen** (`saveToBuffer("")`, then open), because pages already
   open still list their old annotations after flattening. Then check that no
   page lists an annotation or a widget (`getAnnotations()`, `getWidgets()`),
   since `bake` hides its own failures; one left refuses the document as
   `prepare-failed`. Links pass, as MuPDF does not list them.
5. **Clean page content** with one save through MuPDF's patched content
   filter: `saveToBuffer("clean,sanitize,drop-hidden-oc,drop-mc-properties,blank-unshown-pixels")`,
   then reopen. In that one pass it:
   - drops content on layers that are off, and removes the layer markers from
     content that stays;
   - drops marked-content properties: ActualText, alternative text and
     expansion text;
   - drops comments, and resources a page lists but never draws;
   - blanks image pixels that no placement shows, whether outside the page or
     outside every clip in force.
6. **Remove content outside the crop box.** First, record the kind
   `outside-page` if any glyph, or any part of a drawing, lies wholly outside
   the crop box. Then add four redaction areas, one on each side of the
   visible page, each running from its edge out to ±100,000 pt. The areas are
   in MuPDF page space, the space of `page.getBounds()`, which already applies
   `Rotate`, the crop box and `UserUnit` (the spike confirmed `UserUnit`). Then
   call:

   `applyRedactions(false, REDACT_IMAGE_NONE, REDACT_LINE_ART_REMOVE_IF_COVERED, REDACT_TEXT_REMOVE)`

   The areas stop at the crop box's edge and do not overlap it, so a letter or
   drawing that crosses the edge is kept, because part of it is visible. Text
   and drawing parts wholly outside are removed. (Pixels outside the page were
   blanked in step 5.)
7. **Strip by allowlist** (`engine/pdf/allowlist.ts`, over the role table
   `engine/pdf/allowlistRoles.generated.ts`, which is generated from the PDF
   Association's Arlington PDF Model; Appendix A.1).
   - Walk from the trailer, through the keys each object's role keeps.
   - Give each dictionary, stream and array a **role**, one of the model's
     object types, chosen from the candidates the key that leads to it names
     (Appendix A.1, "Choosing a role").
   - Delete every key the role does not keep, and record the kind it
     belongs to. Refuse the document as `prepare-failed` where a key can't
     be deleted safely, or an object has no role. Appendix A.1 is the one
     statement of these rules.
   - JPEG images get their metadata segments cut from their raw bytes, and
     JPEG 2000 images get their metadata boxes cut (Appendix A.2).
   - Layer settings (`/OCProperties`) are removed, since step 5 already removed
     both the hidden content and the layer markers. Removing them records no
     kind; `hidden-layers` comes only from the device pass before step 5.
8. **Save** with `saveToBuffer("garbage=4,compress,encrypt=none")`: one
   revision, and anything nothing points to is dropped. Its `compress`
   compresses the streams step 7 wrote again from their decoded bytes
   (Appendix A.2). Step 7 still holds every object it resolved; patch 0005
   keeps their streams through the save (slice 3 Probe Findings). Slice 2's
   step 7a, a save and reopen before this one, was removed in slice 3
   (owner, 25 Nov 2026).
9. **Check the preparation** with MuPDF alone (`prepare/check.ts`): the
   working copy has as many pages as the original, and
   - every glyph the original draws on screen is still drawn at the same place
     in the working copy, using `missingGlyphs` and `movedGlyphs` (part 6).
     Both files are read with `READING_OPTIONS`, and glyphs outside the crop
     box are excluded;
   - the shared structural check passes (`engine/pdf/structure.ts`, part 6).

   A failed check refuses the document as `prepare-failed`.

**What was removed.** Preparation records which removal kinds applied to the
document, kinds only, with no counts. The literals are in Appendix A.
- Kinds removed by our own code (annotations, the allowlist, JPEG cutting) are
  recorded as they happen.
- Kinds removed inside the MuPDF filter are found before step 5, by one device
  pass over the flattened document:
  - hidden layer content: a layer that is off is used, meaning the device's
    `beginLayer` callback reports it (it fires even for content MuPDF skips),
    or a resource (a `/Properties` entry, or an XObject's `/OC`) names it.
    An annotation on a layer that is off is deleted in step 2 and records
    `annotations`;
  - marked-content properties: the resources hold properties other than
    layers, or a content stream the filter rewrites holds the name
    `/ActualText`, `/Alt` or `/E` (slice 2 answer 3). The scan covers the
    page's own content and every form, tiling pattern, soft mask's group and
    Type 3 glyph its resources reach, and reads names as the PDF lexer does:
    a name ends at white space, NUL included, or a delimiter, so `/E` is not
    `/EMC` or `/Encoding`, and a `#xx` escape stands for its byte;
  - private application data: a resource names a PostScript XObject, which
    the filter drops and no PDF 2.0 reader draws (owner, 25 Nov 2026);
  - unshown image pixels: an image or an image mask is drawn while a clip or
    a soft mask is in force, or reaches past the crop box.

### 2. Reading the working copy

Page text is read from the working copy with
`toStructuredText(READING_OPTIONS)`.

Flattened form values and annotation text are now ordinary page text, so they
can be selected, marked and spread. Images, with their fingerprints, are
listed from the working copy.

The **reader tag** is `READER_TAG = "pdf-3"`, exported from
`engine/pdf-protocol/messages.ts`, so the core and the worker share one
constant (the core may import `pdf-protocol`). It changes on *any* change to
preparation, to reading, or to the vendored MuPDF build, meaning its patch
set or `SHA256SUMS`, when that change can change what preparation or reading
makes. Patch 0005 kept `pdf-3`: it changes how a file is saved, not how one
is read, and the working copies come out the same (owner, 25 Nov 2026). The
worker's `ready` message repeats it; if the two ever
differ, the client stops the worker as `unexpected-reply`.

`READING_OPTIONS = "preserve-whitespace,ignore-actualtext"` lives in a leaf
module, `engine/pdf/readingOptions.ts`, used by `readText`, `glyphsOf` and
both checks (`prepare/check.ts` and `write/check.ts`).

### 3. Storage: added, never replaced (`engine/core/stored`, `engine/core/formats`)

Older stored files are never rewritten. Each reader tag gets its own folder in
the project's `.redactorator/`:

```text
.redactorator/
  project.json            ← as the last pre-Phase-3 build wrote it; never rewritten again
  text/<id>.json          ← older build's reading; never rewritten again
  images/<id>.json
  pdf-3/
    project.json          ← this build's project: marks with piece text, review states
    text/<id>.json        ← { readerTag, removed: kinds, pages }
    images/<id>.json
    working/<id>.not-redacted.pdf
```

- **Finding the project file.** `findProjectFile(folder, tag)` picks
  `.redactorator/<tag>/project.json` if it exists. Otherwise it picks the
  newest older tag folder, meaning the highest `pdf-N` by number below this
  build's, and falls back to the root `project.json`. The Library lists
  projects with it, so a Phase-3 project with no root file is still listed.
- **On open:** if the current tag's folder has no `project.json`, the
  Library's `openProject` calls `migrateToTag(folder, tag, source)` before the
  Session opens. That copies the source project file into the new folder and
  fills each piece's text (part 4). The Session's update then re-prepares
  every document and re-anchors every mark.
- **Every write** goes to the current tag's folder only. That covers the
  session save (`saveProject` now takes the tag), marks, approvals, rename,
  archive, added documents, and the re-identification that duplicate and
  import do. No Phase-3 code writes the root files.
- **Duplicate, move and import** copy the whole `.redactorator/` folder,
  older tag folders included (owner, 25 Nov 2026). Then they re-identify the
  copy inside the current tag folder only. Move and import find a project
  through `findProjectFile`, so a Phase-3 project with no root file moves
  and imports.
- **The project file format stays version 3.** Pieces gain an optional
  `text` field, and documents an optional `removedSeen` (slice 4). Only
  builds that write tag folders write them, and older builds never read
  those folders.
- **Rollback:** an older build reads the root files, or its own tag folder,
  and finds the project exactly as it was when the newer build first opened
  it. Changes made in the newer build are not visible to it. They are still
  there if the user upgrades again.
- **Projects created by a Phase-3 build** have no root `project.json`, so a
  pre-Phase-3 build does not list them.
- **Rebuilding:** the files in a tag folder are derived from the original and
  the copied project, so a missing or damaged `text`, `images` or `working`
  file is rebuilt by re-preparing that one document.
- **Remove** deletes the whole project folder, as today. `writeOriginals`
  also cleans up the new tag-folder paths when a write fails (Detailed item
  18).

### 4. Keeping marks in place (`engine/model/textAnchor.ts`, `engine/core`)

From Phase 3, each `TextPiece` stores its own `text`, and `Edit.text` is
copied from it. A mark's text and boxes are its identity; its offsets are a
cache.

- **Lost or not.** A piece is lost when `rangeText(pageText, start, end)` is
  not equal to its stored `text`. `rangeText` reads line and block ends as
  spaces, as the stored text does. A piece with an empty `text` is always
  lost. This is worked out, never stored. It runs per piece when the project
  opens, over each document's stored text record in the tag folder, and again
  in the writer's guard.
- **Re-anchoring** is a pure, format-neutral function. For each piece of a
  lost mark:
  1. find the characters on its page whose centres fall inside its stored
     boxes, and take the span of `PageText.chars` from the first of them to
     the last, line ends included;
  2. within that span, look for ranges `[start, end)` where
     `rangeText(pageText, start, end)` equals the piece's text;
  3. if there is exactly one such range, it becomes the piece's new offsets;
     otherwise the mark stays lost.

  There is no box-equality test and no tolerance constant.
- **When it runs.** On every open, the core runs the lost check on every text
  mark, re-anchors each lost one, and dispatches `reanchored` for each document
  whose marks changed. In practice marks move only once per new
  reader tag, when the tag folder is first created. On later opens the check
  finds nothing to do. Checking on every open also finishes the job if the app
  ever crashed halfway through.
- **Migrating marks from a pre-Phase-3 project**, which has no piece text,
  is done by `migratePieces(target, oldTexts)` inside `migrateToTag`:
  - a one-piece mark takes `MarkTarget.text`;
  - a multi-piece mark takes each piece's text from the older stored text
    file, read once at its old offsets with `rangeText`;
  - if that file is missing or damaged, each such piece gets `text: ""`, so
    the mark is lost.
- **After re-anchoring:**
  - the document's undo history is cleared;
  - a document whose working copy, removed kinds or marks changed goes back
    to review, setting `review` to `"in-review"` (review answer 3);
  - re-anchoring is not an edit. It does not bump the edit count and does not
    change the download state (owner, 25 Nov 2026).
- **The guard.** The writer refuses with `mark-lost` (part 6) when the
  letters at an edit's offsets in the working copy differ from `Edit.text`.
  The core refuses a document with a lost mark the same way before the
  worker is asked.
- **Marking again.** A new text mark with the same letters as a lost mark,
  on a page the lost mark is on, takes its place in the same undoable step
  (`markAdded`'s `replaces`), so the preview then passes (CUJ 7; owner, 25 Nov
  2026).

### 5. The third MuPDF patch (`vendor/mupdf/patches/0003-…`)

The patch adds **three** options to MuPDF's content filter, the filter that
`sanitize` and redaction already use and that patches 0001 and 0002 fix. All
three run together in step 5's single save.

- **`drop-hidden-oc`:**
  - content inside optional content that is off in the document's default
    configuration is not written: marked-content blocks, and form XObjects,
    images and shadings with `/OC`. MuPDF's own visibility logic decides
    (`pdf_is_ocg_hidden`), including layer rules;
  - the `/OC` markers around content that stays are removed.
- **`drop-mc-properties`:** a `BDC` whose properties are not a layer reference
  becomes a `BMC` with the same tag, and a `DP` becomes an `MP`.
- **`blank-unshown-pixels`:** for each image, the pixels that no placement of
  that image shows are blanked. A placement shows the part of the image inside
  the crop box and inside every clip in force. The code reuses MuPDF's
  existing pixel blanking for image redaction. An image whose pixels are all
  shown is left byte for byte as it was. Because only pixels no placement shows
  are blanked, a shared image is never split per placement.

**The patch is the spike.** It is the first slice of work (Detailed Plan),
because three guarantees rest on it. The spike also probes:
- `bake` on a signed signature widget;
- a drawing that straddles two of step 6's outside areas.

If an option cannot be built, the owner decides what replaces it before the
other slices start; see Risks. Upstream gets a feature request and a pull
request, as patch 0002 did.

### 6. Writing and the gate (`engine/pdf/write`, `engine/pdf/apply.ts`)

The writer starts from the working copy. Redaction itself does not change:
- text is removed by its ink band;
- images are blanked by pixels;
- line art is removed with `REDACT_LINE_ART_REMOVE_IF_COVERED`, which judges
  each part of a drawing separately;
- then the boxes are drawn.

**A document with no marks** skips the writer. The gate runs on the working
copy, and its bytes are downloaded unchanged (review answer 6). The worker
posts a copy (`document.bytes.slice()`), so the working bytes every later
Preview starts from are not transferred away. It sets `document.output` to a
fresh open of that copy, so the output can be rendered.

The gate stays MuPDF-only and checks the writer's own promises:
- **Structure** (`engine/pdf/structure.ts`, shared with preparation): one
  unencrypted revision, no annotations, no `/AcroForm`, and no key outside the
  allowlist. It is a check-mode run of the same walker as step 7. Independent
  proof of structure is the outside checker's job.
- **The guard:** each text edit's letters match `Edit.text`. This runs before
  writing.
- **Text under a box and image pixels under a box:** unchanged.
- **Unmarked letters.** `PageGlyph` gains `origin`, the point where the
  letter's baseline starts. "Same place" is the existing 0.05 pt tolerance
  (`SAME_PLACE`), and "same baseline" is an origin `y` within 0.05 pt.
  - `missingGlyphs` returns original letters, untouched by any box, that have
    no cleaned letter with the same character at the same place, and none on
    the same baseline at another place.
  - `movedGlyphs` returns original letters whose only match is the same
    character on the same baseline at a different place.
- **Partly covered drawings:** a device pass on each redacted page of the
  output, with `fillPath` and `strokePath` callbacks.
  1. Each path is split into its parts at each move step.
  2. A part's bounds are its points transformed by the path's matrix, grown by
     half the line width for strokes.
  3. Bounds are compared with each `Redaction.box` using the existing
     `overlap` helper and its `TOUCH` margin.
  4. A part that overlaps a box fails unless it is one of:
     - a single axis-aligned rectangle: move, three lines and close, with
       sides aligned in page space to within 0.01 pt;
     - a single straight line: move, line.

  A part still wholly under a box fails too, as a defence; MuPDF should
  already have removed it. Our own boxes are left out: a rectangle the size
  of a redaction box, to within 0.01 pt, is one of them. MuPDF grows a stroke
  by more than half its width (slice 3 Probe Findings), so a stroke this
  check finds wholly under a box can still be one MuPDF kept, and it is
  refused.

**Refusals.** Refusals carry a code and data (a page, and boxes), never
document text. The worker throws `WriteRefused` (in `write/common.ts`), which
replaces `CheckFailed`. The app turns each code into its sentence.

| Code | Raised | Trigger (today's site → new) | Data | Sentence | What the user can do |
| --- | --- | --- | --- | --- | --- |
| `unsupported-form` | when added | an `/XFA` entry in the catalog's `/AcroForm`, and no widget on any page | none | "This PDF is an XFA form, which can't be cleaned here." | Save it as an ordinary PDF in the app that made it |
| `prepare-failed` | when added, or while updating | preparation's own check fails; an annotation left after flattening (step 4); an object with no role, or another refusal of Appendix A.1; a `/VE` layer rule (step 2, or before step 5); a refusal of Appendix A.2 (a filter chain, data that can't be walked, image data outside an image); any exception during preparation (`inspect.ts:20` today) | page, if known | "This PDF can't be prepared for cleaning here." | None; the other documents carry on |
| `encrypted`, `open-failed` | when added | unchanged | none | unchanged | unchanged |
| `mark-lost` | Preview | `redact.ts:22` | page | "A mark on page N no longer matches the page. Mark it again." | Mark the text again |
| `extra-text-removed` | Preview | `check.ts:141` (missing letters) | page, boxes of the missing letters | "Cleaning would also remove unmarked text next to a mark on page N. The extra letters are highlighted." | Change or remove the mark |
| `text-moved` | Preview | `check.ts:141` (moved letters) | page | "Other text on page N would move in the cleaned file. This PDF can't be cleaned here yet." | None |
| `partly-covered-drawing` | Preview | new drawing check | page, the redaction box | "A box on page N covers part of a drawing. Cover the whole drawing with a margin around it, or remove the box." The margin is because MuPDF removes a stroke only when the box clears its miter allowance (slice 3 Probe Findings; owner, 25 Nov 2026) | Enlarge or remove the box |
| `check-failed` | Preview | `check.ts:131/133/135` (structure), `check.ts:144/147` (text or image under a box), `apply.ts:23` (no pages) | page, if known | "The cleaned file failed a check on page N. This PDF can't be cleaned here yet.", or with no page, "The cleaned file failed a check. This PDF can't be cleaned here yet." | None |
| `apply-failed` | Preview | `redact.ts:30`, `common.ts:24`, any other exception | none | "The marks could not be applied. Preview again." | Preview again |

A document whose re-preparation fails while updating is shown as refused with
its reason. Its marks are kept, its stale copy is never opened or exported,
and the other documents carry on.

"Apply and check" is renamed **Preview** everywhere: the button, messages and
tests.

### 7. Engine boundaries

- `engine/model` gains only format-neutral things:
  - the `ReaderTag` type;
  - the `RemovalKind` literals;
  - `text` on `TextPiece` and on `Edit`;
  - `lostPieces` and `reanchor`;
  - the refusal codes.
- New fallow zones, placed before `pdf` because zones match first:
  - `pdf-prepare-file` for `engine/pdf/prepareFile.ts`, which may import
    `model`, `pdf-protocol`, `pdf` and `pdf-prepare`;
  - `pdf-prepare` for `engine/pdf/prepare/**`, which may import `model` and
    `pdf`.

  `prepareDocument` returns a model-level `{ code: ReaderErrorCode }`, so the
  folder needs nothing from `pdf-protocol`. The allowlist walker
  (`engine/pdf/allowlist.ts`) and the shared structural check
  (`engine/pdf/structure.ts`) sit in zone `pdf`. Preparation runs the walker
  in strip mode, and `structure.ts` runs it in check mode, so both
  `pdf-prepare` and `pdf-write` can use them and nothing in `pdf` imports
  `pdf-prepare`.
- `engine/core` knows the working copy only as opaque derived bytes with a
  tag and a list of removed kinds. It never looks inside. It reads
  `READER_TAG` from `pdf-protocol`.
- **Per-document state** lives in a new Session slice, `slices/documents.ts`:
  `ReadonlyMap<DocumentId, { removed: readonly RemovalKind[]; lost: readonly number[]; failed?: ReaderErrorCode }>`.
  It is published as `SessionState.documentStatus` and filled by these
  changes:
  - `updateStarted` and `updateFinished`, which set and clear the operation
    `"updating"`;
  - `documentPrepared { document, removed, lost }`;
  - `preparationFailed { document, code }`;
  - `reanchored { document, marks, workingChanged }`, where `workingChanged`
    is true when the working copy's SHA-256 or its removed kinds differ from
    the stored ones, and always on the first migration from the root files.
- **The worker protocol:**
  - `inspect`/`inspected` become `prepare`/`prepared`, carrying
    `preparedBytes`, `reading`, `removed` and `readerTag`;
  - `refused` keeps its name;
  - `InspectionNumber` becomes `PreparationNumber`;
  - `open` takes the working bytes;
  - `ready` carries `readerTag`, which is required;
  - errors carry an optional `message` and the new codes and data.
- `Source "original"` keeps its name in the protocol. It now means the working
  copy, and the code comment says so. Renaming it would touch every render
  call for no change in behaviour.

### 8. The approval dialog and the marks panel (`app/`)

- **The approval dialog** lists the document's removed kinds, worked out
  from `SessionState.documentStatus` and carried by `ApprovalPlan.removed`,
  as plain lines under "Removed from this file", one per kind, using the
  sentences of Appendix A.3 in its order. For example: "Form data: made part
  of the page" and "Bookmarks: removed". It never shows values or counts. Approve has the focus, so Enter confirms.
- **Each kind is listed once per document** (owner, 25 Nov 2026). An
  approval that lands, confirmed or with no dialog, stores the document's
  current removed kinds in `project.json` as `removedSeen`, replacing the
  list before, and a later approval lists only kinds not in it. Cancelling
  stores nothing. A document can't be approved until its prepared files are
  read (`documentStatus` has it), so the list is never worked out from
  nothing; until then the gate refuses `approve` with `busy-updating`.
- **The dialog now opens** on every approval of a document with a removed
  kind not yet listed, as well as when the approval spreads or changes marks
  as today. In practice that is the first approval of almost every PDF, since
  nearly every PDF carries some metadata; a later approval, after an edit or
  another document's spread, opens it only for those reasons or a kind found
  by a new reader tag.
- **The marks panel is unchanged,** except that a lost mark's row shows a
  small "Mark again" label.
- **Approval and download work with no marks.**
- **A refusal with boxes** highlights them on the page view, until the user
  dismisses the refusal or previews again (owner, 25 Nov 2026).
- **While documents are rebuilt for a new reader tag,** the workspace shows
  "Updating documents…" in the existing engine status line.

### 9. The outside checker and the leak suite (`tests/oracle`, `tests/e2e`)

- **`raw.py`** keeps its own way of finding streams and strings, which is what
  makes it independent of pdfminer's parser. It decodes streams with
  pdfminer's decoders: Flate with predictors, LZW, ASCII85, ASCIIHex,
  RunLength, and chains of these (review answer 5). It also decodes `#xx`
  escapes in names, PDFDocEncoding, and UTF-16 with or without a byte-order
  mark. Its docstring says it shares decoding with pdfminer. It keeps each
  stream's undecoded bytes, the output of each filter of its chain, and a
  Flate layer's bytes after its zlib data's end (answer 10), as a decoder
  stops at its own end of data (slice 5).
- **New checks:**
  - **`structure`:** the checker's own allowlist. It reads the same vendored
    Arlington TSVs as the app's generator, with a walker of its own, and keeps
    its own keep-or-delete decisions, written in Python from this design's
    rules; it shares no code with the app (slice 2 answer 6). It applies
    every rule of Appendix A.1 as a check, a soft mask's colour space and
    parameters with no filter at their place included, and
    fails on an `Encrypt` left in the trailer. It returns a list of
    reasons, and passes when the list is empty.
  - **`drawings`:** no drawing part wholly under a box, and partly covered
    parts only as a single rectangle or line.
  - **`glyphs-absent`:** no glyph under a region, judged by position, for text
    with no Unicode map.
  - **`kept`:** each value is still in the output, where the raw scan reads,
    for a value kept by decision ("What preparation promises").
  - **`image-metadata`:**
    - no JPEG segment other than Adobe's APP14 among the APPn segments, and
      no COM segment in any J2K codestream;
    - no comment segment;
    - no bytes after the end-of-image marker;
    - no JPEG 2000 metadata boxes.
  - **`rendered`:** pypdfium2 renders each page of the input and the output in
    print mode with annotations, at 72 dpi. Pixels outside the marked boxes
    and outside each entry's declared exception areas (flattened annotations)
    must match within 8 levels per channel. Each leak-vector entry chooses
    whether it uses this check; entries whose fields have no stored look omit
    it.
- **Leak checks and keep checks.** Each check is one of two sorts:
  - **leak checks**, `absent`, `structure`, `drawings`, `glyphs-absent`,
    `image-metadata`, `metadata`, `covered` and `pixels`, prove something is
    gone;
  - **keep checks**, `present`, `kept`, `positions`, `unchanged` and
    `rendered`, prove something stayed.

  Every leak check must fail on the uncleaned fixture (its negative control),
  except `structure`, which may pass there where the fixture holds only kept
  keys, as a guard on what the app writes; an entry expecting a clean output
  needs at least one leak check that fails there. Keep checks pass on it by
  design (slice 5 answer 1).
- **The leak-vector list** is `tests/oracle/leak-vectors.json`. It is complete
  when it has:
  - one entry per rule path;
  - one entry per kept key of the object graph that can hold free text
    (not the kept bodies of "What preparation promises"), expecting
    `"kept"` (slice 5 answer 2);
  - one entry per refusal a synthetic file reaches (slice 5 answer 3).

  Entries that exercise the same strip path may share one fixture and one
  browser test, each with its own checks and negative control. The entry
  schema is in Detailed item 28.
- **Marks staying in place** are tested two ways:
  - unit tests for re-anchoring (Detailed item 16);
  - browser tests that open storage written by the pre-Phase-3 build, export,
    and have the checker confirm that marked values are gone and unmarked text
    is in place.

## Alternatives Considered

### From the brainstorm

#### Remove only the marked value inside each carrier, keeping it working

*   **Pros**: Forms stay fillable. Bookmarks, links and accessibility tags keep
    working.
*   **Cons**: Every carrier type needs its own value removal, fixtures and
    checks, and a kept carrier can still hold a value nobody marked.
*   **Reason for Rejection**: Rejected by author: users send out a copy to be
    read and printed, so a working form is worth little next to the risk and
    the cost. Flattening keeps every visible value instead.

#### Strip visible form fields and annotations outright

*   **Pros**: Simplest; nothing to flatten.
*   **Cons**: Filled forms come out blank, and stamps and signatures vanish.
*   **Reason for Rejection**: Rejected by author: remove only what is
    necessary, and never strip visible information blindly.

#### Let users choose which carriers to keep

*   **Pros**: Flexible for unusual needs.
*   **Cons**: Users must judge risks they cannot see, and every choice doubles
    the cases to test.
*   **Reason for Rejection**: Rejected by author: the product makes the
    decisions that keep users safe, and the approval dialog reports them.

#### Keep hidden-layer text, removing only marked values

*   **Pros**: Removes less.
*   **Cons**: Users would have to find and mark text they cannot see, which
    needs a special view and spreading into hidden text.
*   **Reason for Rejection**: Rejected by author: hidden-layer text changes
    nothing a reader sees, so it is removed. OCR text over a page picture is a
    separate mechanism, and it is kept.

#### Show hidden text in a special view (white, covered, clipped)

*   **Pros**: Would find text a careless or hostile author hid on the visible
    layer.
*   **Cons**: Reliable detection is hard, and the cases are uncommon in the
    professional files Phase 3 targets.
*   **Reason for Rejection**: Rejected by author for Phase 3. Tracked in
    [Sahil333/redactorator#34](https://github.com/Sahil333/redactorator/issues/34).

#### Cut vector drawings at the box edge, inside MuPDF

*   **Pros**: Removes exactly what is under the box, for any drawing.
*   **Cons**: Means rewriting path geometry, curves and stroke widths included,
    inside MuPDF.
*   **Reason for Rejection**: Rejected by author: MuPDF already removes every
    wholly covered part, and a refusal asks the user to cover the rest. The
    cutting work is not worth it for the cases left.

#### Remove every drawing a box touches

*   **Pros**: No refusals.
*   **Cons**: Erases table borders and row shading wherever a box touches
    them.
*   **Reason for Rejection**: Rejected by author: it removes visible content
    that holds nothing personal.

#### PDF.js as a second text reader in the app

*   **Pros**: An independent reader checks every real user's file.
*   **Cons**: A second PDF engine shipped to every user, and a second verifier
    to maintain.
*   **Reason for Rejection**: Rejected by author: the app stays MuPDF-only.
    Independence comes from the outside checker in the tests.

#### Remove the in-app check entirely

*   **Pros**: Less code; the proofs live in development.
*   **Cons**: Nothing would stop a wrong output on a real file that no fixture
    covers. On a real OCR document, the check already caught MuPDF removing an
    unmarked letter.
*   **Reason for Rejection**: Rejected by author: the gate stays, on the
    writer's own promises only.

#### A list of carriers to remove

*   **Pros**: Easy to read, with one entry per known carrier.
*   **Cons**: It can never be shown complete. Anything not on it survives,
    because garbage collection keeps every object something still points to.
*   **Reason for Rejection**: Rejected by author: an allowlist removes by
    default, and the leak-vector list is the test set that proves it.

#### Refuse signed files

*   **Pros**: Nothing to strip.
*   **Cons**: Signed returns and engagement letters are ordinary CPA files.
*   **Reason for Rejection**: Rejected by author: the signature data is
    stripped and the visible stamp kept. A redacted file cannot keep a valid
    signature anyway.

#### Refuse only dynamic XFA

*   **Pros**: Static XFA forms have real page content that could be cleaned.
*   **Cons**: Proving static and hybrid XFA adds a form type to the fixtures
    and checks.
*   **Reason for Rejection**: Rejected by author: refusing all XFA costs only
    those files, which are uncommon, and avoids a whole class of cases.
    Superseded in slice 2 (answer 7): 36 of 45 irs.gov files carry XFA, all
    hybrid, so hybrid forms are now flattened and only XFA-only forms are
    refused.

#### The certificate in Phase 3

*   **Pros**: Users get proof to hand on.
*   **Cons**: It is P1 (v1) work, and Phase 3 is limited to P0 leak fixes.
*   **Reason for Rejection**: Rejected by author: moved to v1.

### From drafting

#### Prepare when writing only, and leave the reading unchanged

*   **Pros**: The smallest change; marks don't move in Phase 3.
*   **Cons**: Form values and annotation text are not in the app's text, so a
    name typed into a form could not be marked as text or spread.
*   **Reason for Rejection**: Rejected by author: CPAs' forms are the main
    case, and spreading must reach their values.

#### Read from a flattened copy, show the original, and prepare again when writing

*   **Pros**: The view stays the original, and nothing heavy is kept.
*   **Cons**: Two runs of preparation must agree exactly, or marks drift, and
    the text layer comes from a different document than the picture under it.
*   **Reason for Rejection**: Rejected by author in favour of preparing once,
    saving the working copy, and using it for everything.

#### Prepare on every open, without saving the working copy

*   **Pros**: No second copy of each document, and no extra stored formats.
*   **Cons**: Preparation repeats each time a document opens. The view, the
    text and the output depend on each run coming out the same.
*   **Reason for Rejection**: Rejected by author: storage size is not a
    concern. The working copy is saved once and rebuilt only when the reader
    tag changes.

#### Leave print-only annotations out of the working copy, and add them back at export

*   **Pros**: Keeps the original's print-only behaviour.
*   **Cons**: Their text is never in the reading, so a marked value inside them
    survives in the output, and adding them back after redaction prints them
    over the boxes.
*   **Reason for Rejection**: Rejected by author: they are flattened like the
    rest, so their text can be marked.

#### Remove print-only annotations from the export

*   **Pros**: Simplest, and nothing unseen survives.
*   **Cons**: Print-only watermarks and stamps disappear from printouts.
*   **Reason for Rejection**: Rejected by author: it removes visible printed
    information, and flattening keeps them markable.

#### Our own content-stream parser for off-layer content

*   **Pros**: Exact, and no change to MuPDF.
*   **Cons**: A parser for PDF drawing commands to write and maintain. Its
    traps are inline images, nested tags and layer rules.
*   **Reason for Rejection**: Rejected by author in favour of a MuPDF patch
    that reuses MuPDF's own layer logic.

#### Redact the area of off-layer content

*   **Pros**: MuPDF only, little new code.
*   **Cons**: Hidden layers often sit on top of visible content.
*   **Reason for Rejection**: Rejected by author: those documents would be
    refused, or would lose visible content under the layer.

#### Our own per-image pixel blanking for clipped images

*   **Pros**: No MuPDF change.
*   **Cons**: Decodes and re-encodes images in our code, handles only the
    bounding box of a curved clip, and costs JPEG quality or file size.
*   **Reason for Rejection**: Rejected by author in favour of the MuPDF patch,
    which knows the exact shown area.

#### Blank only off-page pixels, and track clipped pixels as an issue

*   **Pros**: Uses what works today, with no new code.
*   **Cons**: Misses the common case: a picture cropped in Word or a layout
    tool keeps its hidden part.
*   **Reason for Rejection**: Rejected by author: it leaves a known, common
    leak in place.

#### Strip ActualText with `clean` or `sanitize`

*   **Pros**: Uses existing MuPDF save options.
*   **Cons**: The probe showed neither option removes marked-content
    properties.
*   **Reason for Rejection**: Not possible with MuPDF as it is. It is handled
    by the patch's `drop-mc-properties` option.

### From review

#### Bump `project.json` to version 4

*   **Pros**: An older build refuses the project as "newer", so it can never
    apply new offsets to its own reading.
*   **Cons**: The project no longer opens in an older build at all.
*   **Reason for Rejection**: Rejected by author: files are added, never
    replaced, so an older build still opens the project as it last saw it.

#### Store the list of lost marks in a derived file

*   **Pros**: The lost state is read rather than worked out.
*   **Cons**: Derived files are rebuilt and not always copied, so the list can
    vanish and a wrong mark goes unflagged.
*   **Reason for Rejection**: Rejected by author: the lost state is worked out
    from each piece's stored text, so it cannot be forgotten.

#### Re-anchor by exact box equality

*   **Pros**: Strict about place.
*   **Cons**: A change of a fraction of a point in how glyph boxes are read
    would lose every mark.
*   **Reason for Rejection**: Rejected by author: the candidates are already
    the characters inside the stored boxes, so matching letters in exactly one
    run is enough.

#### An allowlist for the structure only, with value rules below it

*   **Pros**: About 60 entries instead of about 300. A strict allowlist
    covers the trailer, catalog, page tree, pages and resources. Below them,
    known carrier keys are removed, along with any text string or stream not
    in a drawing role.
*   **Cons**: A private key whose value is a name or a number, under a font or
    an image, survives, silently, on a real user's file.
*   **Reason for Rejection**: Rejected by author: a full allowlist by role
    fails by breaking or refusing a file, which tests catch. The smaller rule
    fails by keeping data.

### From slice 2

#### A role table written by hand

*   **Pros**: No third-party data; the table reads as the specification.
*   **Cons**: It can never be shown complete. Slice 2 alone found objects it
    gave no role, such as `JBIG2Globals` streams and DeviceN's `Colorants`,
    and each gap refuses every file that holds it.
*   **Reason for Rejection**: Rejected by the owner (slice 2 answer 1): the
    role table is generated from the Arlington PDF Model, which covers every
    object type of PDF 2.0. Our decisions, what is kept and which kind a
    deletion records, stay ours.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| The third MuPDF patch cannot be built as designed, and three guarantees rest on it | Built in slice 1, and all three options pass their repro checks (Probe Findings, patch spike) |
| Flattening a signed signature widget drops the stamp | Probed in the spike: the stamp is kept and becomes page text. CUJ 2 is a browser test |
| A drawing wholly outside the page that turns a corner survives step 6 (Probe Findings, patch spike) | Accepted by the owner (25 Nov 2026): it is a vector drawing only, never text or pixels, and rare. No check or refusal for it; tracked under cutting line art at the box edge (Future Improvements) |
| Patch 0003 edits code the writer runs (image redaction's pixel code, and the content filter), so AGENTS.md asks for a leak fixture the outside checker judges | Oracle-judged leak-vector entries cover each edited branch and the corrected layer rules (Probe Findings, patch spike), and the writer's output is byte for byte unchanged on them |
| `bake` fails without saying so, and a widget or annotation stays live in the working copy | Slice 2 checks after step 4 that none is left, and refuses the document if one is |
| Blanked images make the working copy larger, since they are stored with Flate | Accepted as for image redaction; measured in the NFRs |
| Preparing a file with many partly hidden scans runs out of WebAssembly memory | Measured in the NFRs: the WebAssembly heap reached 344 MB for 5 half-hidden scans through steps 1 to 9, against MuPDF.js's 2 GB limit; 40 scans are measured only for steps 1 to 6 and 8 (865 MB resident). If the heap runs out, the save fails and preparation refuses the document, so nothing leaks. Today's image redaction grows the same way and peaks higher, so the owner accepts it (25 Nov 2026) |
| The drawing rule refuses many ordinary files | Grids, shading and barcodes pass, because MuPDF judges each part. The grid, shading, barcode and signature-stroke fixtures measure it (Detailed item 29) |
| Scanned pages with misplaced OCR boxes can leave parts of letters visible (#6), against PRD DOC-4 ("refused or flagged, never passed through silently") | Left to the OCR phase by the owner (25 Nov 2026). Recorded here as a known gap |
| On a scanned page with an invisible OCR text layer, a text mark's box is the OCR layer's box, which can be shorter than the scanned letters: the descenders of the marked letters (g, j, p, q, y) survive in the image just below the box. The pixels inside the box are blanked and the OCR text is removed. Nothing catches it: the gate checks only the text layer, and `rendered` compares pixels outside the boxes, where the leftover ink is unchanged from the original, so it passes. Found by the owner on a real scanned file | None in Phase 3. Kept as is by the owner (26 Nov 2026), and deferred to the OCR phase, which will size boxes from the scan itself (#6) |
| White, covered or clipped text keeps unmarked data (#34) | Out of Phase 3, named in the Overview, tracked in #34 |
| Text whose only Unicode mapping was its ActualText reads as other letters, so spreading misses it | A leak-vector fixture records the behaviour. Flagging such pages is deferred |
| The raw scan and pdfminer share stream decoders (slice 5), so one decoder bug could hide a value from both | Owner's choice (review answer 5). The raw scan keeps its own stream and string discovery |
| The app's allowlist and the checker's `structure` check read the same Arlington data, so a key the model wrongly lists for a type could pass both | Owner's choice (slice 2 answer 6; part 9). The two walkers and their decisions are written apart, and `absent` and `rendered` judge every entry independently of the model. They still share the model's reading and the rule for choosing a role (Appendix A.1), so a role chosen wrongly by both would pass. Read against each type's own keys in the model, the checker's keep sets equal the app's decisions for every type, apart from the trailer's `Encrypt`, which the checker fails by design (25 Nov 2026). A change to `allowlist-decisions.json` is made by hand in `structure.py`'s `KEEP` too; where the app then keeps a key the checker does not, the leak suite fails on any fixture that holds it |
| Storage grows: one working copy per document, and one folder per reader tag | Storage size is not a concern for the owner. Older tag folders could be pruned later (Future Improvements) |
| Most IRS forms carry XFA: 36 of 45 irs.gov files hold an `/XFA` entry, all beside normal fields | Hybrid forms are flattened and their XFA deleted (slice 2 answer 7); all 36 now prepare (NFRs, refusals). A form drawn by XFA alone is still refused |
| A soft mask's colour space other than `DeviceGray` refused files MuPDF draws (1 of the owner's 41 PDFs) | A one-channel space that reads as grey is rewritten as `DeviceGray` (slice 2 answer 8); that file now prepares. Any other array colour space on a soft mask still refuses (Appendix A.1) |
| A JPEG or JPEG 2000 image behind filters other than one Flate layer refused files (found on synthetic fixtures; no real file in the counts) | The lossless filters ahead of the image filter are undone (slice 2 answer 9). A chain with any filter outside that set before the image filter, or any filter after it, still refuses |
| Bytes after a stream's end of data survive step 8's save (probed, `data-after-end.pdf`) | Step 7 writes every kept stream whose filters are all lossless again from its decoded bytes, and step 8's save compresses them (slice 2 answer 10). MuPDF holds each decoded copy until that save, so the WebAssembly heap peak grows with the total decoded size of those streams: 344 MB for 5 half-hidden scans, as before answer 10, as the blanked scans are Flate. 40 such scans are not measured; if they do not fit, the rewrite can run in batches, each followed by a `compress` save and reopen. Streams kept as they are, so that bytes after their end of data remain a gap: any with a filter outside the lossless set (`CCITTFaxDecode`, `JBIG2Decode`, `Crypt`, an unknown name or a non-name), the lossless layers ahead of them included. The outside checker reads past a zlib stream's end only |
| MuPDF's stock `sanitize` drops or moves a few letters on some pages (NFRs, refusals): it loses a text-state reset made in an empty text object before a form is drawn (Probe Findings, slice 2) | Fixed by patch 0004 (slice 2 answer 11): the filter sends pending text state before a form is drawn. Step 9 still refuses a file whose text the filter changes in any other way, and the writer's gate an export |
| The browser's storage quota is reached while preparing | The write fails, that document is refused, and `writeOriginals` removes what it wrote. Other documents carry on |
| A rollback shows the project as it was before the upgrade | By design (part 3). Newer changes are kept for the next upgrade |
| The Arlington model misses a role, or a key, that real files use | A key the model does not list is deleted, never kept, so it can't leak. A drawing that needed it draws wrong, which the outside checker's `rendered` check catches on the fixtures; the gate's glyph check sees only text. An object that matches no role refuses its file. The model is pinned to one commit, and the refusal counts (NFRs) measure how often it refuses |
| An update of the vendored model changes what is kept | Only by updating `vendor/arlington/` and running the generator, whose output is reviewed as a diff, then `pnpm test` with every leak vector |
| MuPDF 1.28.6's `garbage` save writes a stream read from the file as a bare dictionary, without its data, when its dictionary holds a reference and is held elsewhere (Probe Findings, slice 3) | Real in stock MuPDF and not fixed upstream; patch 0005 fixes it (Detailed item 1c), and `0005-repro.mjs` fails without it. Step 7a is removed, so preparation relies on 0005: without it, `image-spaces.pdf` and `grey-soft-masks.pdf` are refused at step 9, which refuses any file that comes out wrong, and their leak entries fail. The writer resolves no stream before its save, and the gate now runs the structural check on its output. Leak entry `kept-soft-masked-image-when-written` judges a kept image after a write. For the owner: whether to backport upstream's MuPDF.js double-keep fix (b8d579fee), a memory leak that 0005 makes harmless to output |
| A rewritten image is stored as `[/ICCBased …]` with MuPDF's own profile, and PDFium draws a CMYK image's unmarked pixels up to 23 levels apart (Probe Findings, slice 3) | Found in slice 3; the behaviour predates Phase 3, and preparation's pixel blanking does the same. The samples are unchanged, and MuPDF draws the same. Accepted by the owner (25 Nov 2026): nothing leaks, and another reader's colour shift in the kept pixels is small. Keeping the image's own colour space would take a patch to `pdf-clean.c` |
| Preparing a long text document is slow and uses much memory | Measured in the NFRs ("Measured in slice 2"): most of it is the JavaScript heap of step 9, not the WebAssembly heap. If the worker dies of it, rather than MuPDF throwing, the preparation in flight settles as `worker-stopped` and the file is not added. Not optimised in slice 2; for the owner: does the 500-page cost matter? |
| A duplicate keeps the root `project.json` it copied, with the original's id, so a build from before reader tags lists two projects with one id | A rollback-only case that follows from never writing the root files. For the owner: what should happen to the duplicate id? |

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Privacy:**
    - There are no new outbound requests; preparation, reading and checks all
      run in the worker.
    - Removed kinds and refusals carry kinds, pages and boxes, never document
      text ([PRD](../PRD.md) RED-5; [REVIEW.md](../../REVIEW.md) step 2).
    - The working copy holds every marked value until export, so its name ends
      in `.not-redacted.pdf`. It is as private as the original, which sits
      next to it.
*   **Storage:** each document is stored at least twice, as the original and
    the working copy, plus one copy per reader tag the project has seen.
*   **Time and memory:**
    - Adding a file now includes preparation. Opening a project after a reader
      tag change re-prepares each document once.
    - Export no longer repeats preparation.
    - **Measured in the patch spike** (25 Nov 2026), in Node 24 on an Apple
      silicon Mac, with the patched MuPDF.js. Phase 3's own fixtures do not
      exist yet, so the spike generated stress files. The times cover the
      MuPDF steps 1 to 6 and 8. Step 7 (the allowlist) and step 9 (the
      check) were not written yet. Peak memory is the process's maximum
      resident size, which includes about 120 MB for Node and MuPDF alone.

      | Synthetic file | Time | Peak memory |
      | --- | --- | --- |
      | 500 pages of text, each with a typed note and a filled field (0.7 MB) | 4.6 s, 2.5 s of it in `bake` | 183 MB |
      | 20 full-page 300 dpi scans, all shown (4.8 MB) | 0.5 s | 180 MB |
      | 5 such scans, half past the page edge (1.2 MB in, 4.4 MB out) | 1.8 s | 287 MB |
      | 20 such scans (4.8 MB in, 17.9 MB out) | 7.1 s | 758 MB |
      | 40 such scans (9.7 MB in, 35.9 MB out) | 14.0 s | 865 MB |

      Without the patch's options, step 5 (`clean,sanitize` alone) takes
      0.2 s on the text file and 0.01 s on the scans. Blanking costs about
      0.35 s per blanked 300 dpi scan. Finding the placements draws every
      page twice, for viewing and for printing. A fully shown image is not decoded.
    - **Memory grows with the number of blanked images.** Natively, MuPDF
      frees each image's decoded pixels, and the peak stays at 168 MB for 5
      and for 20 such scans. In WebAssembly the heap never shrinks and
      fragments around the compressed data kept for each image, so the
      peak grows: by about 31 MB per scan up to 20, and 5 MB per scan from
      20 to 40. MuPDF.js's heap stops at 2 GB, so a file with many more
      partly hidden scans could fail to prepare and be refused. A first
      version that kept each blanked image decoded reached 1.3 GB on 5
      scans; the patch now keeps only the compressed data.
    - **Today's image redaction grows the same way, and peaks higher.**
      The writer's image pass (`REDACT_IMAGE_PIXELS`) with a box over each
      scan's hidden half, then its save, on the same files:

      | Half-hidden 300 dpi scans | Today's redaction, unpatched MuPDF | Today's redaction, patched MuPDF | `blank-unshown-pixels` |
      | --- | --- | --- | --- |
      | 5 | 392 MB | 391 MB | 287 MB |
      | 20 | 784 MB | 784 MB | 758 MB |
      | 40 | 1,348 MB | 1,349 MB | 865 MB |

      The owner accepts the growth, since the unpatched MuPDF shows it too
      (25 Nov 2026).
    - **Measured in slice 2** (25 Nov 2026), the whole of `prepareDocument`,
      steps 1 to 9, in Node 24 on an Apple silicon Mac, on the spike's stress
      files. Peak memory is the test process's maximum resident size, which
      includes about 150 MB for the test runner and MuPDF alone.

      | Synthetic file | Time | Peak memory | WebAssembly heap |
      | --- | --- | --- | --- |
      | 500 pages of text, each with a typed note and a filled field (0.7 MB) | 10.6 s | 1.5 to 1.8 GB | 38 MB |
      | 20 full-page 300 dpi scans, all shown (4.8 MB) | 0.5 s | 233 to 248 MB | 66 MB |
      | 5 such scans, half past the page edge (1.2 MB) | 2.4 s (3.7 s after answer 10) | 412 MB | 344 MB |

      The WebAssembly heap is MuPDF.js's memory after preparation, which
      never shrinks, so it is that heap's peak; MuPDF.js stops it at 2 GB.
      Peak memory varied between runs by the range shown. On the 500-page
      file, step 6 (finding content outside the page, then the four areas)
      takes 2.0 s and step 9 (reading every page of both files and comparing
      their glyphs) 4.6 s. The JavaScript heap peaks at 782 MB in step 9, and
      363 MB of it is still held after a forced collection, so the text file's
      cost is in the JavaScript heap, and it grows with the page count.
    - The worker holds one document per open file, as today: the working copy
      replaces the original.
*   **Refusals over real PDFs (25 Nov 2026):** `prepareDocument` on real
    files, read where they were and never copied into the repo, reported as
    counts by reason only.

    | Files | Prepared | `unsupported-form` (XFA) | `encrypted` | `prepare-failed`, step 7 (an object fits no role) | `prepare-failed`, step 9 (glyphs) |
    | --- | --- | --- | --- | --- | --- |
    | 41 of the owner's own PDFs, before answers 7 to 10 | 39 | 0 | 1 | 1 | 0 |
    | the same, after them | 40 | 0 | 1 | 0 | 0 |
    | 45 IRS forms, instructions and publications from irs.gov, before answers 7 to 10 | 8 | 36 | 0 | 0 | 1 |
    | the same, after them | 44 | 0 | 0 | 0 | 1 |
    | the same, with patch 0004 (answer 11) | 45 | 0 | 0 | 0 | 0 |

    - The step 7 refusal was an image's soft mask whose colour space was a
      one-channel ICC profile; answer 8 rewrites it as `DeviceGray`.
    - All 36 XFA files are hybrid forms that also hold AcroForm fields; under
      answer 7 they prepare and pass step 9.
    - The step 9 refusal is MuPDF's own `sanitize`: on one page of 126 it
      drops 7 letters and moves 1, out of about 4,000, with or without patch
      0003's options. The file is refused, so nothing leaks. The cause is in
      Probe Findings ("`sanitize` loses a text state a form inherits");
      with patch 0004 the file prepares.
*   **Rollback:** an older build opens the project as it last saw it (part 3).
    Nothing it relies on is rewritten.

--------------------------------------------------------------------------------

### Additional Resources

*   [PRD](../PRD.md), [HLD](../HLD.md) and
    [Implementation Plan](../Implementation-Plan.md), Phase 3.
*   [AGENTS.md](../../AGENTS.md) and [REVIEW.md](../../REVIEW.md).
*   Issues [Sahil333/redactorator#34](https://github.com/Sahil333/redactorator/issues/34)
    and [Sahil333/redactorator#6](https://github.com/Sahil333/redactorator/issues/6).
*   [vendor/mupdf/README.md](../../vendor/mupdf/README.md), for patches 0001
    and 0002.
*   **Doc changes for the owner, which this design makes necessary:**
    - `docs/HLD.md:37`: the writer's input is now the working copy;
    - `docs/HLD.md:377-387`: the storage layout gains the reader-tag folders;
    - `docs/Implementation-Plan.md:186`: outputs are built from the working
      copy, not the original;
    - `docs/HLD.md:234-247`: the verifier wording, now the gate plus the
      outside checker.

### Future Improvements

*   **Pruning older reader-tag folders** once no supported build reads them.
*   **Flagging scanned pages in review** (#6), if the OCR phase slips.
*   **Flagging text whose only mapping was ActualText.**
*   **Taking image fingerprints from the original image**, so box spreading
    matches cropped copies of the same image.
*   **Cutting line art at the box edge**, if refusals prove common. It would
    also remove a drawing that lies wholly outside the page but turns a
    corner, which step 6 keeps (Probe Findings, patch spike).
*   **Batch export.**

--------------------------------------------------------------------------------

## Detailed Implementation Plan

The work lands in five slices. Each slice ends with `pnpm test` green, and
every write-path change comes with a fixture the outside checker judges
([AGENTS.md](../../AGENTS.md)). Each item below names its slice, and this
summary matches those tags.

| Slice | Content | Items |
| --- | --- | --- |
| 1 | **The patch spike:** patch 0003, the rebuild, the hand-run repro scripts, and the probes for the signed widget and the straddling path. The existing browser tests must pass on the rebuilt MuPDF. The first leak-vector entries, for the write-path branches the patch edits, the corrected layer rules and the text the content filter drops, and the oracle's `rendered` check | 1–2, 27–29 and 31 (those entries and `rendered` only) |
| 2 | **Preparation, reading, storage and anchoring:** the protocol change together with its test fakes, the golden files re-recorded, the first anchoring test, and the allowlist's role table generated from the Arlington PDF Model | 1b, 2 (for patch 0004), 3–10, 12 (slice 2 parts), 13–20, 26 (the add-time sentences), 21 (`facade.ts`, `open.ts`, `readings.ts`, `add.ts`), 22–24, 27 (`structure`, `image-metadata`, and `rendered` with `init_forms()`), 28–29 (preparation vectors), 31 (entries with no mark), 32 (first case), 33 (fakes and protocol), 35, 36–37 |
| 3 | **The writer and the gate:** patch 0005, refusal codes and their app sentences, Preview, zero-mark export, `textMoved` removed | 1c, 2 (for patch 0005), 11, 12 (`textMoved` removed), 21 (`apply.ts`), 26 (refusal parts), 28 (`structure` back on marked entries; patch 0005's entry), 29 (`tall-letter-boxes`, `signature-stroke`), 32 (second case), 33 (the rest) |
| 4 | **The approval dialog:** removed kinds shown on approval, each once per document | 21 (`plan.ts` and the files it lists), 25, 26 (status part) |
| 5 | **The rest of the leak suite:** the manifest, the meta-test and the remaining fixtures, whose free-text entries cover kept object-graph keys only, not kept bodies ("What preparation promises"); every leak vector passes | 27–31 |

Item 34, the directory READMEs, lands in every slice.

Slice 2 keeps `textMoved` next to the new `missingGlyphs` and `movedGlyphs`,
so `write/check.ts` still builds. Slice 3 removes it. Slice 2's `fail()`
keeps its message parameter, made optional, so `apply.ts` still builds until
slice 3.

Before Phase 3 merges, `leak-suite.spec.ts` must pass on the patched build.

### Target Files to Create/Modify

#### 1. `vendor/mupdf/patches/0003-Content-filter-options-for-redaction.patch` (Create) — slice 1

*   **Type / Scope**: C patch to MuPDF 1.28.6, made with `git format-patch`
    (`build.sh` applies patches with `git am`). It touches
    `source/pdf/pdf-op-filter.c`, `source/pdf/pdf-clean.c` (pixel
    blanking), the save-option parser in `source/pdf/pdf-write.c`,
    `source/pdf/pdf-layer.c` (the layer rule fix), `source/pdf/pdf-imp.h`,
    and the headers that declare the filter and write options
    (`include/mupdf/pdf/interpret.h`, `document.h`). Done in the spike.
*   **Proposed Changes**: the three options of part 5: `drop-hidden-oc`,
    `drop-mc-properties` and `blank-unshown-pixels`, and the fix to layer
    rules (Probe Findings, patch spike).

#### 1b. `vendor/mupdf/patches/0004-Send-pending-text-state-before-a-form-XObject.patch` (Create) — slice 2

*   **Type / Scope**: C patch to MuPDF 1.28.6, on top of 0001 to 0003. It
    touches `source/pdf/pdf-op-filter.c` only.
*   **Proposed Changes**: `pdf_filter_Do_form` sends any pending `Tc`, `Tw`,
    `Tz`, `Tr` and `Ts` after its `filter_flush`, so a form inherits the
    text state in force where it is drawn. A pending `Tf` or `TL` is not
    sent, a remaining gap that step 9 and the writer's gate still catch as
    moved glyphs (slice 2 answer 11; Probe
    Findings, "`sanitize` loses a text state a form inherits"). With it:
    `vendor/mupdf/upstream/0004-bug-report.md` and `0004-repro.mjs` (which
    checks both the `sanitize` save and a redaction applied inside the
    form, failing on the build without 0004), the README row, a rebuilt
    `package/dist` and new `SHA256SUMS`, and two leak entries on
    `inherited-text-state.pdf`: `form-inherits-text-state` (preparation)
    and `form-inherits-text-state-when-written` (a mark inside the form,
    written by the writer).

#### 1c. `vendor/mupdf/patches/0005-Keep-a-stream-s-data-when-garbage-collection-renumbe.patch` (Create) — slice 3

*   **Type / Scope**: C patch to MuPDF 1.28.6, on top of 0001 to 0004. It
    touches `source/pdf/pdf-write.c` only.
*   **Proposed Changes**: `renumberobjs` calls
    `pdf_xref_ensure_incremental_object` before `pdf_update_object` stores a
    renumbered copy, so the object's entry keeps its stream (slice 3 Probe
    Findings). With it:
    - `vendor/mupdf/upstream/0005-bug-report.md`, a comment for MuPDF bug
      709830;
    - `0005-repro.mjs`, which fails on stock 1.28.6 and on 0001 to 0004;
    - the README row, the rebuilt `package/dist` (only `mupdf-wasm.wasm`
      changes) and new `SHA256SUMS`;
    - leak entry `kept-soft-masked-image-when-written` on `image-spaces.pdf`.

#### 2. Vendored build files (Modify / Create) — slice 1

*   **Type / Scope**: Vendored build.
    - Modify: `vendor/mupdf/README.md`, `vendor/mupdf/SHA256SUMS`,
      `vendor/mupdf/package/dist/*`.
    - Create: `vendor/mupdf/upstream/0003-feature-request.md`,
      `vendor/mupdf/upstream/0003-pull-request.md`,
      `vendor/mupdf/upstream/0003-repro.mjs`.
*   **Proposed Changes**:
    - **README:** add patch 0003 to the table, and update the "Rebuilding"
      and "Removing" notes.
    - **Rebuild:** run `./build.sh`. Its final `shasum -c` runs under
      `set -e`, so it is expected to fail. Then regenerate the sums with
      `shasum -a 256 package/dist/* > SHA256SUMS`, and re-run
      `shasum -c SHA256SUMS`.
    - **The `0003-` prefix** is intended. Patch 0002's files stay unprefixed
      as they are.
      - `0003-feature-request.md` describes the three options for MuPDF's
        bug tracker.
      - `0003-pull-request.md` is the pull-request text.
      - `0003-repro.mjs`, run by hand, prints PASS or FAIL for each option's
        synthetic case and exits non-zero if any fails.
    - **The spike's results** go into the design's Probe Findings and NFRs:
      the signed widget, the straddling path, timing and memory.

#### 3. `engine/pdf/prepare/index.ts` (Create) — slice 2

*   **Type / Scope**: TypeScript, worker, zone `pdf-prepare`.
*   **Proposed Changes**:
    `prepareDocument(bytes): { preparedBytes, reading, removed: readonly RemovalKind[] } | { code: ReaderErrorCode }`.
    `removed` is sorted and holds no repeats. It runs the nine steps of
    part 1. Step-to-file map:

    | Step | File |
    | --- | --- |
    | 1 and 8 | `prepare/index.ts`, saving and opening through `prepare/reopen.ts` |
    | 2–4 | `prepare/annotations.ts`, with the layer rules in `prepare/layers.ts` |
    | 5–6 | `prepare/page.ts`, with the layer rules in `prepare/layers.ts` |
    | 7 | `engine/pdf/allowlist.ts`, strip mode, with the image cutting in `engine/pdf/imageData.ts` |
    | 9 | `prepare/check.ts` |

    Saves use exactly the option strings given in part 1. Any exception
    returns `prepare-failed`. Step 1 records `old-revisions`.

#### 4. `engine/pdf/prepare/annotations.ts` (Create) — slice 2

*   **Type / Scope**: TypeScript, worker.
*   **Proposed Changes**:
    - Steps 2–4: delete annotations by the flag and layer rules of part 1
      step 2, including the OCG/OCMD rule with `BaseState`, and refusing
      `/VE` as `prepare-failed`.
    - Flatten with `bake(true, true)`, then save with `""` and reopen, and
      refuse as `prepare-failed` when a page still lists an annotation or a
      widget (step 4).
    - Record the kinds `annotations`, `pending-redactions`, `form-data`,
      `signatures`, `links` (link annotations) and `attachments`
      (file-attachment annotations) as they apply.

#### 5. `engine/pdf/allowlist.ts` (Create) — slice 2

*   **Type / Scope**: TypeScript, worker, zone `pdf`.
*   **Proposed Changes**:
    - A walker from the trailer that gives each object its role from the
      generated role table (item 37), by the rules of Appendix A.1.
    - **Strip mode** (`stripToAllowlist`) deletes keys not allowed for the
      role and returns the kinds of what it deleted, or `"refused"` where
      A.1 refuses the file, which step 7 answers as `prepare-failed`.
    - **Check mode** (`keyOutsideAllowlist`) returns the first key outside
      the allowlist as a path of keys from the trailer, with
      `" (image data)"` after an image whose data still holds metadata and
      `" (a filter over image data)"` after an image still behind another
      filter, or `"unplaced"` wherever A.1 or A.2 refuses the file.
      It reports a trailer `Encrypt` too, which strip mode keeps until step
      8.
    - The catalog's `/Names` records a kind per tree it holds (slice 2
      answer 2), from `NAME_TREES` in `allowlist.ts`, as A.1's `Catalog` row
      says. The leak suite checks the kind each carrier records, so
      `carriers.pdf`'s named destination and embedded file test it; its
      script shares `scripts-actions` with the file's actions, so the
      `JavaScript` tree's kind is not tested apart.
    - Keys the file chooses are looked up as the table's own keys only, so a
      key named after a JavaScript built-in, such as `/constructor`, is
      deleted like any other (`structure-keys.pdf`).
    - JPEG and JPX cutting per Appendix A.2, with `readRawStream` and
      `writeRawStream`; the segment and box walks are in
      `engine/pdf/imageData.ts` (`cutJpeg`, `cutJpx`).

#### 6. `engine/pdf/prepare/page.ts` (Create) — slice 2

*   **Type / Scope**: TypeScript, worker.
*   **Proposed Changes**:
    - **Step 5:** first run the scan described in part 1 ("What was
      removed"): a device pass over each page, and a walk of the content
      streams its resources reach. It records `hidden-layers`,
      `marked-content`, `unshown-image-pixels` and, for a PostScript
      XObject, `app-data`, and refuses a `/VE` layer rule. The five
      `marked-*.pdf` leak entries check the `marked-content` kind it records.
      Then save with
      `clean,sanitize,drop-hidden-oc,drop-mc-properties,blank-unshown-pixels`
      and reopen.
    - **Step 6:**
      1. record `outside-page` when any glyph or drawing part lies wholly
         outside the visible page;
      2. add the four outside areas in MuPDF page space;
      3. call the exact `applyRedactions` of part 1.

#### 7. `engine/pdf/prepare/check.ts` (Create) — slice 2

*   **Type / Scope**: TypeScript, worker.
*   **Proposed Changes**: step 9.
    - `missingGlyphs` and `movedGlyphs` compare the user's original file with
      the working copy on every page, both read with `READING_OPTIONS`, with
      glyphs outside the crop box excluded.
    - Then `checkStructure` runs.

#### 8. `engine/pdf/inspect.ts` → `engine/pdf/prepareFile.ts` (Rename) — slice 2

*   **Type / Scope**: Worker request handler, zone `pdf-prepare-file`.
*   **Proposed Changes**: answers `prepare { preparation, bytes }`, which
    replaces `inspection`. It calls `prepareDocument`, then posts either
    `prepared { preparation, preparedBytes, reading, removed }`, with the
    bytes transferred, or `refused { preparation, error }`.

#### 9. `engine/pdf/readingOptions.ts` (Create), `engine/pdf/text.ts` (Modify) — slice 2

*   **Type / Scope**: Worker.
*   **Proposed Changes**:
    - `readingOptions.ts` exports
      `READING_OPTIONS = "preserve-whitespace,ignore-actualtext"`. It imports
      nothing, so tests can use it without loading MuPDF.
    - `text.ts`'s `readText` uses it.

#### 10. `engine/pdf/worker.ts`, `engine/pdf/handler.ts`, `engine/pdf/state.ts`, `engine/pdf/messages.ts` (Modify) — slice 2

*   **Type / Scope**: Worker.
*   **Proposed Changes**:
    - `ready` carries `READER_TAG`.
    - The handler routes `prepare` in place of `inspect`.
    - `state.ts` holds the working copy. Its field `original` is renamed
      `working`, with a comment that `Source "original"` means the working
      copy.
    - `fail()` in `messages.ts` takes a code, optional data and an optional
      message. Slice 3's callers pass no message.

#### 11. `engine/pdf/write/redact.ts`, `engine/pdf/write/check.ts`, `engine/pdf/write/common.ts`, `engine/pdf/write/index.ts`, `engine/pdf/apply.ts` (Modify) — slice 3

*   **Type / Scope**: Write path.
*   **Proposed Changes**:
    - `CheckFailed` becomes `WriteRefused { code: WriterErrorCode; data }`.
    - Every failure site maps to a code, as in the part 6 table.
    - `redactionsByPage` runs the guard: `rangeText` at each edit's offsets
      must equal `edit.text`.
    - `check.ts`:
      - uses `checkStructure`, `missingGlyphs` and `movedGlyphs`, and stops
        importing `textMoved`;
      - adds `partlyCoveredDrawings` with the geometry of part 6, on pages
        with redactions only;
      - reads with `READING_OPTIONS`.
    - `apply.ts`:
      - with zero edits, runs `checkStructure` on the working copy, posts
        `document.bytes.slice()`, and sets `document.output` to a fresh
        `openPdf` of that copy, with its model from `documentModel`;
      - posts `{ code, data }` with no `message`. `data.page` is a 0-based
        `PageIndex`.
    - A text mark's box is trimmed above and below clear of the letters no
      mark removes, never into its own ink band: on lines set closer than
      their font's height, the full height covered a kept word on the next
      line, and the gate refused the export (done in slice 2 at the owner's
      request; leak entry `mark-wrapping-onto-a-tight-line` on
      `tight-lines.pdf`).
    - `redact.ts` deletes the empty `/Annots` array its redaction areas leave
      behind, which the outside checker's `structure` check rejects (found in
      slice 2; the leak entries with a mark skip `structure` until then).
    - The writer reads the images it draws and saves with `garbage=4`, so it
      meets the garbage-renumber bug of the slice 2 Probe Findings (Risks).

#### 12. `engine/pdf/glyphs.ts`, `engine/pdf/glyphs.test.ts`, `engine/pdf/structure.ts` (Modify, Modify, Create) — slices 2 and 3

*   **Type / Scope**: Shared worker code, zone `pdf`.
*   **Proposed Changes**:
    - **Slice 2:**
      - move `glyphsOf` from `write/check.ts` into `glyphs.ts`, given the
        reading options as a parameter instead of its hard-coded
        `"preserve-whitespace"`, and add `origin` to `PageGlyph`;
      - add `missingGlyphs` and `movedGlyphs` as in part 6, with unit tests;
      - create `structure.ts`, exporting `checkStructure(document)`. It runs
        `allowlist.ts` in check mode, plus the revision, encryption,
        annotation and form checks.
    - **Slice 3:** remove `textMoved` and its tests.

#### 13. `engine/pdf-protocol/messages.ts`, `engine/pdf-protocol/parse.ts` (Modify) — slice 2

*   **Type / Scope**: Worker protocol.
*   **Proposed Changes**:
    - Export `READER_TAG = "pdf-3"`.
    - `inspect`/`inspected` become `prepare`/`prepared`, and
      `InspectionNumber` becomes `PreparationNumber`. `refused` stays.
    - `ready` gains the required `readerTag`.
    - `PdfError` becomes
      `{ code; message?; data?: { page?: PageIndex; boxes?: readonly Box[] } }`.
    - `engineErrorCodes` gains `unsupported-form`, `prepare-failed`,
      `mark-lost`, `extra-text-removed`, `text-moved` and
      `partly-covered-drawing`.
    - `parse.ts` rejects a code not in that list, and any `data` key other
      than `page` and `boxes`.

#### 14. `engine/model/document.ts`, `engine/model/errors.ts`, `engine/model/parse.ts`, `engine/model/marks.ts` (Modify) — slice 2

*   **Type / Scope**: Format-neutral model.
*   **Proposed Changes**:
    - `TextPiece` gains `text: string`, where `""` means unknown and so
      lost. The text `Edit` gains `text`, and `toEdits` copies each piece's
      text.
    - New `ReaderTag`, a branded string.
    - New `RemovalKind`, the union of the literals in Appendix A.3.
    - `ReaderErrorCode` gains `unsupported-form` and `prepare-failed`.
    - `WriterErrorCode` gains `mark-lost`, `extra-text-removed`,
      `text-moved` and `partly-covered-drawing`.
    - Parsers for each.

#### 15. `engine/model/selection.ts`, `engine/model/spread.ts` (Modify) — slice 2

*   **Type / Scope**: Model.
*   **Proposed Changes**:
    - `TextPieceRange` becomes `Omit<TextPiece, "boxes" | "text">`, so the
      app never supplies text.
    - `textTarget` and the spread marks fill each piece's `text` with
      `rangeText` when the mark is made.

#### 16. `engine/model/textAnchor.ts`, `engine/model/textAnchor.test.ts` (Create) — slice 2

*   **Type / Scope**: Format-neutral model, with unit tests. The owner allowed
    unit tests here, alongside the browser tests.
*   **Proposed Changes**:
    - `lostPieces(target: TextTarget, texts: ReadonlyMap<PageIndex, PageText>): readonly number[]`
      returns the indexes of pieces whose `rangeText` differs from their
      `text`, or whose `text` is `""`.
    - `reanchor(target: TextTarget, texts: ReadonlyMap<PageIndex, PageText>): TextTarget | "lost"`
      applies the search of part 4 to each lost piece.
    - `migratePieces(target, oldTexts: ReadonlyMap<PageIndex, PageText> | undefined): TextTarget`
      fills piece text when migrating from a project with no piece text.
    - Tests cover:
      - a mark on one line, across lines (line ends included), and across
        pages;
      - the same word twice on a page, inside and outside the boxes;
      - characters added or removed before the mark;
      - boxes shifted by 0.3 pt;
      - a flattened form value;
      - two equal ranges inside the boxes, which stays lost;
      - a mark that is not found;
      - migrating a one-piece mark, a multi-piece mark, and a multi-piece
        mark whose old text is missing.

#### 17. `engine/core/formats/project.ts`, `engine/core/formats/project.test.ts` (Modify) — slice 2

*   **Type / Scope**: Stored formats.
*   **Proposed Changes**:
    - `PROJECT_VERSION` stays 3. `parsePiece` reads an optional `text`, and
      a missing one parses as `""`; only `migratePieces` fills it.
    - `TEXT_VERSION` becomes 2, written only inside tag folders as
      `{ readerTag, removed, pages }`. Version 1 is still parsed, for the
      migration. `parseTexts` returns `{ pages, readerTag?, removed? }`.
    - Tests: round-trips, version 1 parsed, a missing piece text, a newer
      file, a damaged file.

#### 18. `engine/core/stored/projects.ts` (Modify) — slice 2

*   **Type / Scope**: Store access.
*   **Proposed Changes**:
    - Every path helper takes the tag, and the paths live under
      `.redactorator/<tag>/`: `project.json`, `text/<id>.json`,
      `images/<id>.json` and `working/<id>.not-redacted.pdf`.
    - `findProjectFile(folder, tag)` implements part 3. "Newest" means the
      highest `pdf-N` by number below the current tag.
    - `readProject` reads through `findProjectFile`. `saveProject` writes
      only the current tag folder.
    - `migrateToTag(folder, tag, source)` copies the source project file into
      the tag folder, reads the older text records, and calls `migratePieces`
      on every text mark.
    - `writeOriginals` writes the working copy, text and images into the tag
      folder, and adds all three paths to its `started` cleanup list.
    - The project listing, rename and archive use the helpers above.
    - `duplicateProject` (172–179), import (212–218) and move (253, 300)
      copy the whole `.redactorator/` folder, then re-identify only inside
      the current tag folder. Move and import find the project through
      `findProjectFile`.

#### 19. `engine/core/intake.ts`, `engine/core/pdf-client/client.ts`, `engine/core/pdf-client/errors.ts` (Modify) — slice 2

*   **Type / Scope**: Core.
*   **Proposed Changes**:
    - `client.prepare(bytes)` replaces `inspect`.
    - The client compares the first `ready`'s `readerTag` with `READER_TAG`,
      and stops the worker as `unexpected-reply` if they differ.
    - `ClientError` gains `data`.
    - Intake copies `preparedBytes`, `removed` and the tag onto each
      `NewDocument`. It stores nothing itself.

#### 20. `engine/core/session/effects/reprepare.ts` (Create) — slice 2

*   **Type / Scope**: Core effect. It is the only code that re-prepares.
*   **Proposed Changes**:
    - `reprepare(document)` re-prepares one document:
      1. read the user's original file;
      2. call `client.prepare`;
      3. save its working copy, text and images into the tag folder;
      4. compute `lost` with `lostPieces`, and re-anchor the lost marks with
         `reanchor`;
      5. dispatch `documentPrepared { document, removed, lost }`, and, if its
         marks or working copy changed, `reanchored { document, marks, workingChanged }`.
    - `updateProject()` dispatches `updateStarted`, runs `reprepare` one
      document at a time for every document whose tag-folder files are
      missing or damaged (on the first open under a new tag, that is every
      document), then dispatches `updateFinished` and saves the project
      through the save effect. That save writes the tag folder (item 18).
    - A document that fails dispatches `preparationFailed { document, code }`,
      and the rest carry on.

#### 21. `engine/core/session/facade.ts`, `engine/core/session/effects/open.ts`, `engine/core/session/effects/readings.ts`, `engine/core/session/effects/add.ts`, `engine/core/session/effects/apply.ts`, `engine/core/session/effects/plan.ts` (Modify) — slices 2–4

*   **Type / Scope**: Core effects.
*   **Proposed Changes**:
    - `facade.ts` (slice 2):
      - after the Session's own `opened` change (`session/changes.ts`), it
        reads every document's tag-folder text record;
      - it runs `lostPieces` on every text mark, re-anchors each lost one,
        and dispatches `documentPrepared` with the result for each document,
        plus `reanchored` where marks changed;
      - it starts `updateProject` when the tag folder was just created or any
        tag-folder file is missing or damaged;
      - `close()` waits for the update.
    - `open.ts` (slice 2):
      - opens `working/<id>.not-redacted.pdf`;
      - while updating, returns `busy-updating`;
      - for a document whose re-preparation failed, returns `prepare-failed`;
      - when a working copy is missing outside an update, starts
        `updateProject` and returns `busy-updating`;
      - never opens the user's original file.
    - `readings.ts` (slice 2): `readingOf` reads only the tag folder's text and
      images. On a missing or damaged file it throws `ReadingUnavailable`, and
      the facade starts `updateProject`. It never re-prepares.
    - `add.ts` (slice 2): saves the prepared files through `writeOriginals`.
    - `apply.ts` (slice 3): builds edits with piece text, and passes refusal
      codes and data through. A document with a lost mark is refused with
      `mark-lost` before the worker is asked.
    - `plan.ts` (slice 4): passes the document's removed kinds, from
      `documentStatus`, to `approve`, and dispatches `planned` whenever
      `Approval.removed` is not empty, so the approval dialog opens.
      `engine/core/session/gate.ts` refuses `approve` for a document with no
      `documentStatus` entry yet.
    - With it (slice 4): `ProjectDocument.removedSeen` in
      `engine/model/project.ts`, read as `[]` when missing by
      `engine/core/formats/project.ts`; `approve` in
      `engine/model/spread.ts` takes `removed`, stores it as the approved
      document's `removedSeen`, and returns the kinds not in it before as
      `Approval.removed`; `ApprovalPlan.removed` in `engine/api/state.ts`
      carries them to the app. The golden `expected/` and `expected-old/`
      project files are recorded again (owner, 25 Nov 2026).
    - Tests (slice 4): `tests/e2e/approval.spec.ts` (the list, its order,
      focus, once per document across a reload, cancel, no dialog when
      nothing was removed, approval held until the prepared files are read);
      the status line in `anchoring.spec.ts`; `approve` and `approvalLands`
      in `tests/e2e/app.ts`; `removedSeen` read and written in
      `engine/core/formats/project.test.ts`.

#### 22. `engine/core/session/changes.ts`, `engine/core/session/gate.ts`, `engine/core/session/selectors.ts`, `engine/core/session/slices/index.ts`, `engine/core/session/slices/documents.ts`, `engine/core/session/slices/operation.ts`, `engine/core/session/slices/history.ts`, `engine/core/session/slices/marks.ts` (Modify, `documents.ts` Create) — slice 2

*   **Type / Scope**: Core state.
*   **Proposed Changes**:
    - **New changes:** `updateStarted`, `updateFinished`, `documentPrepared`,
      `preparationFailed` and `reanchored`. `reanchored` is listed in
      `changesRecord`, so it is saved.
    - **`slices/documents.ts`** holds the per-document map of part 7.
    - **`operation`** gains `"updating"`, set by `updateStarted` and cleared
      by `updateFinished`.
    - **`reanchored`:**
      - in `marks`, it replaces the document's marks without bumping the edit
        count;
      - in `history`, it clears that document's undo history;
      - in the review state, if `workingChanged` is true or the marks differ,
        it sets `review` to `"in-review"`;
      - it does not change the download state.
    - **The gate**, while updating, refuses `add`, `mark`, `history`,
      `open`, `apply`, `approve`, `confirm`, `addDocuments` and
      `markDownloaded` with `busy-updating`.
    - **`selectors.ts`** publishes `SessionState.documentStatus`.

#### 23. `engine/api/state.ts`, `engine/api/errors.ts` (Modify) — slice 2

*   **Type / Scope**: Public contract.
*   **Proposed Changes**:
    - `SessionState` gains
      `documentStatus: ReadonlyMap<DocumentId, { removed: readonly RemovalKind[]; lost: readonly number[]; failed?: ReaderErrorCode }>`,
      and `operation` gains `"updating"`.
    - `ErrorCode` gains `busy-updating` and the new refusal codes.
    - `EngineError.data` widens to
      `Record<string, string | number | readonly Box[]>`. `page` stays a
      0-based number.

#### 24. `.fallowrc.json` (Modify) — slice 2

*   **Type / Scope**: Boundaries.
*   **Proposed Changes**:
    - Zones `pdf-prepare-file` (`engine/pdf/prepareFile.ts`) and
      `pdf-prepare` (`engine/pdf/prepare/**`), placed before `pdf`, with the
      imports given in part 7.
    - `pdf` may import `pdf-prepare-file`, as it does `pdf-apply`.
    - `engine/pdf/allowlist.ts` and `structure.ts` stay in zone `pdf`.

#### 25. `app/ApproveDialog.tsx`, `app/ProjectView.tsx` (Modify) — slice 4

*   **Type / Scope**: UI.
*   **Proposed Changes**:
    - `ApproveDialog` reads the kinds to list from the plan
      (`ApprovalPlan.removed`), which the engine works out with the kinds
      already listed, so `ProjectView` passes nothing new.
    - The dialog shows a "Removed from this file" section, listing the kinds
      with the sentences of Appendix A.3 in its order, when the plan's
      `removed` is not empty. Approve takes the focus once the dialog opens.

#### 26. App UI files (Modify) — slices 2, 3 and 4

*   **Type / Scope**: UI.
*   **Files:**
    - `app/errors.ts`, `app/useEngineError.ts`, `app/useHandOffFocus.ts`;
    - `app/PageView.tsx`, `app/PageList.tsx`, `app/MarksPanel.tsx`;
    - `app/TopBar.tsx`, `app/ProjectView.tsx`, `app/Workspace.tsx`;
    - `app/engineStatus.ts`.
*   **Proposed Changes**:
    - **Refusals when a file is added (slice 2):** `errors.ts` gains the
      sentences for `unsupported-form` and `prepare-failed`, which
      `open-pdf.spec.ts` asserts.
    - **Refusals (slice 3):**
      - `errors.ts` has one sentence per code, as in the part 6 table, and
        shows pages as `page + 1`;
      - `useEngineError.failed` accepts an error with no `message` when its
        code has a sentence;
      - `ProjectView` passes the failed Preview's `data.boxes` through
        `PageList` to `PageView`, which highlights them on `data.page`;
      - `MarksPanel` shows "Mark again" on a lost mark's row.
    - **Preview (slice 3):**
      - `TopBar`'s "Apply and check" becomes "Preview";
      - the button is enabled with no marks: drop `!editing.hasMarks` at
        `TopBar.tsx:133`, and drop `hasMarks` from `ProjectView.tsx:154`;
      - the "Apply" and "applied" wording in `useHandOffFocus.ts:5`,
        `engineStatus.ts:7` and `errors.ts:37` changes to match.
    - **Status line (slice 4):** `ProjectView`'s `statusText` shows
      "Updating documents…" while `operation` is `"updating"` and the worker
      is ready; `engineStatus` keeps the worker's own states.

#### 27. Outside checker files (Modify) — slices 1, 2 and 5

*   **Type / Scope**: Outside checker.
*   **Files:**
    - `tests/oracle/oracle/raw.py`, `tests/oracle/oracle/checks.py`,
      `tests/oracle/oracle/__main__.py`;
    - `tests/oracle/oracle/structure.py` (Create, slice 2);
    - `tests/oracle/pyproject.toml`, `tests/oracle/uv.lock`;
    - `tests/oracle/tests/test_checks.py`, `tests/e2e/oracle.ts`.
*   **Proposed Changes**:
    - **`raw.py`** (slice 2) scans each Flate stream's bytes after its end of
      data. In slice 5 it decodes with pdfminer's filters: Flate with
      predictors, LZW, ASCII85, ASCIIHex, RunLength and chains of these,
      keeping that scan, and also keeps each stream's undecoded bytes as a
      segment, as it does today for a stream zlib can't inflate: pdfminer's
      decoders stop at their end markers, so without it the planned entries
      for bytes after an LZW, ASCII85, ASCIIHex or RunLength stream's end
      could not fail on their uncleaned fixtures. It also decodes name escapes, PDFDocEncoding, and
      UTF-16 with or without a byte-order mark. Its docstring changes.
    - **`checks.py`** gains `structure` (in `oracle/structure.py`, over
      `vendor/arlington`), `drawings`, `glyphs-absent`, `image-metadata` and
      `rendered`. `rendered`, with `pypdfium2`, came
      in slice 1 (owner, 25 Nov 2026).
      - `image-metadata` fails when it finds a COM segment in any J2K
        codestream, raw or inside `jp2c`.
      - `structure` and `image-metadata` come in slice 2 (slice 2 answer 4),
        and `rendered` starts PDFium's form environment there, so it draws
        form fields.
      - Each check is tagged `leak` or `keep` (part 9), in slice 5, which
        adds `drawings`, `glyphs-absent` and `kept`, and to `structure` the
        rules for a soft mask's colour space and for parameters with no
        filter at their place.
    - **`__main__.py`** dispatches each check by name; in slice 5 it gets a
      `CHECKS` dict mapping each name to its function and its sort.
    - **`pyproject.toml`** adds `pypdfium2==5.15.2` to
      `[project].dependencies`, and `uv.lock` is regenerated.
    - **`test_checks.py`** gets one clean case and one unclean case per new
      check.
    - **`oracle.ts`'s `OracleCheck`** gains the new checks. Every check's
      regions use `{ page: number /* 1-based */; box: UserBox }`, where
      `UserBox` is the oracle's existing bottom-left PDF user space.
    - **`engine/pdf/allowlist.test.ts`** (Create, slice 5): the structural
      check's cases only check mode reaches (item 30).

#### 28. `tests/oracle/leak-vectors.json` (Create) — slices 1, 2, 3 and 5

In slice 3, once `redact.ts` deletes the empty `/Annots` (item 11), every
entry with a mark gets `{ "check": "structure" }` back, so the outside
checker judges the writer's output structurally.

*   **Type / Scope**: The leak-vector list.
*   **Proposed Changes**: an array of entries:

    ```text
    { id,                     // kebab-case, unique
      spec,                   // ISO 32000-2 clause
      howItLeaks,
      rule,                   // see below
      kind,                   // a RemovalKind literal, or null
      fixture,                // a path under fixtures/; entries may share one
      value,                  // the synthetic value, or null
      mark,                   // { page /* 1-based */, select: PointBox } | { page, box: PointBox } | null
      markType,               // a MarkType, or null
      expect,                 // "clean" | "kept" | { refusal: code, at: "add" | "preview" }
      checks }                // OracleCheck objects; [] for refusal entries
    ```

    `PointBox` is the browser tests' existing on-screen selection box. The
    `rule` values:
    - `strip`: removed by the allowlist or the content filter;
    - `flatten`: made part of the page, then its carrier removed;
    - `keep-redact`: kept as page content, with marked values removed;
    - `rewrite`: kept with its data changed, such as JPEG segments cut or
      pixels blanked;
    - `keep`: kept as it is, by decision, with `expect: "kept"` (slice 5
      answer 2);
    - `refuse`: the document is refused, with `expect` naming the refusal.

    A **rule path** is one rule applied to one carrier. An entry with
    `expect: "clean"` has at least one leak check.

    Arguments of the new checks:
    - `structure {}`;
    - `drawings { boxes: regions }`;
    - `glyphs-absent { regions }`;
    - `kept { values }`;
    - `image-metadata {}`;
    - `rendered { exceptions?: regions }`.

    Entries start from the brainstorm's list (`concepts_brief.md`) and the
    probe cases, then the walk of the specification's object types.

#### 29. `tests/oracle/make_fixtures.py` (Modify), fixtures (Create) — slices 1, 2 and 5

*   **Type / Scope**: Synthetic fixtures.
*   **Proposed Changes**:
    - `tests/oracle/README.md`'s fixture table is the specification of each
      fixture: what it holds, where, and its planted values. Slice 2 adds
      `annotations`, `form`, `carriers`, `hidden-content`, `image-data`,
      `xfa-form`, `visibility-expression`, `structure-keys`, `wrong-array`,
      `stray-parent`, `null-elements`, `postscript-xobject`,
      `image-filter-names`, `image-filter-not-last`, `two-roles`,
      `hybrid-xfa`, `grey-soft-masks`, `image-prefilters`, `data-after-end`,
      `shading-graphics-state`, `abbreviated-stream-keys`,
      `jpx-data`, `jpeg-extension`, `jpeg-long-adobe`, `icc-under-dct`,
      `inline-jpeg` and the five `marked-*`. Slice 3 adds `tall-letter-boxes`
      (CUJ 8) and `signature-stroke` (CUJ 3), for the gate's refusals.
      Slice 5 adds `kept-names`, `drawings`, `layer-states`,
      `jpeg-thumbnail`, `actual-text-only`, `wide-letter-boxes`,
      `data-after-end-filters`, `name-trees`, `grey-array-soft-mask`,
      `wrong-type-value`, `jpx-parameters`, `postscript-left` and fourteen
      `refused-*`, one per refusal rule no other fixture reaches.
    - One builder per fixture file, written as `fixtures/<name>.pdf` and
      `fixtures/<name>-cleaned.pdf` for the checker's own tests. Several
      entries may share a fixture.
    - The probe cases from this design are rebuilt here in code: forms,
      hidden text, a shared drawing, paths and images.
    - New builders:
      - grid, shading and barcode drawings (the signature stroke is slice 3's);
      - an OCMD layer rule and a `BaseState /OFF` layer;
      - JFIF and JFXX thumbnails, and bytes after the end-of-image marker
        (JFXX and the bytes after the end are slice 2's `image-data`);
      - JPX metadata boxes, and COM segments inside `jp2c` (slice 2's
        `image-data`);
      - text whose only mapping is ActualText;
      - a font whose letter boxes are larger than its letters are drawn
        (CUJ 8; slice 3's `tall-letter-boxes`, whose boxes are taller).

    All values are synthetic.

#### 30. `tests/oracle/tests/test_manifest.py` (Create) — slice 5

*   **Type / Scope**: Meta-test.
*   **Proposed Changes**: for each entry, it runs the entry's checks with the
    uncleaned fixture as both input and output. It fails when an entry:
    - has a leak check that passes on that run;
    - names a check not in `CHECKS`;
    - has `expect: "clean"` with no leak check;
    - has no fixture file;
    - has a malformed field.

    That each entry passes in the browser is enforced by
    `leak-suite.spec.ts`, inside `pnpm test`.

    The rule (slice 5 answer 1): every leak check fails on the uncleaned
    fixture, except `structure`, a guard that may pass there; an entry
    expecting `"clean"` needs at least one leak check that fails there; a
    `"kept"` entry has a `kept` check, no leak check, and every check
    passing there. A malformed field is one that breaks item 28's schema:
    an id that is not kebab-case or is listed twice, a rule, mark type or
    refusal not in its list, a refusal at a stage it is not
    reached at, a mark that is not a 1-based page and four numbers, or a
    refusal entry with checks.

    The cases only check mode reaches, a filter left ahead of image data
    and an `Encrypt` left in the trailer, can't be leak entries, as strip
    mode removes or refuses them first. `engine/pdf/allowlist.test.ts`
    builds a MuPDF document for each and calls check mode (slice 2's
    review, note M6).

#### 31. `tests/e2e/leak-suite.spec.ts` (Create) — slices 1, 2 and 5

*   **Type / Scope**: Browser tests.
*   **Proposed Changes**: one test per entry that makes a mark, and one per
    fixture for entries that make none (below). Each test with a mark:
    1. adds the fixture;
    2. makes `mark` with the existing `markText` or `drawBox` helpers;
    3. previews, approves and downloads;
    4. runs `checks`.

    Refusal entries assert the refusal's sentence from `app/errors.ts` at the
    stage in `expect`, and that nothing was downloaded.

    Slice 1's version runs its entries through the preview download, as the
    browser tests of redaction do. In slice 2, entries with no mark are what
    preparation alone must clean (slice 2 answer 4): one test per fixture
    adds it, runs each entry's checks on the working copy the app stored,
    and checks that preparing it recorded each entry's `kind`. The working
    copy and the removed kinds are read from the project's stored files
    (`tests/e2e/app.ts`: `workingCopy`, `removedKinds`). Entries that share
    a fixture share its kinds, so an entry's own `absent` values are its
    proof; the kind check shows only that the kind is recorded.
    Slice 5 adds the refusal entries and the `"kept"` entries, which
    share their fixture's test with its other entries without a mark. The
    refusal tests of `open-pdf.spec.ts` that an entry now makes move into
    the list. The kind check reads the stored kinds; that the approval
    dialog lists them is slice 4's `tests/e2e/approval.spec.ts`.

#### 32. Anchoring and golden tests (Create / Modify) — slices 2 and 3

*   **Type / Scope**: Browser tests and stored fixtures.
*   **Files:**
    - Create: `tests/e2e/anchoring.spec.ts`, `fixtures/golden/pre-phase-3/`.
    - Modify: `tests/e2e/golden.spec.ts`, `tests/e2e/app.ts`.
*   **Proposed Changes**:
    - Before re-recording, copy `fixtures/golden/project/` to
      `fixtures/golden/pre-phase-3/`.
    - Move the code that loads storage into the browser's private storage
      (`golden.spec.ts:102-116`) into a helper in `tests/e2e/app.ts`.
    - **`anchoring.spec.ts`, first case (slice 2).** It opens `pre-phase-3/`
      in the new build. It checks:
      - every file directly under `cross-page/.redactorator/` is
        byte-identical afterwards;
      - a `pdf-3/` folder was created;
      - the marks sit on the same words;
      - the export passes the oracle's `absent` and `positions` checks.
    - **Second case (slice 3).** It edits the letters under the first piece
      of `cross-page.pdf`'s multi-piece mark, "Jane Roe,", in the older
      build's reading of that document,
      `pre-phase-3/cross-page/.redactorator/text/fa7f4a62….json`, at page 0,
      offsets 84–88, so that they differ. It expects the
      `mark-lost` sentence on Preview and "Mark again" in the panel.
    - **`golden.spec.ts`:**
      - re-recorded with `GOLDEN_UPDATE=1`;
      - `goldenForm` matches `pdf-3/project.json` and
        `pdf-3/(text|images)/*.json` as JSON, and `pdf-3/working/*.pdf` by
        SHA-256. If the spike shows those PDFs are not byte-stable, it
        checks only that they exist;
      - the second test (101–124) and `expected-old` now assert that an older
        storage opens through migration;
      - its header comment says so.

#### 33. Other tests and fakes (Modify) — slices 2 and 3

In slice 2 these include `tests/e2e/open-pdf.spec.ts` (the refusals and the
explicit nulls), `tests/e2e/redact.spec.ts` (the masked image judged against
the working copy), and `package.json`'s `test:tools`; and
`tests/e2e/preparation-saves.spec.ts` is removed. The app and engine files
slice 2 also touches beyond the items above are `app/useDocumentInEngine.ts`
(the reopen after an update), `engine/core/session/slices/output.ts` and
`engine/pdf/objects.ts` (lookups that stop at a missing or `null` object).

*   **Type / Scope**: Browser tests, unit tests and fakes.
*   **Files:**
    - `tests/e2e/fakes.ts`, `engine/core/session/facade.test.ts`;
    - `tests/e2e/history.spec.ts`, `tests/e2e/projects.spec.ts`,
      `tests/e2e/saving.spec.ts`, `tests/e2e/keyboard.spec.ts`;
    - `tests/e2e/app.ts`, `tests/e2e/redact.spec.ts`,
      `tests/e2e/spreading.spec.ts`, `tests/e2e/marking.spec.ts`.
*   **Proposed Changes**:
    - **Slice 2, protocol and storage:**
      - `fakes.ts`: `inspect`/`inspected` become `prepare`/`prepared`,
        `ready` gains `readerTag`, and `holdInspection` becomes
        `holdPreparation`;
      - `facade.test.ts`'s fake `PdfClient` gains `prepare`;
      - `history.spec.ts`, `projects.spec.ts` and `saving.spec.ts` use
        `holdPreparation` and read `pdf-3/project.json`.
    - **Slice 3, writer and Preview:**
      - `keyboard.spec.ts:30` and `app.ts:315` click "Preview";
      - `app.ts`'s `approve(page, undefined)` confirms the approval dialog
        whenever it opens, since removed kinds now open it for most fixtures;
      - new cases: marking and spreading a flattened form value
        (`spreading.spec.ts`), and in `preview.spec.ts` the extra-letters
        refusal with its highlight (CUJ 8), a zero-mark export judged against
        the stored working copy (CUJ 4), and a partly covered drawing refused
        until the box covers it, while another document exports (CUJ 3).
        Until slice 5's `drawings` check, the outside checker judges that
        output with `absent`, `structure` and `rendered` only, so the
        stroke's removal under the box is shown by the gate alone; slice 5
        adds `drawings` there;
      - `redact.spec.ts:264`'s assertion becomes the `mark-lost` sentence,
        "A mark on page 1 no longer matches the page. Mark it again.", since
        `tamperApply` (256–265) now trips the guard;
      - `marking.spec.ts:44` asserts the Preview button's name.

#### 34. Directory READMEs (Modify / Create) — each slice

*   **Type / Scope**: Directory documentation.
*   **Proposed Changes**: describe preparation, the working copy, reader-tag
    folders, piece text and lost marks, the refusals and the new checks.
    Replace the root README's "Known gap: line art" invariant with the
    partly-covered-drawing rule.
    - **Modify:**
      - `README.md`, `app/README.md`;
      - `engine/README.md`, `engine/api/README.md`, `engine/model/README.md`;
      - `engine/pdf/README.md`, `engine/pdf/write/README.md`,
        `engine/pdf-protocol/README.md`;
      - `engine/core/README.md`, `engine/core/stored/README.md`,
        `engine/core/formats/README.md`, `engine/core/pdf-client/README.md`;
      - `engine/core/library/README.md`,
        `engine/core/library/effects/README.md`;
      - `engine/core/session/README.md`,
        `engine/core/session/effects/README.md`,
        `engine/core/session/slices/README.md`;
      - `tests/oracle/README.md`.
    - **Create:** `engine/pdf/prepare/README.md`.

#### 35. Library files (Modify) — slice 2

*   **Type / Scope**: Core Library.
*   **Files:**
    - `engine/core/library/facade.ts` (lines 71, 73, 82);
    - `engine/core/library/effects/open.ts:23`, `manage.ts:23`,
      `refresh.ts:33`, `move.ts:15-16`, `create.ts:21`, `import.ts`.
*   **Proposed Changes**:
    - Every project read goes through `findProjectFile`, and every write
      through the tagged helpers of item 18.
    - `open.ts` calls `migrateToTag` before the Session opens, when the
      current tag's folder has no project file.
    - The tag comes from `READER_TAG` (`pdf-protocol`), so the Library needs
      no worker reply to list projects.

#### 36. `vendor/arlington/` (Create) — slice 2

*   **Type / Scope**: Vendored build-time data, third-party (Apache 2.0).
*   **Proposed Changes**:
    - `tsv/latest/*.tsv`, the PDF 2.0 object types of the Arlington PDF Model
      (github.com/pdf-association/arlington-pdf-model), at commit
      `cdc485e4238c55bbd6204f6fda31997245d54b71`. The repository has no
      release tags, so a commit is pinned.
    - `LICENSE` and `NOTICE.txt` as upstream ships them.
    - `README.md`: the source, the commit, and how to update: replace the
      TSVs with a new commit's, run the generator (item 37), make the same
      decision changes in `tests/oracle/oracle/structure.py`'s `KEEP`,
      change `READER_TAG` (part 2), and run `pnpm test`.
    - Nothing reads these files at run time; the app ships only the generated
      table.

#### 37. `tools/arlington/generate.py`, `engine/pdf/allowlist-decisions.json`, `engine/pdf/allowlistRoles.generated.ts` (Create) — slice 2

*   **Type / Scope**: A Python script on the standard library (Python 3.9
    or later), run by hand like `make_fixtures.py`; its input, our
    decisions; and its output.
*   **Proposed Changes**:
    - `allowlist-decisions.json` holds our decisions from Appendix A.1, one
      entry per model object type, each with these optional fields:
      - `keep`: the keys kept (a stream also keeps `Length`, `Filter` and
        `DecodeParms`);
      - `kinds`: the kind each deleted key records, where the design's rules
        name one; `null` records none, and a key not listed records
        `app-data`;
      - `notWalked`: kept keys whose values are not walked (A.1);
      - `refuse`: `true` for a type whose objects refuse their file;
      - `delete`: `true` for a type whose objects are deleted with the key
        that leads to them.

      A map type, whose keys the file chooses (`*` its only key), and an
      array type need no entry. For example:
      `"FileTrailer": { "keep": ["Size", "Root", "ID", "Encrypt"], "kinds": { "Info": "metadata" }, "notWalked": ["Encrypt"] }`.
    - The generator walks the model's `Link` column from `FileTrailer`,
      following only keys we keep, and writes `allowlistRoles.generated.ts`:
      a "Do not edit" header, then `ROLES: Readonly<Record<string, Role>>`, one role a
      line. A `Role` has `keys` (a kept key maps to its `KeyEntry`, and in a
      role with `*` each own key we delete maps to `null`; a `KeyEntry` maps a PDF
      type to the candidates it leads to, or `null` for a key of a type with
      `*` that is deleted), `fixed` (the values that tell candidates apart),
      `kinds`, `notWalked`, `refuse` and `delete`.
    - It writes no table and exits non-zero at once when the model has a
      type it can't map or a container key that links nowhere. Otherwise,
      if it finds any problem below, it lists each under its heading, writes
      no table and exits non-zero:
      - "Types the walk reaches with no decision";
      - "Decisions that can't be applied": a role the model links to with no
        TSV; a decision naming a role or key the model does not have; a role
        the walk never reaches; a decision on a map or array role;
        `notWalked` keys that are not all kept; a role that keeps keys and
        is also refused or deleted; a role both refused and deleted.
    - `python3 tools/arlington/generate.py` writes the table;
      `python3 tools/arlington/generate.py --check` exits non-zero when the
      table is not what it would write. The `test:tools` script in
      `package.json`, part of `pnpm test`, runs `--check`, so the table never
      drifts from its inputs.
    - A change to the decisions is made by hand in the checker's `KEEP` in
      `tests/oracle/oracle/structure.py` too (Risks). Any change to what the
      table (`allowlistRoles.generated.ts`, kinds included), the decisions or
      `NAME_TREES` keep or record changes what step 7 does,
      so it comes with a new `READER_TAG` (part 2), and every document is
      prepared again.

### Verification Plan

*   **Compilation/Build**: `pnpm build`. For slice 1, `./vendor/mupdf/build.sh`,
    then the `SHA256SUMS` regeneration of item 2.
*   **Unit Tests**:
    - `pnpm exec vitest run`, for re-anchoring, glyph comparison and formats;
    - `pnpm test:tools`, inside `pnpm test`: the generator's `--check`, then
      `uv run --project tests/oracle python -m pytest tests/oracle`, for the
      checker and the manifest meta-test, and `tools/dataset`'s tests.
*   **Static Analysis & Linting**: the typecheck, `fallow architecture
    --boundaries` and `fallow audit`, all inside `pnpm test`.
*   **Test Coverage Requirement**: every entry in `leak-vectors.json` has a
    fixture, a passing browser test, and leak checks proven to fail on the
    uncleaned fixture. The meta-test enforces it.
*   **E2E/Integration**: `pnpm test` runs the Playwright suite with coverage,
    including `leak-suite.spec.ts`, `anchoring.spec.ts` and `golden.spec.ts`.
*   **The allowlist's rules and their tests** (Appendix A.1 and A.2; the
    fixtures are in `tests/oracle/README.md`):

    | Rule | Fixture | Test | Outcome |
    | --- | --- | --- | --- |
    | A key a role does not keep is deleted, with its kind | `carriers.pdf` | leak suite | absent, `structure`, kind recorded |
    | Keys are the table's own only | `structure-keys.pdf` | leak suite | `/constructor`, `/toString` deleted |
    | A role with `*` deletes the own keys it does not keep | `structure-keys.pdf` | leak suite | `HalftoneName` deleted |
    | A rectangle must be four numbers | `wrong-array.pdf` | leak suite | the key deleted |
    | A PostScript XObject is removed and recorded | `postscript-xobject.pdf` | leak suite | absent, `app-data` (step 5 drops it; the scan before step 5 records the kind) |
    | JPEG 2000 data past the first codestream's end is cut | `jpx-data.pdf` | leak suite | absent, `image-metadata` |
    | JPEG data in a stream that is no image refuses | `icc-under-dct.pdf` | leak suite | refused |
    | An inline JPEG keeps no metadata | `inline-jpeg.pdf` | leak suite | absent (step 5 rewrites it) |
    | Explicit nulls are allowed where the model has them, and record no kind | `null-elements.pdf` | `open-pdf.spec.ts` | added, `structure`, no kind |
    | A `/Parent` must be a page-tree node | `stray-parent.pdf` | leak suite | refused |
    | Two roles must agree on an object | `two-roles.pdf` | leak suite | refused |
    | Image data under a filter after its image filter | `image-filter-not-last.pdf` | leak suite | refused |
    | A shading pattern's graphics state is deleted | `shading-graphics-state.pdf` | leak suite | absent, `structure`, `rendered`, `app-data` |
    | A stream naming its filter by `/F` or `/DP` refuses | `abbreviated-stream-keys.pdf` | leak suite | refused |
    | A hybrid form's XFA is deleted with the form | `hybrid-xfa.pdf` | leak suite | absent, `structure`, `rendered`, `form-data` |
    | A form drawn by XFA alone refuses | `xfa-form.pdf` | leak suite | refused |
    | A one-channel soft mask becomes `DeviceGray` | `grey-soft-masks.pdf` | leak suite | `structure`, `rendered` |
    | Lossless filters ahead of an image filter are undone | `image-prefilters.pdf` | leak suite | absent, `image-metadata`, `rendered` |
    | Bytes after a Flate stream's end of data go | `data-after-end.pdf` | leak suite | absent (the raw scan reads past the zlib end), `structure`, `rendered` |
    | A single `DecodeParms` over a filter array is the Flate layer's | `image-filter-names.pdf` | leak suite | absent, `image-metadata`, `structure` |
    | A JPEG's JPGn extension segments are cut | `jpeg-extension.pdf` | leak suite | absent, `image-metadata` |
    | An Adobe APP14 longer than its fields refuses | `jpeg-long-adobe.pdf` | leak suite | refused |
    | Encryption is gone from the working copy | `edit-locked.pdf` | leak suite | `metadata` (the fixture's `Info`), `structure`, `rendered` |
    | Abbreviated filter names are read in full, parameters included | `image-filter-names.pdf` | leak suite | absent, `image-metadata`, `structure` keeps their `DecodeParms` |
    | JPEG and JPEG 2000 metadata is cut | `image-data.pdf` | leak suite | absent, `image-metadata` |
    | `Encrypt` stays until step 8 | `edit-locked.pdf` | `tests/e2e/redact.spec.ts` | prepared |
    | The generator's stops | — | by hand, on a changed copy of the decisions (slice 2) | non-zero exit, listed |

    Slice 5 adds an entry for each rule below (the `refused-*` fixtures and
    the others of item 29). Two rules refuse no file (slice 5 Probe
    Findings): no file reaches a role we delete met as an array element, so
    it has no entry, and step 5 refuses a JP2 file with no `jp2c` before
    that rule, which its entry shows. The two check-mode
    cases are unit tests in `engine/pdf/allowlist.test.ts`:
    - refusals: an object no candidate fits; a tie between candidates; an
      element of the wrong type in an array role (a malformed rectangle or
      matrix is deleted instead, `wrong-array.pdf`); a role we delete met as
      an array element; parameters with no filter at their place;
      `FilterCrypt` parameters; an image filter chain with a lossy or
      unknown filter before the image filter; image data that can't be
      walked; a soft mask under any other array colour space, such as a
      one-channel `Separation`;
    - deletions: a value of a PDF type the model does not allow for its key;
      non-empty parameters for a filter that takes none; step 7's own
      deletion of a PostScript XObject that step 5 left, with the tie rule
      for roles we delete;
    - check mode: a filter left ahead of image data, and an `Encrypt` still
      in the trailer;
    - non-empty parameters as an array element; an array element the model
      has no place for; the other walk order of `two-roles.pdf` (the object
      met first in the role that keeps the key); a soft mask under
      `[/DeviceGray]`; bytes after the end of an LZW, ASCII85, ASCIIHex or
      RunLength stream; the `/Names` kinds of a
      `JavaScript` tree and of any other tree; a JPEG with no end-of-image
      marker, a J2K codestream with no EOC, and a JP2 file with no `jp2c`.
*   **Done when**:
    - every leak vector passes;
    - the anchoring tests pass on pre-Phase-3 storage;
    - every refusal in the part 6 table is reached by a test with its
      sentence.

--------------------------------------------------------------------------------

## Appendix A: Allowlist and removal kinds

### A.1 Roles and their allowed keys

**Where roles come from.** The role table is generated (Detailed item 37)
from the Arlington PDF Model (item 36), one TSV per object type of PDF 2.0.
A **role** is one of the model's object types, such as `Catalog`,
`PageObject`, `FontType1` or `XObjectImage`; "PDF type" means a value's own
type: array, dictionary, stream, name, string, number, boolean or null. This
appendix holds only our decisions: for each role the walk reaches, the keys
we keep, and the kind each deleted key records. The model decides the rest:
which roles a key can lead to, which keys a role can have, and which values
tell candidates apart. This appendix is the one statement of the rules
below; step 7 and Detailed item 5 point here.

**Reading the model.** The generator and the checker read the TSVs by the
same rules, each in its own code:
- A value wrapped in `fn:`, which says since when or under what condition it
  applies, is read as its last argument, so
  `fn:SinceVersion(1.2,FilterFlateDecode)` is `FilterFlateDecode`; version
  and condition limits are not applied.
- The model's types map to PDF types: `integer`, `number` and `bitmask` to
  number; `string`, `string-text`, `string-byte`, `string-ascii` and `date`
  to string; `dictionary`, `name-tree` and `number-tree` to dictionary;
  `array`, `rectangle` and `matrix` to array; and `stream`, `name`,
  `boolean` and `null` to themselves. Where several model types map to one
  PDF type, their `Link` lists are merged.
- A stream role has a `Length` key; a map role has only `*`; an array role
  has only `*` or numbered keys.
- A fixed value list is the first `;`-separated part of `PossibleValues`
  whose every value is a plain literal (letters, digits, `_`, `.` and `-`);
  numbers are compared as decimal strings.

**Choosing a role.** The walk starts at the trailer, in the role
`FileTrailer`, and follows each key the role keeps.
- The model's `Link` column for the key names its candidates: one list per
  PDF type the `Type` column allows, in the same order. For a key of type
  `array;name`, `[ArrayOfFilterNames];[]` gives an array the candidate
  `ArrayOfFilterNames`, and a name none. The value's own PDF type picks the
  list.
- A value of a PDF type the model does not allow for the key is
  deleted (an array element of the wrong type refuses, below), as
  if the role did not keep the key.
- An empty list (`[]`) means a plain value: a name, string, number, boolean
  or null. A rectangle or a matrix, which the model links nowhere, must be
  numbers (a rectangle four, a matrix six), or the key is deleted; the generated table gives
  them the reserved candidate names `rectangle` and `matrix`, which are
  shapes, never roles. No key in the model mixes a shape with roles.
- Each candidate's **fixed values** are the model's `PossibleValues` for the
  keys `Type`, `Subtype`, `Subtype2`, `S`, `FunctionType`, `ShadingType`,
  `PatternType`, `HalftoneType` and an array's first element
  (`DISCRIMINATORS` in the generator; `"0"` is the first element), as
  "Reading the model" defines them; no other constraint is used. A
  candidate whose fixed value the object contradicts drops out. A key the
  object lacks, or holds as anything but a name or a number, is skipped, so
  a candidate can fit with no match. When every candidate drops out, the
  object has no role. The candidate with the most matches wins,
  and a tie for the most refuses the file, unless every tied role is one we
  delete: then the object is deleted with its key. A PostScript XObject
  with no `/Subtype2` fits both `XObjectFormPS` and
  `XObjectFormPSpassthrough`.
- A stream's `DecodeParms` take the role its filter at the same place names
  (`FilterFlateDecode` for `FlateDecode`), as no value tells them apart. The
  filter's name is read in full first (Appendix A.2), so `/Fl` takes
  `FilterFlateDecode`.
  Parameters for a filter that takes none must be an empty dictionary or
  `null`; anything else is deleted, or, as an element of an array, refuses
  the file. A single `DecodeParms` dictionary over a `Filter` array takes
  the first filter's role. Parameters with no filter at that place, as a
  `DecodeParms` without a `Filter` or an array longer than the filters,
  have no role to tell them apart, so they refuse the file, except a `null`
  element, which is kept.
- A key whose value is an explicit `null` is deleted where the model allows
  no null there, and records no kind: it held nothing.
- The keys a file chooses are looked up as the table's own keys only, so a
  key such as `/constructor` is never read as a JavaScript built-in.

**What is kept, deleted or refused.**
- A key stays only when the model lists it for the role and our decisions
  keep it. Every stream also keeps `Length`, `Filter` and `DecodeParms`. The
  walk follows only kept keys, so only the roles reachable through them need
  a decision; the generator stops, and lists them, when one has none.
- A **map role**, whose keys the file chooses (`*` is its only key, as in
  `FontMap` for `/Font`), keeps every entry, each in the role its `*` links
  to. A role with `*` and keys of its own (`ColorSpaceMap`, `HalftoneType5`)
  keeps every `*` entry, each in the role its `*` links to, and of its own
  keys only those we keep; its other own keys are deleted, never read as
  `*` entries.
- An **array role** keeps every element, since deleting one would move the
  rest. An element the model has no place for, or places with another PDF
  type, refuses the file.
- A kept key that is **not walked** is kept as it is, and its value is not
  followed. A page's or page-tree node's `Parent` is not walked, as the walk
  reaches the tree from its root; once the walk is done, each `Parent` must
  point at an object reached as `PageTreeNode` or `PageTreeNodeRoot`, or the
  file is refused. The trailer's `Encrypt` is the other one (below).
- An object reached in a second role was already stripped by the role that
  reached it first. If the second role would delete a key still there, or
  keeps a key the first deleted, the file is refused, so the outcome does
  not depend on which role the walk meets first (`two-roles.pdf`). A direct
  object inside it is walked again in the second role.
- A soft mask (`XObjectImageSoftMask`) whose colour space is exactly
  `[/CalGray …]`, `[/ICCBased s]` with `/N 1`, or `[/DeviceGray]` is given
  `/DeviceGray` before its keys are walked (slice 2 answer 8). Any other
  array colour space refuses the file, one-channel `Separation`, `Indexed`
  and `DeviceN` included, as their samples do not read as grey. A name is
  kept as it is, as the model gives a soft mask's `ColorSpace` name no
  candidates.
- An object of a role we delete (`XObjectFormPS`, `XObjectFormPSpassthrough`)
  is deleted with the key that leads to it, which records that key's kind,
  `app-data` for an XObject; as an array element it refuses the file. An
  object of a role we refuse (`FilterCrypt`), or of no role in the table,
  refuses the file.

Every "refuses the file" in this appendix means preparation refuses the
document as `prepare-failed`; check mode returns `"unplaced"` for it.

**The trailer's `Encrypt`** is kept, and not walked, until step 8's
`encrypt=none` drops it: MuPDF goes on encrypting what it writes until then,
so with the key deleted in step 7, slice 2's step 7a, a save before step 8,
wrote encrypted streams with no `Encrypt` to read them by, and step 9
refused `edit-locked.pdf`. Being
kept, it records no kind. Check mode, which step 9 runs, reports an `Encrypt`
still there, so a file whose encryption survived step 8 is refused.

**The trailer's `ID`** is kept: rewriting the file ID is a Non-Goal.

**Removal kinds.** The last column names the kind recorded when a key is
deleted from that role; "no kind" records none, and any deleted key not
named there records `app-data`. The catalog's `/Names` records one kind per
tree it holds (slice 2 answer 2): `links` for `Dests`, `attachments` for
`EmbeddedFiles`, `scripts-actions` for `JavaScript`, and `app-data` for any
other. That rule lives in `NAME_TREES` in `allowlist.ts`, not in the
decisions file.

**The table** lists our decisions, one row per role the walk reaches that
needs one, as `engine/pdf/allowlist-decisions.json` holds them, apart from
`Catalog`'s `Names` cell, which is `NAME_TREES`. Map roles (only `*`) and
array roles need no row; a role with `*` and its own keys, such as
`ColorSpaceMap`, has one.

| Role | Kept keys | Deleted keys with a kind of their own |
| --- | --- | --- |
| `FileTrailer` | `Size`, `Root`, `ID`, `Encrypt` (not walked: `Encrypt`) | `Info` → `metadata` |
| `Catalog` | `Type`, `Pages`, `Version` | `Metadata` → `metadata`, `Outlines` → `bookmarks`, `Dests` → `links`, `PageLabels` → `page-labels`, `Threads` → `page-labels`, `OpenAction` → `scripts-actions`, `AA` → `scripts-actions`, `URI` → `scripts-actions`, `AcroForm` → no kind, `StructTreeRoot` → `accessibility-tags`, `MarkInfo` → `accessibility-tags`, `Perms` → `signatures`, `DSS` → `signatures`, `AF` → `attachments`, `Collection` → `attachments`, `OCProperties` → no kind, `Names` → one kind per tree it holds (Removal kinds above) |
| `PageTreeNodeRoot` | `Type`, `Kids`, `Count`, `Resources`, `MediaBox`, `CropBox`, `Rotate` | — |
| `PageTreeNode` | `Type`, `Parent`, `Kids`, `Count`, `Resources`, `MediaBox`, `CropBox`, `Rotate` (not walked: `Parent`) | — |
| `PageObject` | `Type`, `Parent`, `Resources`, `MediaBox`, `CropBox`, `Rotate`, `Contents`, `Group`, `UserUnit` (not walked: `Parent`) | `Annots` → no kind, `Thumb` → `thumbnails`, `Metadata` → `metadata`, `StructParents` → `accessibility-tags`, `AA` → `scripts-actions`, `LastModified` → `metadata`, `B` → `page-labels`, `AF` → `attachments` |
| `Resource` | `ExtGState`, `ColorSpace`, `Pattern`, `Shading`, `XObject`, `Font`, `ProcSet` | `Properties` → no kind (the device pass before step 5 records `marked-content` or `hidden-layers`; part 1) |
| `Stream` | only the stream keys | — |
| `GroupAttributes` | `Type`, `S`, `CS`, `I`, `K` | — |
| `XObjectImage` | `Type`, `Subtype`, `Width`, `Height`, `ColorSpace`, `BitsPerComponent`, `Intent`, `ImageMask`, `Mask`, `Decode`, `Interpolate`, `SMask`, `SMaskInData` | `Metadata` → `image-metadata`, `StructParent` → `accessibility-tags`, `AF` → `attachments` |
| `XObjectImageMask` | `Type`, `Subtype`, `Width`, `Height`, `BitsPerComponent`, `Intent`, `ImageMask`, `Decode`, `Interpolate`, `SMask`, `SMaskInData` | `Metadata` → `image-metadata`, `StructParent` → `accessibility-tags`, `AF` → `attachments` |
| `XObjectImageSoftMask` | `Type`, `Subtype`, `Width`, `Height`, `ColorSpace`, `BitsPerComponent`, `Intent`, `ImageMask`, `Decode`, `Interpolate`, `Matte` | `Metadata` → `image-metadata`, `AF` → `attachments` |
| `XObjectFormType1` | `Type`, `Subtype`, `FormType`, `BBox`, `Matrix`, `Resources`, `Group` | `Metadata` → `metadata`, `LastModified` → `metadata`, `StructParent` → `accessibility-tags`, `StructParents` → `accessibility-tags`, `AF` → `attachments` |
| `XObjectFormPS` | — (deleted with the key that leads to it, which records `app-data`) | — |
| `XObjectFormPSpassthrough` | — (deleted with the key that leads to it, which records `app-data`) | — |
| `CIDFontDescriptorMetrics` | `Type`, `FontName`, `Flags`, `FontBBox`, `ItalicAngle`, `Ascent`, `Descent`, `Leading`, `CapHeight`, `XHeight`, `StemV`, `StemH`, `AvgWidth`, `MaxWidth`, `MissingWidth`, `CharSet` | — |
| `CIDSystemInfo` | `Registry`, `Ordering`, `Supplement` | — |
| `CMapStream` | `Type`, `CMapName`, `CIDSystemInfo`, `WMode`, `UseCMap` | — |
| `CalGrayDict` | `WhitePoint`, `BlackPoint`, `Gamma` | — |
| `CalRGBDict` | `WhitePoint`, `BlackPoint`, `Gamma`, `Matrix` | — |
| `ColorSpaceMap` | `DefaultGray`, `DefaultRGB`, `DefaultCMYK` | — |
| `DeviceNDict` | `Subtype`, `Colorants`, `Process` | — |
| `DeviceNProcess` | `ColorSpace`, `Components` | — |
| `Encoding` | `Type`, `BaseEncoding`, `Differences` | — |
| `FilterCCITTFaxDecode` | `K`, `EndOfLine`, `EncodedByteAlign`, `Columns`, `Rows`, `EndOfBlock`, `BlackIs1`, `DamagedRowsBeforeError` | — |
| `FilterCrypt` | — (refuses the file) | — |
| `FilterDCTDecode` | `ColorTransform` | — |
| `FilterFlateDecode` | `Predictor`, `Colors`, `BitsPerComponent`, `Columns` | — |
| `FilterJBIG2Decode` | `JBIG2Globals` | — |
| `FilterLZWDecode` | `Predictor`, `Colors`, `BitsPerComponent`, `Columns`, `EarlyChange` | — |
| `FontCIDType0` | `Type`, `Subtype`, `BaseFont`, `CIDSystemInfo`, `FontDescriptor`, `DW`, `W`, `DW2`, `W2`, `CIDToGIDMap`, `ToUnicode` | — |
| `FontCIDType2` | `Type`, `Subtype`, `BaseFont`, `CIDSystemInfo`, `FontDescriptor`, `DW`, `W`, `DW2`, `W2`, `CIDToGIDMap`, `ToUnicode` | — |
| `FontDescriptorCIDType0` | `Type`, `FontName`, `FontFamily`, `FontStretch`, `FontWeight`, `Flags`, `FontBBox`, `ItalicAngle`, `Ascent`, `Descent`, `Leading`, `CapHeight`, `XHeight`, `StemV`, `StemH`, `AvgWidth`, `MaxWidth`, `MissingWidth`, `FontFile`, `FontFile3`, `Style`, `FD`, `CIDSet` | — |
| `FontDescriptorCIDType2` | `Type`, `FontName`, `FontFamily`, `FontStretch`, `FontWeight`, `Flags`, `FontBBox`, `ItalicAngle`, `Ascent`, `Descent`, `Leading`, `CapHeight`, `XHeight`, `StemV`, `StemH`, `AvgWidth`, `MaxWidth`, `MissingWidth`, `FontFile`, `FontFile2`, `FontFile3`, `Style`, `FD`, `CIDSet` | — |
| `FontDescriptorTrueType` | `Type`, `FontName`, `FontFamily`, `FontStretch`, `FontWeight`, `Flags`, `FontBBox`, `ItalicAngle`, `Ascent`, `Descent`, `Leading`, `CapHeight`, `XHeight`, `StemV`, `StemH`, `AvgWidth`, `MaxWidth`, `MissingWidth`, `FontFile`, `FontFile2`, `FontFile3` | — |
| `FontDescriptorType1` | `Type`, `FontName`, `FontFamily`, `FontStretch`, `FontWeight`, `Flags`, `FontBBox`, `ItalicAngle`, `Ascent`, `Descent`, `Leading`, `CapHeight`, `XHeight`, `StemV`, `StemH`, `AvgWidth`, `MaxWidth`, `MissingWidth`, `FontFile`, `FontFile3`, `CharSet` | — |
| `FontDescriptorType3` | `Type`, `FontName`, `FontFamily`, `FontStretch`, `FontWeight`, `Flags`, `FontBBox`, `ItalicAngle`, `Ascent`, `Descent`, `Leading`, `CapHeight`, `XHeight`, `StemV`, `StemH`, `AvgWidth`, `MaxWidth`, `MissingWidth` | — |
| `FontFile` | `Length1`, `Length2`, `Length3`, `Subtype` | `Metadata` → `metadata` |
| `FontFile2` | `Length1`, `Length2`, `Length3`, `Subtype` | `Metadata` → `metadata` |
| `FontFile3CIDType0` | `Length1`, `Length2`, `Length3`, `Subtype` | `Metadata` → `metadata` |
| `FontFile3OpenType` | `Length1`, `Length2`, `Length3`, `Subtype` | `Metadata` → `metadata` |
| `FontFile3Type1` | `Length1`, `Length2`, `Length3`, `Subtype` | `Metadata` → `metadata` |
| `FontFileType1` | `Length1`, `Length2`, `Length3`, `Subtype` | `Metadata` → `metadata` |
| `FontMultipleMaster` | `Type`, `Subtype`, `BaseFont`, `FirstChar`, `LastChar`, `Widths`, `FontDescriptor`, `Encoding`, `ToUnicode` | — |
| `FontTrueType` | `Type`, `Subtype`, `BaseFont`, `FirstChar`, `LastChar`, `Widths`, `FontDescriptor`, `Encoding`, `ToUnicode` | — |
| `FontType0` | `Type`, `Subtype`, `BaseFont`, `Encoding`, `DescendantFonts`, `ToUnicode` | — |
| `FontType1` | `Type`, `Subtype`, `BaseFont`, `FirstChar`, `LastChar`, `Widths`, `FontDescriptor`, `Encoding`, `ToUnicode` | — |
| `FontType3` | `Type`, `Subtype`, `FontBBox`, `FontMatrix`, `CharProcs`, `Encoding`, `FirstChar`, `LastChar`, `Widths`, `FontDescriptor`, `Resources`, `ToUnicode` | — |
| `FunctionType0` | `FunctionType`, `Domain`, `Range`, `Size`, `BitsPerSample`, `Order`, `Encode`, `Decode` | — |
| `FunctionType2` | `FunctionType`, `Domain`, `Range`, `C0`, `C1`, `N` | — |
| `FunctionType3` | `FunctionType`, `Domain`, `Range`, `Functions`, `Bounds`, `Encode` | — |
| `FunctionType4` | `FunctionType`, `Domain`, `Range` | — |
| `GraphicsStateParameter` | `Type`, `LW`, `LC`, `LJ`, `ML`, `D`, `RI`, `OP`, `op`, `OPM`, `Font`, `BG`, `BG2`, `UCR`, `UCR2`, `TR`, `TR2`, `HT`, `FL`, `SM`, `SA`, `BM`, `SMask`, `CA`, `ca`, `AIS`, `TK`, `UseBlackPtComp` | — |
| `HalftoneType1` | `Type`, `HalftoneType`, `Frequency`, `Angle`, `SpotFunction`, `AccurateScreens`, `TransferFunction` | — |
| `HalftoneType10` | `Type`, `HalftoneType`, `Xsquare`, `Ysquare`, `TransferFunction` | — |
| `HalftoneType16` | `Type`, `HalftoneType`, `Width`, `Height`, `Width2`, `Height2`, `TransferFunction` | — |
| `HalftoneType5` | `Type`, `HalftoneType`, `Default` | — |
| `HalftoneType6` | `Type`, `HalftoneType`, `Width`, `Height`, `TransferFunction` | — |
| `ICCProfileStream` | `N`, `Alternate`, `Range` | `Metadata` → `metadata` |
| `LabDict` | `WhitePoint`, `BlackPoint`, `Range` | — |
| `PatternType1` | `Type`, `PatternType`, `PaintType`, `TilingType`, `BBox`, `XStep`, `YStep`, `Resources`, `Matrix` | — |
| `PatternType2` | `Type`, `PatternType`, `Shading`, `Matrix` | — |
| `ShadingType1` | `Domain`, `Matrix`, `Function`, `ShadingType`, `ColorSpace`, `Background`, `BBox`, `AntiAlias` | — |
| `ShadingType2` | `Coords`, `Domain`, `Function`, `Extend`, `ShadingType`, `ColorSpace`, `Background`, `BBox`, `AntiAlias` | — |
| `ShadingType3` | `Coords`, `Domain`, `Function`, `Extend`, `ShadingType`, `ColorSpace`, `Background`, `BBox`, `AntiAlias` | — |
| `ShadingType4` | `BitsPerCoordinate`, `BitsPerComponent`, `BitsPerFlag`, `Decode`, `Function`, `ShadingType`, `ColorSpace`, `Background`, `BBox`, `AntiAlias` | — |
| `ShadingType5` | `BitsPerCoordinate`, `BitsPerComponent`, `VerticesPerRow`, `Decode`, `Function`, `ShadingType`, `ColorSpace`, `Background`, `BBox`, `AntiAlias` | — |
| `ShadingType6` | `BitsPerCoordinate`, `BitsPerComponent`, `BitsPerFlag`, `Decode`, `Function`, `ShadingType`, `ColorSpace`, `Background`, `BBox`, `AntiAlias` | — |
| `ShadingType7` | `BitsPerCoordinate`, `BitsPerComponent`, `BitsPerFlag`, `Decode`, `Function`, `ShadingType`, `ColorSpace`, `Background`, `BBox`, `AntiAlias` | — |
| `SoftMaskAlpha` | `Type`, `S`, `G`, `BC`, `TR` | — |
| `SoftMaskLuminosity` | `Type`, `S`, `G`, `BC`, `TR` | — |
| `StyleDict` | `Panose` | — |
| `ToUnicodeCMapStream` | `Type`, `CMapName`, `CIDSystemInfo`, `WMode`, `UseCMap` | — |

By step 7, `/Annots` holds only links, or the empty array step 6 leaves once
MuPDF has applied and removed its four redaction areas.
Step 2 already recorded their kinds, so deleting `/Annots`, or a leftover
`/AcroForm`, records none.

### A.2 Image data

This is the one statement of how image data is cut or refused; step 7 and
Detailed item 5 point here. Every "refuses" here means `prepare-failed`, and
check mode returns `"unplaced"` for it.

- **JPEG (`DCTDecode`).**
  - Walk the markers from the start of the stream, through every scan of a
    progressive JPEG. A byte search is not used.
  - Keep the segments that draw the image: frames (SOFn), tables (DHT, DAC,
    DQT), scans (SOS), DNL, DRI, DHP and EXP, and Adobe's APP14 with its
    12 bytes ("Adobe", a version, two flags and a transform; a length of
    14).
  - Drop every other APP0–APP15 segment, which covers JFIF and JFXX
    thumbnails, EXIF, XMP and IPTC; every COM segment; and the JPGn
    extension segments (`0xF0` to `0xFD`).
  - Refuse an Adobe APP14 whose length is not 14, as it decides
    how the colours decode, and any other marker.
  - Cut everything after the first end-of-image marker the walk reaches.
    A JPEG with no end-of-image marker can't be told from a damaged one, and
    refuses.
- **JPEG 2000 (`JPXDecode`).**
  - Keep the `jP␣␣`, `ftyp` and `jp2h` boxes (with `ihdr`, `colr`, `bpcc`,
    `pclr`, `cmap` and `cdef` inside it), and the first `jp2c` box. Drop
    every other box, such as `xml`, `uuid`, `uinf`, `res`, `jp2i` and a
    second `jp2c`. A JP2 file with no `jp2c` box refuses.
  - In every J2K codestream, whether raw or inside `jp2c`, drop COM marker
    segments, and cut everything after the end-of-codestream marker (EOC)
    the walk reaches. A codestream with no EOC refuses.
- **Chained filters.** Where lossless filters (`FlateDecode`, `LZWDecode`,
  `ASCIIHexDecode`, `ASCII85Decode`, `RunLengthDecode`) sit ahead of
  `DCTDecode` or `JPXDecode`, undo them, each with its own `DecodeParms`
  element, or a single `DecodeParms` dictionary, which is the first filter's
  (A.1); cut; and keep the image under its image filter alone, with that
  filter's own parameters or none: the filters before it only encoded it
  (slice 2 answer 9). A chain with any other filter ahead of the image
  filter, or one in which another filter follows it, refuses.
- **Filter names.** The abbreviated names PDF defines for inline images
  (`DCT`, `Fl`, `AHx` and the like) are read as the full names wherever they
  appear, as MuPDF reads them on any stream: a JPEG under `/DCT` is cut like
  one under `/DCTDecode` (`image-filter-names.pdf`).
- **Image data outside an image.** A stream whose role is not one of the
  `XObjectImage` roles, with `DCTDecode` or `JPXDecode` among its filters,
  as an ICC profile stored as a JPEG, refuses (`icc-under-dct.pdf`).
- **Abbreviated stream keys.** A stream that names its filters with an
  inline image's abbreviated `/F` (a name or an array) or `/DP` refuses, as
  MuPDF reads them on any stream and step 7 would keep its data unseen.
- **Data that can't be walked.** An image whose JPEG markers or JPEG 2000
  boxes can't be walked refuses.
- **Data after the end of data.** Every kept stream other than an image
  under `DCTDecode` or `JPXDecode` whose filters are all lossless (the set
  above) is written again from its decoded bytes, with no `Filter` or
  `DecodeParms`, so bytes after a filter's end of data, which no reader
  decodes, go; step 8's save compresses it with Flate (slice 2 answer 10).
  It records no kind. A stream with any other filter is kept as it is:
  `CCITTFaxDecode`, `JBIG2Decode`, `Crypt`, an unknown name or a non-name,
  with any lossless layers ahead of them. MuPDF holds each decoded copy
  until step 8's save (Risks).
- **Check mode,** which step 9 runs, reports an image whose data still
  holds what is dropped here (`" (image data)"`) and a filter still ahead of
  image data (`" (a filter over image data)"`).
- **Inline images** are rewritten by step 5's filter: an inline JPEG's EXIF
  did not survive it (slice 2, `inline-jpeg.pdf`). A.2 itself cuts XObject
  images only, and the outside checker's `image-metadata` reads stream
  objects only, so that leak entry is judged by `absent`.

### A.3 Removal kinds

| Literal | Covers | Approval dialog line |
| --- | --- | --- |
| `metadata` | `Info`, every `Metadata` stream except an image's, `LastModified` | Document information and metadata: removed |
| `image-metadata` | JPEG and JPX metadata segments and boxes, bytes after the end-of-image marker, image `Metadata` | Image camera data: removed |
| `annotations` | comments, notes, stamps, highlights and ink: flattened if visible, removed if hidden | Comments and annotations: visible ones made part of the page, the rest removed |
| `form-data` | `AcroForm`, field names, tooltips, default and export values (values flattened) | Form data: made part of the page |
| `signatures` | signature fields, certificates, `DSS`, `Perms` | Digital signature: removed; the cleaned file is not signed |
| `pending-redactions` | `Redact` annotations from other tools | Unapplied redaction marks from another app: removed (their text is not redacted unless you mark it) |
| `attachments` | embedded files, file-attachment annotations, `AF`, `Collection` | Attachments: removed |
| `scripts-actions` | JavaScript, `OpenAction`, `AA`, launch actions, `URI` | Scripts and actions: removed |
| `links` | link annotations, `Dests`, named destinations | Links: removed |
| `bookmarks` | `Outlines` | Bookmarks: removed |
| `page-labels` | `PageLabels`, `Threads`, a page's article beads (`B`) | Page labels and article threads: removed |
| `accessibility-tags` | `StructTreeRoot`, `MarkInfo`, `StructParents`, `StructParent` | Accessibility tags: removed |
| `marked-content` | ActualText, alternative text and expansion text in page content | Hidden alternative text: removed |
| `hidden-layers` | page content on layers that are off (an annotation on such a layer records `annotations`) | Hidden layer content: removed |
| `outside-page` | text and drawings wholly outside the crop box | Content outside the page: removed |
| `unshown-image-pixels` | pixels no placement shows | Hidden parts of images: blanked |
| `thumbnails` | `Thumb` | Page thumbnails: removed |
| `app-data` | `PieceInfo`, viewer settings, output intents and every other deleted key not named above | Private application data: removed |
| `old-revisions` | earlier saved versions of the file | Earlier versions of the file: removed |

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*

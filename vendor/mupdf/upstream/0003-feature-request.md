# Feature request for bugs.ghostscript.com

To file at https://bugs.ghostscript.com/ with MuPDF as the component, as an enhancement.
Attach `0003-repro.mjs` and `../patches/0003-Content-filter-options-for-redaction.patch`.
Once filed, add the bug number to the patch's subject and the pull request title, in MuPDF's
style ("Bug NNNNNN: ...").

---

**Summary:** Save options to drop hidden layer content, drop marked-content properties, and
blank image pixels that are never shown

**Version:** 1.28.6 (MuPDF.js 1.28.6)

## What we need

We remove personal data from PDFs in the browser with MuPDF.js. Before a user marks anything,
we clean the file so that what is left in it is what a reader sees. Three kinds of content
are hidden from view but stay in the file after `clean` and `sanitize`, and MuPDF.js has no
call that removes them:

1. **Content on optional content (layers) that is off.** A layer switched off in the default
   configuration can hold a client's phone number. Rendering and text extraction skip it, so
   the user never sees it, but it is still in the content stream. Redacting its area also
   removes whatever visible content shares that area. Turning the layer on in memory is not
   saved, and there is no call to remove content by layer.
2. **Marked-content properties.** `/Span <</ActualText (...)>> BDC`, `/Alt` and `/E` carry
   text that no renderer draws. `clean` and `sanitize` keep them, and the sanitize filter only
   edits them when redaction removes the characters they cover.
3. **Image pixels that no placement shows.** An image placed partly past the crop box, or
   clipped to a small window, keeps every pixel. A cropped-out face or account number in a
   scan is still in the file. Redacting the hidden area with `REDACT_IMAGE_PIXELS` works for
   pixels past the page edge, but for an image hidden by a clip inside the page it also blanks
   the visible images in that area.

## Proposed options

Three save options, each of which runs the sanitize filter as `sanitize` does:

- **`drop-hidden-oc`:** content inside optional content that is off, as for viewing, is not
  written. The decision is MuPDF's own (`pdf_is_ocg_hidden`, with usage "View"), so it matches
  rendering, including membership dictionaries (OCMDs). Hidden paths, text, images, shadings,
  form XObjects and nested marked content are dropped; text after hidden text in the same
  text object keeps its position; a hidden clipping path still clips, as when drawing. The
  `/OC` markers are removed from what stays: `BDC /OC ... EMC`, and `/OC` on shown XObjects
  and shadings.
- **`drop-mc-properties`:** a `BDC` whose properties are not an optional content group or
  membership dictionary becomes a `BMC` with the same tag; a `DP` becomes an `MP`. Layer
  markers are left for `drop-hidden-oc`.
- **`blank-unshown-pixels`:** for each image, the pixels that no placement shows are blanked,
  with the same pixel blanking that image redaction uses. A placement shows the part of the
  image inside the page bounds and inside every clip in force, as the draw device clips it,
  on screen or in print.
  Shown areas are unioned over every placement in the document, so a shared image stays one
  object and is never split per page; an image whose pixels are all shown is left byte for
  byte. Inline images are blanked too. An image that cannot be loaded fails the save, since
  it cannot be blanked.

## A bug found on the way: membership dictionary policies

`pdf_is_ocg_hidden` gets two of the four `/P` policies of an optional content membership
dictionary wrong. `/AllOn` counts as on whenever any group is on (so content on
`<</Type /OCMD /OCGs [on off] /P /AllOn>>` is drawn), and `/AnyOff` counts as off whatever
the groups are (so content on `/OCGs [on off] /P /AnyOff` is never drawn). `/AnyOn` and
`/AllOff` are right. The patch makes each policy test every group as the specification
defines it (ISO 32000-2, 8.11.2.2), and treats a dictionary with no groups as having no
effect. This changes rendering as well as `drop-hidden-oc`, and could be filed and merged on
its own.

## Reproduction

`node 0003-repro.mjs <path to mupdf.js>` builds synthetic files for each option and prints
PASS or FAIL for each check. On stock 1.28.6 the save fails with "Unused pdf arguments
found", because the options do not exist.

## Known limits of the proposal

- `drop-hidden-oc` follows MuPDF's visibility test, so an OCMD with a `/VE` expression counts
  as visible, as MuPDF draws it, and content whose group is off only for viewing (a `/Usage`
  `/View` state) is dropped even if it would print.
- `blank-unshown-pixels` treats an image drawn inside a tiling pattern as fully shown, and
  does not see images inside Type 3 glyphs, which it leaves as they are. A soft mask is
  treated as a rectangular clip at its bounds. The shown area is widened by one pixel so that
  smooth scaling at a clip edge is unchanged.
- Blanked images are stored with Flate, as redaction stores them, so a blanked JPEG grows.
- Like `clean` and `sanitize`, the options filter page contents and annotation appearances,
  not widget appearances.

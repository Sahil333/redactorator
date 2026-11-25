# Pull request text for patch 0003

Not opened, and no branch exists yet. The patch is made against the 1.28.6 tag; before
opening, rebase it onto ArtifexSoftware/mupdf master, push it as a branch on
https://github.com/Sahil333/mupdf, and re-run `0003-repro.mjs` on a MuPDF.js build of that
branch. File the feature request first (`0003-feature-request.md`), then put its number in
the title, as MuPDF's commits do.

---

**Title:** Add content filter options for redaction

**Body:**

Three save options for cleaning a file before redaction, so that what is left in it is what a reader sees. Each runs the sanitize filter over every page and annotation, as `sanitize` does.

- `drop-hidden-oc` drops content inside optional content that is off, as for viewing. The sanitize processor sets its `usage` to "View", so the interpreter tracks hidden content with the test drawing uses (`pdf_is_ocg_hidden`), and already skips XObjects whose own `/OC` is off. Hidden paths, text, images, shadings, forms and marked content are not written. Hidden text is removed the way redaction removes characters, so the text after it keeps its place. A hidden clipping path is kept, because MuPDF still clips with it when drawing. `BDC /OC` and its `EMC`, and `/OC` on shown XObjects and shadings, are removed.
- `drop-mc-properties` writes a `BDC` whose properties are not an optional content group or membership dictionary as a `BMC` with the same tag, and a `DP` as an `MP`, dropping ActualText, Alt, E and any other data in them.
- `blank-unshown-pixels` blanks image pixels that no placement shows. A device pass over every page, its annotations and its widgets, as for viewing and as for printing, records each image placement and the clips in force there. Each image's shown area is drawn in the image's own pixels with the draw device (the page bounds under every clip, unioned over all placements, widened by one pixel), and the pixels left over are blanked with the pixel blanking image redaction uses. An image XObject is rewritten in place, so all its uses still share one object; one whose pixels are all shown is left byte for byte. Inline images are blanked as the filter meets them. An image XObject that cannot be loaded fails the save, since it cannot be blanked.

It also fixes `/P /AllOn` and `/P /AnyOff` in optional content membership dictionaries: `/AllOn` counted as on when any group was on, and `/AnyOff` as off whatever the groups were. Each policy now tests every group, as ISO 32000-2 8.11.2.2 defines it, and a dictionary with no groups has no effect. This changes what is drawn, not only what `drop-hidden-oc` drops.

The pixel preparation and the blanking loop of `pdf_redact_image_imp` move into two helpers used by both; redaction itself is unchanged.

**Testing.** Built MuPDF.js 1.28.6 with this commit (Emscripten 4.0.8) and ran `0003-repro.mjs`, which builds synthetic files and checks each option on its own and all three together with `clean,sanitize`:
- hidden layers: text, a path and a form on a layer that is off, content on membership dictionaries whose `AllOn` and `AnyOff` policies are false, and hidden text in the middle of a text object are gone from the saved file; the shown text keeps its position and the page renders the same;
- marked content: ActualText, Alt, a named property list and a `DP` are gone, the tags stay as `BMC` and `MP`, and the page renders the same;
- pixels: an image past the page edge, inside a clip, inside a triangle clip, inside a form XObject, with a soft mask, and inline, has its hidden pixels blanked and its shown pixels unchanged; a fully shown image, and a shared image whose placements together show every pixel, are unchanged byte for byte; a shared image with a quarter no placement shows is blanked once and stays one object; an image shown whole only by a print-only annotation is unchanged; an image that cannot be loaded fails the save, and one whose data does not decode has that data replaced; every page renders the same.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

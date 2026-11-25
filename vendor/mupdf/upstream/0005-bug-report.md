# Bug report for bugs.ghostscript.com: patch 0005

To add as a comment to MuPDF bug 709830 ("Saving with garbage=3 drops the data of a stream added
in the session", UNCONFIRMED), which has the same cause through another path. Attach
`0005-repro.mjs` and `../patches/0005-Keep-a-stream-s-data-when-garbage-collection-renumbe.patch`.
Not yet filed.

---

**Summary:** A save with garbage collection writes a stream as a bare dictionary, without its
data, when anything else holds a reference to its dictionary

**Version:** 1.28.6 (MuPDF.js 1.28.6); the C code is unchanged on master (b20db02b9)

## Steps to reproduce

1. Save `0005-repro.mjs` and run `node 0005-repro.mjs path/to/mupdf.js`. It writes a one-page
   PDF by hand: the page draws image 5, whose dictionary holds `/SMask 6 0 R`.
2. It opens the file, resolves the reference to image 5 and keeps the `PDFObject`, then saves
   with `garbage=4` and opens the result again.

## Actual result

Image 5 is written as `<</Type/XObject/Subtype/Image … /SMask 6 0 R/Length 4>>` with no stream,
so the page draws nothing there. The same happens with `garbage=2`. Nothing in the document was
changed and no stream data was read; the object's number need not change.

In MuPDF.js 1.28.6 it also happens after the `PDFObject` is destroyed, as its constructor keeps
the `pdf_obj` a second time (fixed on master by b8d579fee, "wasm: Fix memory leak where we keep
pdf_obj twice!").

## Expected result

The image keeps its data, as it does when nothing holds its dictionary, or with `garbage=1`.

## Cause

In `source/pdf/pdf-write.c`, `renumberobj` edits a dictionary in place when the xref holds its
only reference. Edits made while saving don't move the object to the incremental xref section, so
its entry keeps `stm_ofs`. When anything else also holds the dictionary (`!pdf_obj_is_singleton`),
`renumberobj` works on a copy, and `renumberobjs` stores the copy with `pdf_update_object`. That
calls `pdf_get_incremental_xref_entry`, which for an object not yet in the incremental section
gives a new, empty entry, with `stm_ofs` 0 and no `stm_buf`. `renumberobjs` then moves that entry
into the compacted xref, and `pdf_obj_num_is_stream` says the object is not a stream.

Bug 709830 reaches the same lines another way: after `removeduplicateobjs` finds a duplicate, the
second pass runs on the xref the first pass replaced, and a stream made in the session, still
held, is copied there.

## Fix

The patch calls `pdf_xref_ensure_incremental_object` before `pdf_update_object` in
`renumberobjs`, so the object's own entry, with its stream offset or buffer, moves to the
incremental section first, as an edit to the object would move it. It changes nothing for an
object already there. `0005-repro.mjs` checks both paths, with `garbage=1` and an unshared stream
as controls.

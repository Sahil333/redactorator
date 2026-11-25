# Bug report for bugs.ghostscript.com: patch 0004

To file at https://bugs.ghostscript.com/ with MuPDF as the component. Attach `0004-repro.mjs`
and `../patches/0004-Send-pending-text-state-before-a-form-XObject.patch`. Not yet filed.

---

**Summary:** The sanitize filter loses a text-state change made in an empty text object before a
form XObject, so the form's text is drawn with the earlier text state

**Version:** 1.28.6 (MuPDF.js 1.28.6)

## Steps to reproduce

1. Save `0004-repro.mjs` and run `node 0004-repro.mjs path/to/mupdf.js`. It builds one page:

   ```
   BT /F1 12 Tf 3.9 Tc 72 700 Td (Spaced) Tj ET BT 0 Tc ET /Fm Do
   ```

   where the form `Fm` draws `BT /F1 12 Tf 0 Tc 72 650 Td (Secret text) Tj ET`.
2. It saves the page with `clean,sanitize`, and separately applies a redaction over "Secret"
   inside the form, and compares where the form's letters are before and after each.

## Actual result

After `clean,sanitize`, the form's letters are 3.9 points further apart each. After the
redaction, the rest of the form's line, " text", moves the same way ("t" from x 110.0 to 113.9).
The form's own `0 Tc` is gone, and so is the page's empty `BT 0 Tc ET`.

## Expected result

The letters stay where they were, as a form inherits the text state in force where it is drawn,
and that state is `0 Tc`.

## Cause

In `source/pdf/pdf-op-filter.c`, text-state operators only update the pending state, and
`filter_flush` sends it only inside a text object (under `p->in_BT`). The empty text object is
never written, so its `0 Tc` stays pending, and `pdf_filter_Do_form` does not send it. The form is
filtered on its own from the default text state, so its `0 Tc` looks redundant and is dropped.

## Fix

The patch sends any pending `Tc`, `Tw`, `Tz`, `Tr` and `Ts` in `pdf_filter_Do_form`, after its
existing `filter_flush`. Text-state operators are allowed outside a text object. It does not
send a pending `Tf` or `TL`: a form that relies on an inherited font or leading set in an empty
text object would still draw with the earlier one. Sending `Tf` there would also mean copying the
font resource onto the page, and forms nearly always set their own font.

Seen in the IRS 1040 instructions (i1040gi.pdf, page 42), whose "TIP" and "CAUTION" icons are
forms: their labels ran past the icons and were clipped.

# Bug report for bugs.ghostscript.com

To file at https://bugs.ghostscript.com/ with MuPDF as the component. Attach `repro.mjs`, the
`repro.pdf` it writes, and `0001-Keep-text-after-a-redacted-character-in-place.patch`. Once filed,
add the bug number to the patch's subject and the pull request title, in MuPDF's style
("Bug NNNNNN: ...").

---

**Summary:** Redaction moves the text after a removed character back by that character's advance

**Version:** 1.28.6 (MuPDF.js 1.28.6 from npm), and master at 067ee07 (19 Nov 2026)

## Steps to reproduce

1. `npm install mupdf@1.28.6`
2. Save the attached `repro.mjs` and run `node repro.mjs`. It writes the attached `repro.pdf`:
   one page, one line of 12pt Helvetica:

   ```
   BT /F1 12 Tf 72 700 Td [(Read the about it)] TJ ET
   ```

3. The script then redacts "the" with a Redact annotation over its three characters, applies it
   with text removal only, and prints where each remaining letter was and is.

## Actual result

Every letter after the removed word lands 3.336pt to the left, which is the advance of "t":

```
letter  x before  x after  moved
a        124.032  120.696  -3.336
b        130.704  127.368  -3.336
...
t        160.056  156.720  -3.336
```

The rewritten content stream is:

```
BT/F1 12 Tf 72 700 TD[(Read )-1111.9995( about it)]TJ ET
```

The gap should be -1390 (t 278 + h 556 + e 556). It is short by the first removed character.

## Expected result

The remaining text stays where it was: `[(Read )-1390( about it)]TJ`, and no letter moves.

## Where else it happens

The same shift appears whenever a removal starts after the beginning of a string:

- a word in the middle of a `TJ` string, or at its end;
- with `Tc`, `Tw`, `Tz`, rotated text, and two-byte (Identity-H and Identity-V) fonts;
- a single character removed from a `Tj` string. Here the next segment is written with no `TD`
  at all, so it is drawn right after the text before it.

A removal that starts at the beginning of a string is unaffected, which is why a word drawn
as its own string comes out right.

## Cause

In `filter_string_in_segments` (`source/pdf/pdf-op-filter.c`), `filter_string_to_segment` stops
at the first character to remove, but `filter_show_char` has already moved `p->tos.tm` past it.
After sending the segment, the code sets `p->sent_tm = p->tos.tm`, which is the position after
the removed character, not the end of the text sent. `segment_to_array` (and `filter_flush`
for `Tj`) then compute the next gap from that `sent_tm`, one character short.

## Proposed fix

Have `filter_string_to_segment` report the text matrix before the character it stopped at, and
set `p->sent_tm` to that. The attached patch, against master 067ee07, does this (12 lines
added, 4 removed). On master, without it, 31 of 45 synthetic cases move letters; with it, none
does. They cover the constructions above, plus text rise, all eight render modes, `'` and `"`,
`T*`, `Tm` with scaling, font and size changes mid-line, negative `Tc`, large kerning gaps,
marked content and ActualText around the word, and form XObjects.

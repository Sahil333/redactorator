# Pull request, ready to open

Branch `fix-redaction-text-shift` on https://github.com/Sahil333/mupdf, one commit on
ArtifexSoftware/mupdf master 067ee07. Not opened. To open it, visit:

https://github.com/ArtifexSoftware/mupdf/compare/master...Sahil333:mupdf:fix-redaction-text-shift

and paste the title and body below. File the bug report first (`bug-report.md`), then put its
number in the title, as MuPDF's commits do.

---

**Title:** Keep text after a redacted character in place

**Body:**

When a redaction removes characters from the middle of a string, the sanitize filter moves the rest of the line back by the advance of the first removed character.

`filter_show_char` moves `p->tos.tm` past every character it processes, removed or not. `filter_string_in_segments` then sets `p->sent_tm = p->tos.tm` after sending the text before the removal, so `sent_tm` points after the removed character instead of at the end of the sent text. The next gap, a `TJ` adjustment in `segment_to_array` or a `TD` from `filter_flush` for `Tj`, comes out one character short.

With 12pt Helvetica, redacting "the" from `[(Read the about it)] TJ` gives `[(Read )-1112( about it)]TJ` instead of -1390, and " about it" lands 3.336pt to the left. Removing a single character from a `Tj` string shifts the rest of it the same way. A removal at the start of a string is unaffected.

This change has `filter_string_to_segment` report the text matrix before the character it stopped at, and records that as `sent_tm`.

**Testing.** Built MuPDF.js from master 067ee07 with Emscripten 4.0.8, with and without this commit, and redacted a word in 45 synthetic one-line pages:
- `Tj` and `TJ`, with the removal mid-string, at a string's end, inside a kerned word, and in two places;
- `Tc`, `Tw`, `Tz`, text rise, all eight render modes, `'`, `"` and `T*`;
- `Tm` with scaling, rotation, font and size changes mid-line;
- marked content and ActualText, form XObjects;
- Identity-H and Identity-V fonts.

Without the commit, 31 of them move letters; with it, none does. A reproduction script is in the bug report.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# MuPDF.js, patched

The app uses this build of MuPDF.js 1.28.6 instead of the npm package. It is the official
1.28.6 source with two fixes to how redaction keeps the text around a removed word in place.
Without them, removing text can move the rest of its line, so the cleaned file's layout
changes and the next word can slide under the redaction box.

| Patch | Source | Fixes |
|---|---|---|
| `patches/0001-…` | Artifex commit 37d283e0 (Bug 709904), in MuPDF after 1.28.6 | Text after a removal in horizontally scaled text (`Tz`) lands too far along the line |
| `patches/0002-…` | Ours, not yet in MuPDF | Text after a removal moves back by the width of the first removed character. Happens whenever removal starts after the beginning of a string: in `TJ` arrays, and in `Tj` strings when one character is removed |

The second bug is in `filter_string_in_segments` in `source/pdf/pdf-op-filter.c`: after
sending the text before a removed character, it records the end of the sent text as the
position after that character.

## Reporting it upstream

`upstream/` holds the report for MuPDF's bug tracker (`bug-report.md`, with `repro.mjs` to
reproduce it on stock MuPDF.js), the same fix rebased onto MuPDF master as a patch, and the
description for a pull request from the branch `fix-redaction-text-shift` on
https://github.com/Sahil333/mupdf. Neither has been submitted yet.

## Rebuilding

`./build.sh` clones the 1.28.6 tag with its submodules, applies `patches/`, builds in
Emscripten 4.0.8's image (pinned by digest; it runs as linux/amd64) with the build tools
pinned by `build/package-lock.json`, copies the result into `package/dist`, and checks it
against `SHA256SUMS`. The build is reproducible: with no patches it gives byte-for-byte the
files in the npm package `mupdf@1.28.6`.

## Removing

Once a MuPDF.js release has both fixes, set `mupdf` in `package.json` back to that npm
version, delete this folder, and run the browser tests.

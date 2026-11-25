# MuPDF.js, patched

The app uses this build of MuPDF.js 1.28.6 instead of the npm package. It is the official
1.28.6 source with three patches:
- two fixes to how redaction keeps the text around a removed word in place. Without them,
  removing text can move the rest of its line, so the cleaned file's layout changes and the
  next word can slide under the redaction box;
- three save options that preparation uses to clean a file before marking (Phase 3,
  `docs/designs/pdf-leak-suite.md` part 5).

| Patch | Source | Fixes |
|---|---|---|
| `patches/0001-…` | Artifex commit 37d283e0 (Bug 709904), in MuPDF after 1.28.6 | Text after a removal in horizontally scaled text (`Tz`) lands too far along the line |
| `patches/0002-…` | Ours, not yet in MuPDF | Text after a removal moves back by the width of the first removed character. Happens whenever removal starts after the beginning of a string: in `TJ` arrays, and in `Tj` strings when one character is removed |
| `patches/0003-…` | Ours, not yet in MuPDF | Adds the save options `drop-hidden-oc` (drop content on layers that are off, and the layer markers), `drop-mc-properties` (a `BDC` with properties other than a layer becomes a `BMC`, a `DP` an `MP`) and `blank-unshown-pixels` (blank image pixels outside the page or every clip, in place, so shared images stay shared). Each runs the sanitize filter. Also fixes layer rules (OCMDs) with `/P /AllOn` or `/AnyOff`, which MuPDF judged wrongly, both when drawing and when dropping |

The second bug is in `filter_string_in_segments` in `source/pdf/pdf-op-filter.c`: after
sending the text before a removed character, it records the end of the sent text as the
position after that character.

Patch 0003's options are in `source/pdf/pdf-op-filter.c` (hidden layers and marked
content), `source/pdf/pdf-clean.c` (pixel blanking, next to image redaction, whose pixel code
it shares) and `source/pdf/pdf-write.c` (the option parser); the layer rule fix is in
`source/pdf/pdf-layer.c`.

## Reporting it upstream

`upstream/` holds, for patch 0002, the report for MuPDF's bug tracker (`bug-report.md`, with
`repro.mjs` to reproduce it on stock MuPDF.js), the same fix rebased onto MuPDF master as a
patch, and the description for a pull request from the branch `fix-redaction-text-shift` on
https://github.com/Sahil333/mupdf. For patch 0003 it holds a feature request
(`0003-feature-request.md`), the pull request text (`0003-pull-request.md`) and
`0003-repro.mjs`, which builds synthetic files and prints PASS or FAIL for each option; run
it by hand with `node upstream/0003-repro.mjs` (it uses this folder's build unless given
the path to another `mupdf.js`). Patch 0003 has not been rebased onto master. None of these
has been submitted yet.

## Rebuilding

`./build.sh` clones the 1.28.6 tag with its submodules, applies `patches/` in order with
`git am`, builds in Emscripten 4.0.8's image (pinned by digest; it runs as linux/amd64) with
the build tools pinned by `build/package-lock.json`, copies the result into `package/dist`,
and checks it against `SHA256SUMS`. The build is reproducible: with no patches it gives
byte-for-byte the files in the npm package `mupdf@1.28.6`, and two runs with the same
patches give the same files.

After changing a patch, the final check fails, as it should. Regenerate the sums with
`shasum -a 256 package/dist/* > SHA256SUMS`, check them with `shasum -a 256 -c SHA256SUMS`,
then run `pnpm install` so that `node_modules` picks up the new build, and the browser tests.
To make a patch, commit the change on top of the earlier patches in a clone of the 1.28.6
tag, and run `git format-patch -1`.

## Removing

Once a MuPDF.js release has both fixes and the three save options (under these names, or
others the preparation code is changed to use), set `mupdf` in `package.json` back to that
npm version, delete this folder, and run the browser tests. Until then a patch can only be
dropped when its change is in the release this folder builds; patch 0003 also needs the
`0003-repro.mjs` checks to pass on that release.

# engine/detect

## Overview

The detection worker: a Web Worker that searches one page's characters at a
time for the identifiers in Auto mode's packs and reports hits
(docs/designs/auto-mode.md, Technical Plan, sections 1 to 3). It shares
nothing with the PDF worker. Nothing imports this folder but the tests; the
host starts the worker from `detectWorker.ts` by URL, so no pack reaches the
main bundle.

This phase's only recognizer is the pattern recognizer: a rule is a regular
expression over the page as written, with a value group, and optionally
`notNextTo`, a validator, a list, labels, a companion and rules it gives way
to. The rules are written in YAML and compiled by `tools/packs/`; how to write
one is in [tools/packs/README.md](../../tools/packs/README.md).

## Interface

- `detectWorker.ts`: the worker entry, the only file here that knows it runs
  in a worker. It wires `postMessage` to `messages.ts:post` and each message
  to `handler.ts:handle`. It is typechecked by `tsconfig.worker.json`, which
  adds the `WebWorker` library, and Vite builds it as
  `assets/detectWorker-<hash>.js`.
- `handler.ts:handle(data)`: `load` loads the named packs and their lists
  (`loadPacks.ts`) into a new pattern recognizer, answering `ready` with each pack's id and version,
  or `failed` with `recognizer-failed`. `page` runs the recognizer and answers
  `hits` with the page's hits and the number of values that met an error in a
  check.
- `messages.ts`: `setSend` and `post`, as `engine/pdf/messages.ts` has.
- `loadPacks.ts:loadPacks(ids)`: the compiled packs `ids` names and the lists
  their rules use, parsed, or `undefined` when one is missing or does not
  parse.
- `recognizer.ts`: the contract. `Recognizer` (`load(packs, lists)` once, then
  `detect(page, chars)` per page, returning `PageResult { hits, errors }`),
  `Rule`, `Labels`, `Pack`, `List`, `NotNextTo`, `LabelSide`, and
  `parsePack(value)` and `parseCompiledList(value)`, which read compiled files
  or give `undefined`.
- `regexEngine.ts`: `RegexEngine` (`compile(rules)` gives `scan(text, judge)`,
  which hands `judge` each match with its rule, the span of the whole match,
  of the value group and of the list group, and keeps what `judge` does not
  reject) and
  `jsRegexEngine`, JavaScript's `RegExp` with the flags `d`, `g` and `u`.
- `patternRecognizer.ts:patternRecognizer(engine, validators)`: the pattern
  recognizer.
- `validators/`: one file per pack, each exporting its validators by the name
  rules give them (`universal.ts:card`, `in.ts:aadhaar`); `shared.ts` (`luhn`,
  `verhoeff`, `mod97`, `weightedSum`); and `index.ts:validators`, every export
  of the nine files by name, with the `Validator` type.
- `packs/src/`, `packs/lists/`: the YAML sources of the nine packs and six
  lists. `packs/generated/`: what the compiler writes from them, not
  committed (`pnpm build`, `pnpm dev` and the tests write it first): a JSON file per pack and per list, and `index.ts` with
  `compiledPacks` (by id) and `compiledLists` (by name).

## Invariants

- **Rules run on the page as written.** The text view
  (`engine/model/textView.ts`) keeps every character and line end, and maps
  each string position back to its character, so a character of two UTF-16
  units before a value does not shift the hit (`patternRecognizer.ts`).
- **A hit's text is read with `rangeText`**, the function a mark's text is
  read with (`patternRecognizer.ts:pageTextOf`). A `page` message's entry is
  `"\n"` exactly where the stored character has no box (the client's
  contract), so the text matches what `rangeText` reads on the stored page.
- **A validator sees the value's letters and digits only**, and looks nothing
  up. One that throws costs that value only: it is counted in the page's
  `errors` and the value is not offered (`patternRecognizer.ts:evidenceOf`).
- A hit is kept only when its evidence meets the rule's `needs`. Its evidence
  is each of `checksum` (a passed validator), `list` (its list group's text is
  an entry), `label` and `companion` that holds, else `format`
  (`patternRecognizer.ts:firstPass`, `withCompanion`). A label, a list and a
  companion carry the rule's own words, never page text.
- A label or a companion counts only within its distance in characters and
  in the same block: a block ends at two line ends in a row.
- A rule that `yieldsTo` another loses its hit where the other has a hit with
  a label on the same span.
- `errors` counts values, not checks: spans that met an error and overlap
  count once, since the retry after a rejected match can meet one value again
  (`patternRecognizer.ts:errorCount`).
- `notNextTo` is checked on the whole characters just before and after the
  value.
- **Hits come in tie-break order:** the packs in `packOrder`, whatever order
  `load` names them in, and each pack's rules in the order they are written.
  The resolver breaks a tie between two identifiers on one span by this order
  (`patternRecognizer.ts`).
- One rule's kept matches come left to right without overlap. A match the
  recognizer rejects (by `notNextTo`, its validator or its evidence), or a
  match of length zero, moves the scan on by one character, so a value a
  longer rejected match took in is still found and the loop ends
  (`regexEngine.ts:scanOne`). A rule that needs a companion keeps its match
  for the second pass, so a value inside it is not retried. On a page of
  1,836 digit groups that fail their checks, joined by single spaces, a run
  with every pack takes under 0.2 s on the instrumented build (slice P0).
- **Loading fails closed.** A pack id with no compiled pack, a pack or list
  that does not parse, a pattern that does not compile, a value or list group
  the pattern does not have, or a validator or list name that is not there
  answers `failed` with `recognizer-failed`.
- A message the worker cannot read, or a page of a run whose packs are not
  loaded, throws; the core sees the worker fail (`detector-failed`).
- No timer: a page runs until it is done, and only the core's `stop` ends it.
- **Boundary.** `.fallowrc.json` zone `detect` may import only `model` and
  `detect-protocol`. The compiled `tsconfig.json` excludes the entry and the
  tests.

## Side Effects

- `detectWorker.ts` posts and receives Web Worker messages. Nothing here makes
  a network request, and nothing is fetched because of a matched value: the
  packs are part of the worker's script.

## Verification

- Run: `pnpm test`. It includes `tsc -p engine/detect`,
  `tsc -p engine/detect/tsconfig.worker.json`, and the unit tests
  `regexEngine.test.ts` and `patternRecognizer.test.ts`. The browser tests
  `tests/e2e/auto-run.spec.ts`, `packs.spec.ts`, `bundle.spec.ts` and
  `network.spec.ts` run the worker from the app.

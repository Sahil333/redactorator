# engine/detect

## Overview

The detection worker: a Web Worker that searches one page's characters at a
time for the identifiers in Auto mode's packs and reports hits
(docs/designs/auto-mode.md, Technical Plan, sections 1 to 3). It shares
nothing with the PDF worker. Nothing imports this folder but the tests; the
host starts the worker from `detectWorker.ts` by URL, so no pack reaches the
main bundle.

This phase's only recognizer is the pattern recognizer: a rule is a regular
expression over the page as written, with a value group, an optional
`notNextTo` and an optional validator. Labels, lists, companions and
`yieldsTo` come with slice P0.

## Interface

- `detectWorker.ts`: the worker entry, the only file here that knows it runs
  in a worker. It wires `postMessage` to `messages.ts:post` and each message
  to `handler.ts:handle`. It is typechecked by `tsconfig.worker.json`, which
  adds the `WebWorker` library, and Vite builds it as
  `assets/detectWorker-<hash>.js`.
- `handler.ts:handle(data)`: `load` parses the named packs and loads them into
  a new pattern recognizer, answering `ready` with each pack's id and version,
  or `failed` with `recognizer-failed`. `page` runs the recognizer and answers
  `hits` with the page's hits and the number of values that met an error in a
  check.
- `messages.ts`: `setSend` and `post`, as `engine/pdf/messages.ts` has.
- `recognizer.ts`: the contract. `Recognizer` (`load(packs)` once, then
  `detect(page, chars)` per page, returning `PageResult { hits, errors }`),
  `Rule`, `Pack`, `NotNextTo`, and `parsePack(value)`, which reads a compiled
  pack or gives `undefined`.
- `regexEngine.ts`: `RegexEngine` (`compile(rules)` gives `scan(text)`, each
  match with its rule, the span of the whole match and of the value group) and
  `jsRegexEngine`, JavaScript's `RegExp` with the flags `d`, `g` and `u`.
- `patternRecognizer.ts:patternRecognizer(engine, validators)`: the pattern
  recognizer.
- `validators/`: `shared.ts:luhn`, `universal.ts:card` (14 to 19 digits that
  pass Luhn), and `index.ts:validators`, the registry by name, with the
  `Validator` type.
- `packs/generated/`: `universal.json`, one rule (the payment card), and
  `index.ts:compiledPacks`, the packs by id. Both are written by hand until
  slice P0's compiler writes them.

## Invariants

- **Rules run on the page as written.** The text view
  (`engine/model/textView.ts`) keeps every character and line end, and maps
  each string position back to its character, so a character of two UTF-16
  units before a value does not shift the hit (`patternRecognizer.ts`).
- **A hit's text is read with `rangeText`**, the function a mark's text is
  read with (`patternRecognizer.ts:pageTextOf`).
- **A validator sees the value's letters and digits only**, and looks nothing
  up. One that throws costs that value only: it is counted in the page's
  `errors` and the value is not offered (`patternRecognizer.ts:evidenceOf`).
- A hit is kept only when its evidence meets the rule's `needs`: a passed
  validator gives `checksum` (`checked`), anything else `format`.
- `notNextTo` is checked on the whole characters just before and after the
  value.
- One rule's matches come left to right without overlap. A match of length
  zero moves the scan on by one character, so the loop ends
  (`regexEngine.ts:scanOne`).
- **Loading fails closed.** A pack id with no compiled pack, a pack that does
  not parse, a pattern that does not compile, a value group the pattern does
  not have, or a validator name that is not registered answers `failed` with
  `recognizer-failed`.
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
  `regexEngine.test.ts` and `patternRecognizer.test.ts`. No browser test
  reaches the worker until slice V1.

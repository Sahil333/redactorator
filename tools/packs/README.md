# tools/packs

## Overview

The pack compiler. Auto mode's rules are written in YAML, one file per pack,
under `engine/detect/packs/src/`, with the lists they look values up in under
`engine/detect/packs/lists/`. The compiler checks them and writes the JSON the
detection worker imports, into `engine/detect/packs/generated/`. The fixture
generator, `tests/oracle/make_pack_fixtures.py`, lays out each rule's examples
and near-misses as one PDF per pack under `fixtures/packs/`, with a truth file,
and `tests/e2e/packs.spec.ts` runs Auto mode on each
(docs/designs/auto-mode.md, decision D4 and Technical Plan, sections 3, 6 and
9).

This is the page a pack slice works from. A pack slice edits YAML, validators
and lists only. It never needs to touch the compiler, the generator or the
recognizer (`engine/detect/patternRecognizer.ts`).

## Interface

```
pnpm packs            # compile, then regenerate fixtures/packs/; commit what changes
pnpm test:tools       # includes both with --check: fails when a committed file is out of date
```

`pnpm packs` builds the compiler with Vite (`tools/vite.config.ts`, into
`tools/.build/`, which git ignores), runs `node tools/.build/compile.mjs`, then
the generator. Both take `--check`, which writes nothing and fails when a
committed file differs from what they would write.

- `compile.ts`: reads, checks, writes. It prints every problem it finds, one
  per line, as `<file>, rule <id>: <problem>`, and exits 1.
- `rule.ts`: one rule's fields, checked and compiled.
- `slow.ts`: the slow-pattern check, built on `scslre`, with its negative
  control, and the check for a pattern that can match digits only.

## How to add a rule

1. Find a source for the identifier's format and, for a checked rule, for its
   check: the issuer's page, a published standard, or an existing public
   resource such as Microsoft Purview's documentation, Presidio,
   python-stdnum, stdnum-js or validator.js (goal G2). A fact recalled with no
   source is not enough. docs/designs/auto-mode.md, "C0 results and rules left
   out", item 7, names a source for each identifier. If there is none, the rule
   is left out and listed under "Rules left out" in that document.
2. Add the rule to its pack's file, `engine/detect/packs/src/<pack>.yaml`. Its
   pack is the one `engine/model/identifiers.ts` gives the identifier. The order
   of rules in a pack matters: it breaks a tie between two identifiers with the
   same evidence on one span.
3. Run `pnpm packs`, then the pack's browser test:
   `COVERAGE=1 pnpm exec playwright test packs`. It fails until the rule finds
   every example and no near-miss. The browser tests share the port
   127.0.0.1:4173 across worktrees; wait until it is free.
4. Commit the YAML, `engine/detect/packs/generated/`, and `fixtures/packs/`.

### A rule's fields

```yaml
pack: in
rules:
  - id: in-ifsc                 # unique across every pack
    identifier: in-ifsc         # a type id in dataset/ground-truth.schema.json, of this pack
    pattern: '(([A-Z]{4})0[A-Z0-9]{6})'
    value: 1                    # which group of the pattern is the value
    needs: labelled             # the least evidence a hit needs: checked | labelled | format
    labels: ["IFSC", "IFSC Code"]
    labelSide: before           # before | after | either
    distance: 40                # characters; labels, labelSide and distance come together
    notNextTo: letter-or-digit  # letter | digit | letter-or-digit
    validator: null             # an export of engine/detect/validators/<pack>.ts
    list: { name: in-bank-codes, group: 2 }   # a list, and the pattern group looked up in it
    companion: null             # or { rule: in-ifsc, distance: 40 }
    yieldsTo: []                # rule ids
    stdnum: null                # a python-stdnum module, for the generator's check: luhn, in_.aadhaar
    source: "What the source states, and its URL"
    licence: "What the source's terms say"
    verified: { date: "2026-11-28", at: "https://..." }   # where and when the format was read
    examples: ["HDFC0001234"]
    nearMisses: ["HDFC1001234"]
```

A field may be left out, or written `null`, unless it is one of `id`,
`identifier`, `pattern`, `value`, `needs`, `source`, `licence`, `verified`,
`examples` and `nearMisses`. `examples`, `nearMisses` and `stdnum` stay out of
the compiled JSON.

**The pattern** runs with JavaScript's `RegExp` and the flags `d`, `g` and `u`,
on the page as written: its characters in reading order, a line end between
lines and a second one between blocks. Two named pieces exist: `{sep}` is one
separator and `{sep?}` an optional one. A separator is white space other than a
line end, a hyphen, a dot, a dash from U+2010 to U+2015, or the minus sign
U+2212: the joiners `engine/model/match.ts` ignores in a key. So a value never
joins across a line end. Write a number's groups with `{sep?}` between them, or
`{sep}` where a separator is needed.

**Evidence.** A hit's evidence is each of these that holds:

| Kind | When | Level |
| --- | --- | --- |
| `checksum` | the validator passes on the value's letters and digits | checked |
| `list` | the text of the list's group, ignoring case, is an entry of the list | checked |
| `label` | a label lies within `distance` characters on `labelSide`, in the same block | labelled |
| `companion` | a hit of the companion rule, kept on its own evidence, lies within `distance` characters in the same block | labelled |
| `format` | none of the above | format |

A hit is kept when its strongest evidence reaches `needs`. A value that fails
its validator only lacks `checksum`; with `needs: checked` and no list, that
drops it.

- **Labels** are compared after `keyOf` (`engine/model/match.ts`): case,
  spacing and punctuation at either end do not matter, so "Acct No." and
  "acct no" match each other. A label must lie wholly within `distance`
  characters of the value, sit on word boundaries, and be in the same block.
  The nearest label is the one the panel names. There is no "same row" or
  "same column" in this phase, so a label in a table drawn column by column is
  not found (C0, item 2). Prefer `labelSide: before`: in a table of two pairs
  to a row, the next pair's label follows the value.
- **`yieldsTo`**: the hit is dropped when a named rule has a hit with a label
  on exactly the same span. The Aadhaar rule gives way to the UAN rule this
  way.
- **`companion`**: the companion rule must be in the same pack and must not
  have a companion of its own.

**The panel's words.** A label is named as the rule writes it, a list by its
`title`, a companion by its identifier's name: "next to the label IFSC Code",
"is a known Indian bank code", "near a IFSC". Never text from the page.

### Examples and near-misses

Each is a value, or `{ value, line, asWritten }`:

- `line` is the text of the line it is planted on, with `{value}`, and
  optionally `{label}` (the rule's labels, in turn) and `{companion}` (the
  companion rule's first example). Without it the line is `{label}: {value}`
  for a rule with labels, else `{value}`.
- `asWritten: true` plants the value once, as written, for a value that is
  not a number in groups but has dots or hyphens between digits, such as an IP
  address or a date.

The generator plants each on a line of its own, one line to a block, so a
label never reaches the next value. A value whose digits are grouped is
planted in seven ways: plain, and with a space, a hyphen, a dot, an en dash, a
minus sign and a no-break space between its groups. The truth file lists each
example once, with its number of places. Every value must be synthetic.
Characters outside printable ASCII, the en dash, the minus sign and the
no-break space cannot be written in the fixture's font.

**How the browser test judges.** An example passes when a row has its key,
its identifier and its number of places. A near-miss fails the test when a row
whose identifier belongs to the pack under test has its key. Rows of other
packs are listed in the test's output, and do not fail it. So two examples, or
an example and a near-miss, of one pack must not share a key, and an example
of one rule must not also be found by a rule with stronger evidence: a
12-digit example can pass the Aadhaar check, and a 14- to 19-digit one Luhn.

## How to add a validator

Export it from `engine/detect/validators/<pack>.ts`, named as rules give it in
`validator`. It takes the value's letters and digits, returns whether the value
passes, and looks nothing up. `index.ts` takes every export of the nine files,
so it needs no edit. `shared.ts` has `luhn`, `verhoeff`, `mod97` and
`weightedSum`. Give the rule a `stdnum` module when python-stdnum has one, so
the generator checks each example against it.

## How to add a list

Fill `engine/detect/packs/lists/<name>.yaml`:

```yaml
name: in-upi-handles          # the file's name
title: UPI handle             # "is a known {title}"
source: "Where the list was read, with its URL"
licence: "What its terms say, as they say it; do not soften them"
read: "2026-11-28"
entries: [apl, yapl]
```

A list with no entries is a placeholder and needs nothing but `name`. The
owner allows a publicly readable list to be used even where its terms do not
grant copying; record the terms as they are (docs/designs/auto-mode.md,
section 6).

## What each failure means

The compiler:

| Message | What to do |
| --- | --- |
| `unknown field` | A typo, or a field this format does not have |
| `identifier is not a type` | Add the identifier to `dataset/ground-truth.schema.json` first (CUJ 10) |
| `identifier belongs to the pack ...` | The rule is in another pack's file than `engine/model/identifiers.ts` gives |
| `names a piece other than {sep} and {sep?}` | A `{` followed by a letter: only the two pieces exist |
| `the pattern does not compile, or lacks a group it names` | The browser's `RegExp` refuses it with `du`, or `value` or the list's `group` is not a group of it |
| `the pattern is slow` | scslre found a shape whose running time grows faster than the text, such as a repeat inside a repeat, or two repeats that can trade characters. Bound the repeats or make the parts exclusive |
| `the slow-pattern check does not call (a+)+$ slow` | The check itself is broken; the build stops |
| `needs: format is refused for a pattern that can match digits only` | A number needs a check, a list, a label or a companion |
| `needs: ... can never be met` | `checked` needs a validator or a list; `labelled` also accepts labels or a companion |
| `validator names no validator` | Export it from `engine/detect/validators/<pack>.ts` |
| `list names ..., which is not a list with entries` | Fill the list, or fix its name |
| `companion must name another rule ...` / `yieldsTo names ...` | The rule id does not exist, is the rule itself, or (for a companion) is in another pack or has a companion of its own |
| `the rule id ... is used twice` | Rule ids are unique across all packs |
| `differs from what the compiler writes` (`--check`) | Run `pnpm packs` and commit |
| `the worker could not read this pack` | The compiler and `engine/detect/recognizer.ts:parsePack` disagree: a fault in this tool |

The generator:

| Message | What to do |
| --- | --- |
| `the example ... fails stdnum.<module>` | The example is not a valid value; fix it |
| `the near-miss ... passes stdnum.<module>` | The near-miss is a valid value; make it fail the check |
| `the character ... cannot be written in the fixture's font` | Use printable ASCII, the en dash, the minus sign or the no-break space |
| `is not what make_pack_fixtures.py writes` (`--check`) | Run `pnpm packs` and commit |

The browser test, `packs.spec.ts`, lists the examples missed and the
near-misses found, and every other row.

## Invariants

- **A pack's version** is the first 12 hex digits of the SHA-256 of the UTF-8
  bytes of `JSON.stringify({ rules, lists })`, with no spaces: `rules` as the
  compiled file holds them, `lists` the compiled lists its rules name, in the
  order first named. A change to a rule, or to a list it uses, changes it.
- The compiled index (`generated/index.ts`) imports all nine packs and all six
  lists, so its shape does not change when a pack slice fills one.
- The compiled JSON ships only in the detection worker's script;
  `tests/e2e/bundle.spec.ts` checks that the main bundle holds no pack text.

## Side Effects

- `compile.mjs` writes and removes files under
  `engine/detect/packs/generated/` only; the generator under `fixtures/packs/`
  only. Neither makes a network request.

## Verification

- `pnpm test:tools` runs both with `--check` and the generator's tests
  (`tests/oracle/tests/test_make_pack_fixtures.py`).
- `pnpm test:coverage` runs `tests/e2e/packs.spec.ts` and `bundle.spec.ts`.

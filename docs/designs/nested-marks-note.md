# Overlapping marks with printed types

* **Date:** 2026-11-28
* **Status:** decided by the owner and built.

## The fault

With "Print the type in each box" on, two marks whose boxes overlapped made
Preview fail with "The cleaned file failed a check on page 1. This PDF can't be
cleaned here yet." No download was offered, before or after approval. Nothing
leaked: the writer's own check refused the file it wrote. With the setting off
the same marks were cleaned.

The cause was in the writer, not in the marks:

- `drawBoxes` (`engine/pdf/write/redact.ts`) drew every redaction's box and,
  with labels on, that redaction's label centred inside it.
- `textUnderBoxes` (`engine/pdf/write/check.ts`) requires, for each box, that
  the letters whose centre is inside that box spell exactly that box's own
  label.

So a box failed when a letter of another box's label had its centre inside it.

Overlapping marks come about by hand (`marks.add` accepts any target) and by
spreading: `placeMark` (`engine/model/spread.ts`) skips a place only when an
existing mark covers all of it, so a wider value spread onto a narrower mark
leaves both. A one-off unit run confirmed that.

## The decision

The owner decided on 2026-11-28, after weighing refusing overlapping marks,
splitting them and joining them:

- **Marks may overlap.** Each mark stands on its own, like bosons sharing a
  place. Nothing is refused, removed or split when marking or spreading, so a
  value marked once still spreads to every place it is found.
- **The writer prints no type under another box** (the option called A while
  it was discussed). A box whose type would lie under another box prints none.
  The simplest rule was chosen over printing one type for a group of boxes of
  one type, which would have changed the writer's check.

## What was built

- `engine/pdf/write/redact.ts`: `typesInTheClear` empties a redaction's
  `printed` where another box lies over the place its label would be printed,
  and `drawBoxes` prints no label for it. The place is where the label's
  letters would be: its width, and the height of its brackets. The centre of
  each letter, where the check reads it, is inside that.
- `engine/pdf/write/check.ts` is unchanged. It expects nothing under a box
  that prints none, so a label placed wrongly is still refused.
- A box that no other box overlaps is written as before.

What a user sees with labels on:

| Marks on one page | Cleaned file |
| --- | --- |
| "Roe" inside "Jane Roe", of different types or of one type | both removed, neither box prints a type |
| "Dear Jane" and "Jane Roe", sharing "Jane" | both removed, neither box prints a type |
| "Dear" at the end of a mark that runs far past it | the wide box prints its type in its middle, the short one prints none |
| "Ja" and "ne", whose boxes only touch | both print their types, as before |
| A drawn box across "Jane Roe" | both removed, neither box prints a type |

`tests/e2e/overlapping-marks.spec.ts` makes each of these in the browser and
the outside checker judges every download. The fixture is the existing
`fixtures/one-word.pdf`.

## What was not done

- **One type for overlapping boxes of one type.** They print none, as boxes of
  different types do.
- **A notice that a box printed no type.** The user sees it in the preview.
- **Entries in `tests/oracle/leak-vectors.json`.** An entry makes one mark, and
  these cases need two. The owner asked for the proof to be kept light.
- **Pseudonymisation.** What overlapping marks print as replacements is that
  phase's decision. The owner's first thought is one replacement for the union
  of the text, with the marks kept separate.
- **Auto mode.** `docs/designs/auto-mode.md` says Auto mode makes no
  overlapping marks (decision D11) and calls this fault outside its phase. The
  owner now expects Auto mode to be able to make overlapping findings; that
  design is the planning session's to change.

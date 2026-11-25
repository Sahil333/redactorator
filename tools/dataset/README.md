# tools/dataset

## Overview

The Python tools for the dataset. Today the folder holds the ground-truth
validator, which checks ground-truth JSON files against
`dataset/ground-truth.schema.json` and against the rules that JSON Schema
cannot state. `pyproject.toml` says a synthetic document generator will come
later. The `uv` project (`redactorator-dataset`, not a package) needs Python
3.12 or later and pins `jsonschema==4.26.0`. pytest 9.2.0 is in its dev group.

## Interface

- `validate.py`:
  - `problems(truth: object) -> list[str]` returns one reason per problem, or
    an empty list when the file is valid.
  - `SCHEMA` is the parsed `dataset/ground-truth.schema.json`.
  - `UNIT_FOR_FORMAT` maps each document format to its box unit.
  - The command-line use is
    `uv run --project tools/dataset python tools/dataset/validate.py <file.json>...`.
- `tests/` holds the pytest suite (`test_validate.py`). This contract does not
  cover it.

## Invariants

`validate.py:problems` checks the following.

- Schema validation runs first, with `Draft202012Validator`. When the schema
  check finds errors, or the input is not an object, `problems` returns only
  those errors.
- `document.box_unit` must match `UNIT_FOR_FORMAT[document.format]`:

  | `format` | `box_unit` |
  | --- | --- |
  | `born-digital-pdf` | `pt` |
  | `scanned-pdf` | `pt` |
  | `image` | `px` |
  | `text` | `none` |

- Entity ids are unique.
- Every `occurrences[].entity_id` and `hidden_occurrences[].entity_id` names an
  existing entity.
- In an occurrence, `start` comes before `end`.
- In a `text` document, an occurrence has no boxes and must have `start` and
  `end`. In any other format, an occurrence needs at least one box.
- In every box, `x0 < x1` and `y0 < y1`.

## Side Effects

- At import, reads `dataset/ground-truth.schema.json`, resolved as
  `Path(__file__).resolve().parents[2]` (`validate.py:SCHEMA`).
- When run as a script, it does three things:
  - reads each file named on the command line;
  - prints `<file>: <problem>` lines to stdout;
  - exits with `1` if any problem was found, and `0` otherwise.

## Verification

- Run: `uv run --project tools/dataset python -m pytest tools/dataset -q`. This
  runs as part of `pnpm test:tools`, which `pnpm test` includes.

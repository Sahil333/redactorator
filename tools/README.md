# Tools

## Overview

Developer tools that run outside the browser app. They are not shipped with it.

## Subdirectories & Boundaries

- arlington: `generate.py` writes the allowlist's role table, `engine/pdf/allowlistRoles.generated.ts`, from the vendored Arlington PDF Model (`vendor/arlington`) and our decisions (`engine/pdf/allowlist-decisions.json`). Python's standard library only. `--check`, run by `pnpm test:tools`, fails when the table is not what it would write.
- dataset: [./dataset/README.md](./dataset/README.md) - The Python dataset tools (a uv project). `validate.py` checks ground-truth files against `dataset/ground-truth.schema.json` and the cross-field rules the schema cannot state. Run by `pnpm test:tools`.

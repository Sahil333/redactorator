# Tools

## Overview

Developer tools that run outside the browser app. They are not shipped with it.
The TypeScript tools import engine sources, so Vite builds each into one file
for Node (`tools/vite.config.ts`, into `tools/.build/`, which git ignores):
`pnpm build:tools`. `tools/tsconfig.json` typechecks them, and the `tools`
zone in `.fallowrc.json` lets them import `model` and `detect`.

## Subdirectories & Boundaries

- arlington: `generate.py` writes the allowlist's role table, `engine/pdf/allowlistRoles.generated.ts`, from the vendored Arlington PDF Model (`vendor/arlington`) and our decisions (`engine/pdf/allowlist-decisions.json`). Python's standard library only. `--check`, run by `pnpm test:tools`, fails when the table is not what it would write.
- dataset: [./dataset/README.md](./dataset/README.md) - The Python dataset tools (a uv project). `validate.py` checks ground-truth files against `dataset/ground-truth.schema.json` and the cross-field rules the schema cannot state. Run by `pnpm test:tools`.
- packs: [./packs/README.md](./packs/README.md) - The pack compiler: Auto mode's YAML rules and lists to the JSON the detection worker imports, with the checks every rule must pass. `pnpm packs` runs it and the fixture generator; `pnpm test:tools` runs both with `--check`.

# Tools

## Overview

Developer tools that run outside the browser app. They are not shipped with it.

## Subdirectories & Boundaries

- dataset: [./dataset/README.md](./dataset/README.md) - The Python dataset tools (a uv project). `validate.py` checks ground-truth files against `dataset/ground-truth.schema.json` and the cross-field rules the schema cannot state. Run by `pnpm test:tools`.

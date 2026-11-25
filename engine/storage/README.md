# engine/storage

## Overview

The storage port. The engine reaches project storage only through the `Store`
interface, so another backend can take the place of the current one: a folder
on the user's disk, another browser's storage, or a cloud (`store.ts` header
comment). The folder holds only the interface. The browser implementation is
`folderStore` in [engine/host-browser](../host-browser/README.md).

The fallow boundary rules in `.fallowrc.json` (`{ "from": "storage", "allow": [] }`)
forbid this folder from importing any other engine zone.

## Interface

- `Store` (`store.ts`) has these methods. Each returns a `Promise`.
  - `read(path)` resolves to a `Uint8Array`, or `undefined` when there is no file.
  - `write(path, data)` writes a `Uint8Array` or a `string`, and resolves to `void`.
  - `folders(path)` and `files(path)` resolve to the names directly inside `path`.
    The root is `""`.
  - `remove(path)` removes a file, or a folder with everything in it.

## Invariants

These are contracts for every implementation (`store.ts:Store`).

- Paths are relative to the store's root and `/`-separated, for example
  `Folder/.redactorator/project.json`.
- A store refuses a path that has a `..` segment or a leading `/`.
- `read` returns a fresh array that the caller owns.
- `write` creates any missing folders. The file changes only once the whole
  write lands.

## Side Effects

- None at runtime. The folder exports only an interface.

## Verification

- Run: `pnpm test`. It includes `tsc -p engine/storage` and
  `pnpm exec fallow architecture --boundaries`.

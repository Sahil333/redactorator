# Stored formats

## Overview

Encoders and parsers for the JSON files that the app keeps in the user's
browser or folder across app versions:

- a project's `project.json`;
- each document's text;
- each document's images;
- the app's `settings.json`.

Each file carries a `format` name and a `version`, and is checked as a whole
when it is read. [`../stored`](../stored/README.md) uses this folder to read and
write project folders.

## Interface

- `project.ts`
  - `StoredFileProblem`: `"damaged" | "newer"`, the reason a stored file could
    not be used. It is shown to the user.
  - `parseProject(text)` and `projectJson(project)`: format
    `redactorator-project`, version 3.
  - `parseTexts(text, pages)` and `textsJson(texts)`: format
    `redactorator-text`, version 1.
  - `parseImages(text, pages)` and `imagesJson(images)`: format
    `redactorator-images`, version 1.
  - `parseSettings(text)` and `settingsJson(settings)`: format
    `redactorator-settings`, version 1.

## Invariants

- A file whose JSON does not parse, whose `format` is wrong, or whose version
  is missing or below 1 is `"damaged"`. A file whose version is higher than this
  app reads is `"newer"` (`versioned`).
- A project version is raised only together with a migration from every
  earlier version. `parseProject` reads versions 1 to 3. Version 1 had no review
  fields, no hidden values and no spreading: on read, its marks get
  `isNew: false`, and a document with marks is `in-review` (`parseMark`,
  `parseReview`, `parseProject`). Version 2 had no image anchors. A box mark's
  anchor is optional on read, and such boxes are anchored when their document
  is next approved (`project.ts:optionalAnchor`,
  `../../model/spread.ts:anchored`).
- A record that fails any field check makes the whole file `"damaged"`
  (`parseProject`, `parseDocument`, `parseSettings`).
- Stored text must have one entry per page, and its boxes must account for
  every non-newline character. Stored images must each be on an existing page
  (`parseTexts`, `parseStoredPage`, `parseImages`).
- Text boxes are stored rounded to a hundredth of a point (`textsJson`,
  `hundredths`).
- Settings need a valid `appearance` (`parseAppearance`), and custom mark
  types must be non-blank strings. Otherwise the file is `"damaged"`
  (`parseSettings`).

## Side Effects

- None. All functions are pure string and value transforms.

## Verification

- Run: `pnpm test`

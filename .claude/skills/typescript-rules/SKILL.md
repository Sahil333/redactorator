---
name: typescript-rules
description: House rules for writing, refactoring and reviewing TypeScript in Redactorator. Use whenever adding or changing .ts or .tsx code, or reviewing a diff that does.
---

# TypeScript rules

These rules sit under AGENTS.md. Where they conflict with AGENTS.md or a product
rule there, AGENTS.md wins.

## Shape of the code

1. Write only what the task needs. No features, options, helpers or config for
   cases nobody asked for. A few similar lines beat an early abstraction.
   Splitting code into components that each own one responsibility is not an
   early abstraction.
2. Prefer deep modules: a small interface over real work. Delete wrappers that
   only pass calls through.
3. Change behaviour where it lives. Edit the module that owns it instead of
   patching around it from the caller.
4. One source of truth per fact. Derive types from schemas and values from one
   constant; never keep two copies in sync by hand.
5. Pure core, effects at the edge. Parsing, detection and redaction planning are
   pure functions; files, storage, the worker channel and the network sit in thin
   outer layers.
6. Delete dead code in the change that makes it dead. No commented-out code, no
   unused exports.
7. Keep comments minimal; the code is the source of truth. Make names and types
   explain the code instead. Comment only a why the code can't show, such as a
   spec quirk or a leak vector, and never restate what the next line does.

## Types and boundaries

8. Validate at boundaries, trust inside. Untrusted input (files, worker
   messages, stored data, network replies) is parsed into a typed value once, at
   the edge. Inside, don't re-check what the types already guarantee.
9. No escape hatches: no `any`, no `as` casts, no `!` assertions, no
   `@ts-ignore`. If the types can't say it, fix the types or parse the value.
10. Name the types that matter. Use branded types where values must not mix:
    page numbers and page indexes, PDF points and image pixels.
11. Errors are typed values, not strings. A message a user sees says what
    happened and what to do next.

## Tests

12. Integration first: drive the real app in a real browser and judge the output
    file, as the implementation plan says. Mock only what is outside our code.
13. Assert what a user or the outside checker can observe, not internal calls.

## Where this project departs from common advice

- **Fail closed on the export path.** An error, unknown content or failed check
  while writing an output blocks the export and says why. Never catch and
  continue there.
- **Stored formats are versioned.** Working sets, vaults and set exports live in
  users' browsers and must still open after an update (PRD ACC-8). Every stored
  format carries a version and a migration.
- **Dependencies are earned.** The app's trust rests on a small, auditable
  dependency list. Check that a few lines of our own can't do the job and that
  the licence fits the AGPL, then ask the owner before adding a runtime
  dependency.
- **Tidy as needed.** When code you work in or next to is messy, dead or
  misleading, clean it up in the same piece of work without waiting to ask. Keep
  each tidy small and list what you tidied in your summary.

## Checks

- The typecheck must pass. Its command is a package.json script.
- `pnpm exec fallow audit` reports unused code, duplication, cycles and boundary
  breaks in your change. Fix what it finds; the fallow skill has the details.

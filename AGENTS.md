# Redactorator

A browser-only app that removes or pseudonymises personal data in documents of
many file types. Nothing a user loads ever leaves the browser.

## Using this repo
- docs/ holds the product, design and plan documents. They are copies of live
  documents: propose changes to the owner instead of editing them. The
  exception is docs/designs/, which holds design documents written in this
  repo; PRs edit them.
- pnpm manages packages; package.json scripts are the commands.
- Hooks enforce the hard rules. When one blocks you, follow its message; never
  work around it.

## Rules from the product
- No request may carry document bytes, text or findings. Ask before adding any
  new outbound request.
- Redaction deletes; it never only covers. Any change to how the write path
  behaves comes with a leak fixture that the outside checker judges. Moving
  write-path code verbatim, with no edit inside function bodies, needs no new
  fixture: the existing oracle-judged tests prove it.
- Real-world dataset documents never enter the repo.

## How we work
- Browser integration tests first; unit tests only where a bug shows they help.
- Plan before code for changes to the redaction engine.
- Never assume. If a requirement or behaviour is unclear, stop and ask the owner.
- Write only the code the task needs: no speculative features, options or
  abstractions. Components that each own one responsibility are intended
  design, not speculation.
- Each agent works in its own git worktree.

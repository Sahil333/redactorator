# Review instructions

The rules live in AGENTS.md and the skills under `.claude/skills/`. This file
says how to review a change against them and what to report.

## How to review a change

1. **Learn the intent.** Read the PR description and find the phase of the
   Implementation Plan the change belongs to. Judge the change against what it
   set out to do.
2. **Follow the data.** Take any value that comes from a user's document and
   follow it through the code the diff changes, to everywhere it can end up.
   Report a path on which the value reaches a place AGENTS.md does not allow,
   or survives in an output it was meant to be removed from. For example, a
   page's text copied into an error message. Values in `fixtures/` are test
   data and are exempt.
3. **Follow the failures.** Take each way the changed code can go wrong: a
   thrown error, an input it does not recognise, a check that does not run.
   Report a path on which the failure lets an output out instead of stopping
   it, or lets stored data become unreadable.
4. **Check the rules.** Compare the diff with AGENTS.md and the repo's skills.
   Report a line that breaks a rule. A react-best-practices or
   composition-patterns rule applies only when the diff contains the incorrect
   pattern shown in that rule's file.
5. **Check the proof.** The tests should show the change working the way a
   user or the outside checker would see it. Report behaviour the diff adds
   that no test observes. A change to how outputs are written must be judged
   by the outside checker in `tests/oracle/`, which shares no code with the
   app.

## What to report

- A finding quotes the rule it breaks, or states the input and the wrong
  result. Either way it cites a `file:line` in the diff, and a claim about
  behaviour cites the code that shows it.
- **Important:** the change can do something wrong for a user (from steps 2
  and 3, or a bug), or it breaks a rule in AGENTS.md or typescript-rules.
- **Nit:** it breaks a react-best-practices or composition-patterns rule and
  nothing worse follows. Report at most five Nits.
- When something looks wrong but no rule covers it, put one line under
  "Questions for the owner" instead of a finding.

## Do not report

- What the typecheck, `pnpm exec fallow audit` and the project hooks enforce.
- Lines the diff does not touch.
- Options, layers or handling for cases nobody asked for.
- Naming, formatting or structure that no rule names.
- `docs/` and `pnpm-lock.yaml`. The docs are copies of live documents, and
  changes to them go to the owner.

## Changes to the review standards

When the diff changes AGENTS.md, CLAUDE.md, this file or a skill under
`.claude/skills/`, quote each changed rule in the summary. Do not judge it; the
owner decides policy.

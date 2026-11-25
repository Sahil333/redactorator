# vendor/arlington

The PDF Association's Arlington PDF Model: every object type of PDF 2.0 (ISO 32000-2:2020,
with errata), one TSV per type, with its keys, their types, possible values and the types they
link to. Third-party; see `LICENSE` (Apache 2.0) and `NOTICE.txt`, as upstream ships them.
`NOTICE.txt` also licenses the model's other documentation under CC BY 4.0.

- Source: https://github.com/pdf-association/arlington-pdf-model
- Commit: `cdc485e4238c55bbd6204f6fda31997245d54b71` (master, 19 Nov 2026). The repository has
  no release tags, so a commit is pinned.
- Kept: `tsv/latest/` only, the 613 TSVs of the latest PDF version, unchanged.

It is build-time data. `tools/arlington/generate.py` reads it, with our decisions in
`engine/pdf/allowlist-decisions.json`, to write `engine/pdf/allowlistRoles.generated.ts`, the
allowlist's role table (docs/designs/pdf-leak-suite.md, Appendix A.1). The outside checker's
`structure` check reads it too, with its own walker (`tests/oracle`). Nothing reads it at run
time, and the app ships only the generated table.

## Updating

1. Delete `tsv/latest/`, copy in that folder of a newer commit, so TSVs upstream removed go
   too, and change the commit above.
2. Run `python3 tools/arlington/generate.py`. It stops, listing them, when a type the walk now
   reaches has no decision; decide those in `engine/pdf/allowlist-decisions.json`.
3. Make the same decision changes, written apart, in the outside checker's `KEEP`
   (`tests/oracle/oracle/structure.py`).
4. Change `READER_TAG` (`engine/pdf-protocol/messages.ts`), since what preparation keeps has changed, so
   every document is prepared again.
5. Review the generated table's diff, then run `pnpm test`, which runs every leak vector.

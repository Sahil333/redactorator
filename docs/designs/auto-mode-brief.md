# Phase 4: Auto mode (rules, findings and review)

* **Author:** Sahil Chaddha
* **Date:** 2026-11-26, last updated 2026-11-27
* **Status:** Reviewed once. The Goldfish review ran on 27 Nov 2026 with seven of seven reviewers and returned 14 blocking, 20 important and 6 minor findings (its own summary line says 13 blocking; it lists B1 to B14). The full findings are in `goldfish_brainstorm_findings.md`. Finding ids below (B1, I4, M2) refer to that file. Its `brief:N` line numbers refer to this brief as it stood before the review, kept as `concepts_brief.pre-review.md`. The owner answered the review's main objections the same day: the answers are S24 to S34 in the decision register and section 1.10. The owner then answered the remaining questions (S35 to S41). Two readings in section 1.10 await the owner's confirmation.
* **Facts** are marked *checked* (read from a source on 26 or 27 Nov 2026) or *from memory* (to be verified before design).

## Overview

Phase 4 builds Auto mode end to end for PDFs. The user starts a detection run. Recognizers start together. The user reviews what they found in two fixed stages, pattern findings and then model findings, unticks or changes what is wrong, and confirms each stage. This phase ships the pattern stage. When the review is done, each accepted finding becomes an ordinary mark. Everything after a mark (approving the document, spreading a value to other documents, writing the file, the leak checks) exists from phases 1 to 3 and is not changed.

The work has three parts: a detection frame, rule packs, and a review experience. The review found that building them as three separate projects is a horizontal cut; section 1.9 proposes vertical slices.

### Terms

The review found that "finding", "type", "group" and "approve" each meant several things (B6, I10, I18). From here on:

| Term | Meaning |
| --- | --- |
| Hit | One match by one recognizer at one place on one page |
| Place | A range of characters on one page, counted as indexes into that page's characters |
| Identifier | What a rule looks for: SSN, IFSC, UPI ID. 82 in the workbook, 65 marked Yes |
| Mark type | The name a mark carries. For a finding it is the specific identifier (SSN, ITIN, EIN), never a general name such as "government id" (S34). The 14 general types remain for marks made by hand |
| Candidate | One reading of a piece of text: a span, an identifier and its evidence |
| Finding | What the user decides on: one value in one document, with a default candidate and its alternatives |
| Evidence level | One of three: checked (a checksum or list confirmed it), labelled (a label or companion supports it), format only |
| Batch | Everything one group of recognizers found in one document, closed when the group finishes or the user stops |
| Stage | One of two fixed screens of findings, pattern findings and then model findings, each confirmed with one action (S30) |
| Rejection | The user's decision to keep a value in a document |
| Approve | Used only for a document. The stage button states its result instead, for example "Mark 188 values for removal" |

### Decision register

**Settled by the owner.** Entries marked "challenged" have a review finding against them and a question below.

| Id | Decision | Status |
| --- | --- | --- |
| S1 | `docs/designs/composable-engine.md` overrides the HLD. A finding is a proposal and changes the file only after the user accepts it | Settled |
| S2 | A document cannot be approved while a run is in progress | Settled |
| S3 | The timeline is not a constraint. Abstractions are expected at the start of a phase | Settled |
| S4 | The benchmark and the synthetic dataset are built separately | Settled |
| S5 | Countries: the United States, the United Kingdom, India, Canada, Australia. Documents are in English. First customers are Indian back offices working on US and UK files | Settled |
| S6 | Industries: finance, legal, medical. The tracking sheet is `identifier_catalogue.xlsx`: 65 identifiers Yes, 16 Later, 1 No | Settled |
| S7 | One Auto mode. No slider | Settled |
| S8 | Size target: a 100-page document, pattern findings inside one minute at the outside | Settled |
| S9 | The user can stop a run, mark by hand and approve with what was found | Settled; see S28 |
| S10 | One value found in many places is one finding | Settled; see S36 |
| S11 | JavaScript `RegExp` behind a port | Settled |
| S12 | NER is not built in this phase. The seams must let it be added | Settled |
| S13 | Review is in stages, one on screen at a time, created and ordered as findings become ready | Replaced by S30 |
| S14 | Every finding is selected by default, business identifiers included. Confirming a stage settles all of it: selected findings are accepted, the others are rejected and remembered | Settled; S35 says when accepted findings become marks |
| S15 | A confirmed stage is never reopened. A late finding opens a new stage | Replaced by S24 and S30 |
| S16 | Review status survives reloads | Settled; widened by S25 |
| S17 | Editing a finding covers its type and its edges | Confirmed after the review (S33) |
| S18 | The findings panel replaces the marks panel for the length of the review | Confirmed after the review (S31) |
| S19 | A profile belongs to the project, can be overridden for one run, and never switches off a country's core | Confirmed after the review (S32) |
| S20 | Overlapping findings merge into one finding. Its alternatives show in the panel and in the main view. The user never jumps between stages | Settled |
| S21 | The default alternative is the one that removes the most | Reversed by S27 |
| S22 | Only alternatives as strong as the default show; the rest sit under "more" | Refined by A5 |
| S23 | All recognizers start in parallel | Settled |
| S24 | During a review there is no undo, per finding or per stage. After the review ends, one undo reverses every mark the review made, behind a confirmation dialog in the centre of the view | Settled 27 Nov, after the review |
| S25 | A review is a long task. Its state survives restarts, reloads and return visits | Settled 27 Nov, after the review |
| S26 | A re-run of Auto mode never offers a finding that was already accepted | Settled 27 Nov, after the review |
| S27 | The default candidate is the value itself. Context words are not removed by default | Settled 27 Nov, after the review; reverses S21 |
| S28 | Approving a document before its review is finished shows a warning and lets the user proceed | Settled 27 Nov, after the review |
| S29 | No "what was not searched" notice in this phase | Settled 27 Nov, after the review; rejects A10 |
| S30 | Two fixed stages: pattern findings, then model findings. No dynamic stages. Inside a stage, findings are sorted by confidence | Settled 27 Nov, after the review; direction in S38 |
| S31 | While a document is in review, hand marking is off. Only edits to findings are allowed | Settled 27 Nov, after the review |
| S32 | The country is part of the profile. A user working on US files picks the US profile | Settled 27 Nov, after the review; see S37 |
| S33 | Edge editing is built in this phase | Settled 27 Nov, after the review |
| S34 | A mark carries the specific identifier's name. A general name for a set of identifiers is not used | Settled 27 Nov, after the review; reverses A3 |
| S35 | Accepted findings become marks only when the review is done, not when a stage is confirmed | Settled 27 Nov; replaces the earlier "confirmed stages are already marks" |
| S36 | A finding is accepted or rejected for all its places in the document. There is no choice per place | Settled 27 Nov |
| S37 | One run can use more than one country | Settled 27 Nov |
| S38 | A stage is sorted strongest evidence first. It can be reversed later if users ask | Settled 27 Nov |
| S39 | Among type alternatives, the default is the one whose context or prediction is strongest. The owner said a tie can be broken at random; recorded as "any fixed order", to confirm (section 1.10) | Settled 27 Nov; tie-break to confirm |
| S40 | A stage is confirmed whole. A user who stops part-way returns to the same review later | Settled 27 Nov |
| S41 | Keyboard review (REV-11) is not in this phase. The panel must still work from the keyboard, because WCAG 2.2 AA is kept | Settled 27 Nov |

**Accepted from the review.** These fix errors or fill gaps in the brief and change no owner decision.

| Id | Change | From |
| --- | --- | --- |
| A1 | The terms above | B6, I10, I18 |
| A2 | A recognizer reads one page at a time. A place is an index range into that page's characters. One shared "text view" turns a page into a string with a map back to character indexes; the regex recognizer, the term list and grouping all use it | B5 |
| A3 | Reversed by the owner (S34). It proposed general mark types with the identifier in the reason text. A finding now carries a specific identifier, and that is the name the mark keeps | B6 |
| A4 | Withdrawn after S27. It made the default cover every span that went into a finding. The default is now the value, and wider spans are alternatives | B3 |
| A5 | One evidence scale of three levels that every recognizer maps into. Span alternatives always show. The "more" filter applies to type alternatives only and means "at least as strong as the default" | I3 |
| A6 | The resolver is a pure function of one closed batch, the current marks and the rejections. The first stage opens when every fast group has closed. Findings merge inside a batch; across batches a finding is related to marks. Recognizers still start in parallel. The same document then always gives the same review | I1 |
| A7 | The time limit gets a mechanism: a port that can start and stop workers, a timer, one worker per recognizer group, every regex run under the limit (built-in rules too), a cap on findings per rule, and a report of what was not searched | B9 |
| A8 | A country's core is every country-wide personal or account identifier, whatever its evidence. Add-ons are only the label-only rules that are noisy outside one industry (prescription, claim and docket numbers) | B10 |
| A9 | The phase gets goals and exit tests that need no benchmark (see Goals) | B11 |
| A10 | Rejected by the owner for this phase (S29). Still kept, as part of A7: a rule stopped by the time limit is reported | B12 |
| A11 | Validators are written from public specifications; python-stdnum is the offline oracle; no runtime dependency on a stdnum library | M2 |
| A12 | This phase changes no write-path behaviour. Accepted findings become ordinary marks. Tests judged by the outside checker cover the shapes detection produces: nested, adjacent and line-crossing ranges, hundreds per page | M5 |
| A13 | Each document keeps a small record of what ran, with no values in it: pack ids and versions, counts per rule, rules stopped by the time limit, and whether the run finished, was stopped or failed | I16 |
| A14 | Lists ship as dated snapshots. Vocalink's tables wait for a licence check | M1 |
| A15 | The work is cut into vertical slices, each starting with a browser test | I13 |

## Analysis

### 1. What the Goldfish review found

Most blocking findings share one cause: the brief described findings, stages and merging without checking them against how marks, spreading, undo and stored records work today. I checked the code lines the main findings rest on (`engine/model/spread.ts`, `engine/model/marks.ts`, `engine/core/session/slices/history.ts`, `engine/core/session/slices/marks.ts`, `engine/core/formats/project.ts`, `engine/globals.ts`, `engine/model/match.ts`) and the cited lines of `docs/designs/composable-engine.md`. They say what the reviewers report.

#### 1.1 Findings against the mark model (B1, B2, B14, I15)

How marks work today:

- A mark is known by its normalised text. Every mark with the same text is one value. A value has one type.
- Approving a document marks every place of each of its values in that document, and hides the value in every other document of the project.
- The only exception is the per-document "Don't hide here" list, which holds whole values, not single places.
- Undo restores a document's marks and its "Don't hide here" list, 100 steps deep, and is cleared when a document is approved.

What that breaks in the brief:

- **Dropping single places of a value** is undone at approval: the dropped places are marked again.
- **Two places of one value with different types** cannot be stored.
- **A stored "accepted" status can hide an identifier.** Undo removes the marks but not the status, so the value is neither marked nor offered again. The same happens when the user removes an accepted mark by hand.
- **"One undo reverses a stage" and "a stage is never reopened" cannot both hold** as written.
- **The brief misread section 11** of the composable-engine design. It keeps findings out of the record that approval compares and out of undo history; it does not forbid storing the user's decisions.

Five reviewers reached the same simplification independently:

- Never store "accepted". A finding is settled when a mark covers it.
- Store only rejections, inside what undo already restores. A rejection of a whole value in one document is what "Don't hide here" already means.
- Do not store pending findings in this phase. Patterns take about a second, so they are found again on open. A cache for slow model findings comes with NER.
- Give the user a list of "found and kept in the file (N)".

Answered by the owner: S24, S25, S26, S35, S36 and section 1.10.

#### 1.2 The default that removes the most (B3, B4)

- **Crossing spans (B3).** When two spans cross, neither contains the other, so whichever is the default leaves part of the other in the file. A4 fixes this: the default is the union.
- **A longer default changes what the value is (B4).** A mark is known by its text. If the default is a long weak capture around a checked SSN, the long string becomes the value. The SSN is then not found in other documents, and fifteen places of one SSN inside fifteen different lines become fifteen findings. Accepting a longer "extends" finding does the same to a mark that was already spreading.
- **Reviewers' proposal:** keep the wide deletion, but separate what is deleted from what the value is. The mark deletes the long span and is known by the strongest identifier inside it.

Answered by the owner: S27 reverses the rule, so the mark does not change.

#### 1.3 Stages, runs and what the user is told (B7, B8, B12, B13, I1, I9, I10, I11)

- **A stage was not defined (B7),** yet settled rules depended on a definition. The reviewers propose a stage per evidence level, with the names "checked", "found by label" and "found by format", and empty stages skipped. With only fast recognizers, "the batch that arrived" would give one stage per run.
- **A stage cannot live only in the app (B7).** The composable-engine design says no project rule belongs in `app/`. Stage membership decides what merges, what one undo covers and what the gate allows. Proposed: the engine owns the batch and one "settle" command; the app owns names and layout. This reverses my earlier proposal.
- **The path from finding to mark is missing (B8).** Today's command adds one mark, one record and one undo step, and needs the document open. A stage of hundreds needs one record that carries all its marks and rejections. A run must also coexist with hand marking, so it needs its own state and its own rows in the table of what may run together.
- **Timing (I1).** "Merge if both exist before the stage opens" made the review depend on machine speed and on when the user clicks. A6 replaces it.
- **Stopping or leaving (B13).** The plan requires export blocked while findings need review. The owner's decision S9 lets the user stop and approve. Today a user can confirm stage 1, close the tab and download the next day with found identifiers still in the file, and nothing shows it. Answered by the owner: S28.
- **What was not looked for (B12).** A user who confirms every stage will read that as "done", while names and addresses were never searched. A10 adds the notice.
- **One button over hundreds of ticked rows (I9).** A stage needs one sentence saying what to check, rows grouped by type with a count, and a button that states the result ("Mark 188 values (612 places) for removal"). Weak rules need a floor: a bare run of digits is not offered on format alone.
- **Wording (I10).** "Approve" was used for a stage, a finding and a document. "Extends a mark you approved" uses three internal words.
- **The hidden marks panel (I11).** Names are not detected in this phase, so users will mark them by hand during a review. With the marks panel hidden, those marks are drawn on the page, listed nowhere and cannot be removed. Answered by the owner: S31, hand marking is off during a review.

#### 1.4 Text and offsets (B5, I5)

- The only unit of text in the model is a page: one entry per character, with entries for line ends.
- A JavaScript `RegExp` returns positions in UTF-16 units of a joined string. They differ from character indexes after certain characters. One such character before a value shifts the mark by one and leaves the first digit in the file, and the write check passes because it reads the same shifted range.
- The existing matcher treats spaces, dots and dashes inside a number as nothing. A ported rule that does not will miss an SSN typed with an en dash.
- A label and its value in neighbouring table cells may be far apart in character distance. 41 of the 65 identifiers depend on a label.
- A2 answers the first three. The fourth needs a small spike on a table and a flattened form before "label within N characters" is fixed.
- The `RegexEngine` contract must also return the span of the value group, state its offset unit, and state what `\b`, `\d` and `\w` mean.

#### 1.5 The time limit and custom patterns (B9, I6, I7)

- A running `RegExp` cannot be interrupted. The only stop is ending its worker from outside. The engine core has no timer and receives one started worker, not a way to start more.
- One worker is one thread, so a model in the same worker would block the patterns.
- The slow-pattern check at build time names no tool. It is a heuristic and can miss, and slow matching is triggered by document text, which is not trusted. So built-in rules run under the limit too.
- Two cases neither control catches: a zero-length match that loops, and a pattern such as `\d+` that floods the review with selected findings. A7 covers both with a cap per rule.
- Custom patterns have no decided home. The HLD puts them in global settings, where a project copied to another computer does not carry them. In the project, an imported project carries a regex nobody here wrote. Decided: with the project.

#### 1.6 Packs and profile (B10, I8, I12)

- **The core as I defined it left out 41 of 65 identifiers,** SSN included, because they have no checksum. A8 fixes the definition.
- **The country question is one the user cannot answer safely (I8).** "Country" could mean the user's, the client's or the document's. An Indian back office on US files that picks India loses SSNs. Speed is no reason to narrow: 300 rules cost 65 ms. Answered by the owner: S32, the country stays in the profile.
- **65 identifiers is a quality risk (I12).** 41 depend on labels, nine have no source, and several facts are unverified. Packs are data and can land after the frame, in order of evidence: the 24 checksum identifiers first, then label rules, then formats that differ by state or province. A rule is done when its fact is verified against the issuing body, it has generated positives and near-miss negatives, and its source is recorded.

#### 1.7 Seams after the review (I2, I4, I17)

| Seam | Job | Changed by |
| --- | --- | --- |
| Text view | Page to string, with a map back to character indexes and line boundaries | New (B5) |
| Recognizer | Asynchronous, with a life cycle (load, ready, failed) and a detect call that can be stopped and reports progress. Returns hits: place (a span or a box), identifier, evidence | I2 |
| Rule pack | Data. Each rule names its identifier, pattern, labels, distance, validator, list, source and licence. Built-in packs and custom patterns share the format | B6 |
| Validator registry | Named check functions | Unchanged |
| List registry | Named closed lists, each a dated snapshot with its source | M1 |
| RegexEngine port | Compile rules; scan text; return rule id, match span and value-group span in a stated unit | I5 |
| Joined evidence | Companion findings, pair checks and ruling out need more than one hit. Either a separate step on a closed batch, or inside the pattern recognizer | New (I4). Decided: inside the pattern recognizer in this phase |
| Resolver | A pure function: closed batch, marks and rejections in; findings with a default and alternatives out | I1, B3 |
| Mark relation | For any finding, whether a mark covers it, or it extends a mark. Recomputed on every change. Also handles hand marks made before a run, re-runs and undo | Split from the resolver (I4, B2) |
| Stage batch | Engine-owned: the findings of one recognizer group, and one command that confirms the stage | New (B7, B8) |
| Review state | Stored per document: a review is in progress, its stage, what was accepted and rejected in confirmed stages, and the changes made inside a stage not yet confirmed. Also what one undo after the review reverses | New (S24, S25) |
| Recognizer set | Data: pack ids and a speed class per recognizer. "Profile" is the word the user sees | I8 |
| Detection workers and port | Start and stop workers; one per group; run id; stop ends and restarts the worker | B9 |
| Detection state | Run state per group, including "did not finish" and "failed" | B8, I16 |
| Rejections | Stored per document, inside what undo restores | B2, B14 |
| Run record | What ran, with no values | I16 |

- **NER fitting "without changes" is an intent, not something this phase can show (I2).** A recorded finding stream played back by a test recognizer (scores, edges off word boundaries, scripted arrival order) exercises the seams more than a slow dummy does. It never ships in the bundle.
- **Repo work the earlier table omitted (I17):** new zones for the detection code, its protocol and its worker entry; pack and list data loaded only in the worker and only at run start, because a load triggered by a candidate value would signal a finding; the offline and same-origin tests extended to the new worker.
- **Paths sized for hand marking (I14):** approval searches every hidden value in every document, and the marks panel renders every row. Approval is to be measured at about 5,000 marks per document before design.

#### 1.8 Where reviewers disagreed

- **The stored-format step:** an optional field with no version change, against a version 4 migration with its own golden test.
- **Joined evidence:** a separate step, against inside the pattern recognizer. Decided: inside the recognizer in this phase.
- **Late-arrival behaviour:** build it now with closed batches, against defer it to the NER phase. Decided by S30: no waiting stage in this phase.

#### 1.9 Proposed slices (I13)

Each slice starts with its browser test.

1. Decisions on paper: the two readings in section 1.10, the facts marked from memory, the slow-pattern tool, a measurement in a Chrome worker.
2. Walking skeleton: one checksum rule (payment card), the text view, the zones, the worker port, the pattern stage, one record for the review with one undo, and a download the outside checker judges, including the offset fixture.
3. Stored rejections and the stored review state: reload mid-stage, a re-run that skips accepted findings, a reader change, the format step.
4. The term-list recognizer and the replay recognizer: stop, failure, the time limit.
5. Joined evidence and the resolver: merging, alternatives, the "a mark covers it" rule, and edge editing.
6. The rule format, fixed only after one rule of each evidence kind works. Then validators, registries, the pack build and its check, and one country core.
7. The remaining packs, as data-only changes in parallel.
8. The profile, then custom patterns with their own worker and caps.

#### 1.10 The owner's answers (27 Nov 2026) and what follows from them

**Why findings and marks did not fit, and what "minimal mixing" comes to.** The owner's position: a finding turns into a mark when it is accepted, and the two should mix as little as possible. The review points the same way. The fit is clean when three things hold:

- *A finding leaves nothing behind once the review is done.* Accepted findings become ordinary marks at the end of the review (S35), and from then on the mark is the only record. While the review is in progress, the accepted findings are held in the review's stored state (S25). A re-run skips a finding that the review state holds as accepted, and any finding whose text a mark already covers (S26). The second rule also skips values the user marked by hand before the run.
- *A rejection is stored, because nothing else remembers it.* For a whole value in one document, this is what the existing "Don't hide here" list holds. Spreading from other documents already respects that list.
- *A finding follows the rules a mark follows.* A mark is known by its text. All marks with the same text are one value with one name. Approving a document marks every place of that value in the document.

Where the earlier brief asked for something marks cannot do:

| The brief asked for | What marks do today | Result |
| --- | --- | --- |
| Open a finding and keep the value in 3 of its 15 places ("dropping places") | Approving the document marks every place of a marked value again. The only opt-out is "Don't hide here", which covers the whole value in that document | Dropped by the owner: all places or none (S36) |
| Two places of one value with different names | One value has one name | Not possible. The second name is an alternative |
| A stored "accepted" status | The mark is the record | Held only while the review is in progress; afterwards the mark is the record (S35) |
| One undo per stage | Undo is per document, 100 steps deep, and is cleared when the document is approved | Replaced by S24 |

**What each answer changes**

- *S24 and S35, undo.* All the review's marks are made in one step when the review is done. That is one record, and undo reverses it as a whole behind a confirmation dialog. When model findings arrive in a later phase, both stages still end in that one step.
- *S25, a long task.* Three things are stored per document so that a reload shows the same review: that a review is in progress and at which stage; the findings accepted and rejected in stages already confirmed; and the changes made inside a stage that is not confirmed yet (unticked findings, changed names, edited edges, a chosen alternative). Pattern findings themselves are found again on open in about a second. Model findings will need a cache when NER arrives.
- *S27, the default is the value.* This removes finding B4 without changing the mark. A long weak capture around a checked SSN is offered as "remove more"; the SSN is the mark and keeps spreading to other documents. Rule A4 (the default covers every span) is withdrawn. My reading, to confirm: when the longer candidate is itself the fuller value and at least as strong (a UPI ID that begins with a phone number), the longer one is the default.
- *S33, edge editing.* An edited finding behaves like a hand mark of the new text: the new text is the value that groups and spreads. Shortening applies in every place. Lengthening applies where the neighbouring text matches. The existing matcher finds whole words only, so an edge inside a word needs design work (I19).
- *S30, two fixed stages.* A stage is the batch of one recognizer group. This phase ships one stage, the pattern stage. The waiting stage for late findings, "never reopened" and stages per evidence level are dropped. Inside a stage the strongest evidence comes first (S38).
- *S34, specific names.* The name on a mark is the identifier. Three consequences. Type alternatives return: nine digits can be an SSN, an ITIN, an EIN or a routing number; the country in the profile and the "at least as strong" filter limit how many show. The list a user picks from when marking by hand grows from 14 names to about 80 and needs grouping. The ground-truth schema the benchmark uses lists 14 types and has no India, so either it grows or each identifier maps to one of its types for scoring.
- *S32 and S37, country in the profile.* One run can use more than one country. An option that keeps the decision: packs that are switched off still scan, and the review ends with one line if they would have added findings.
- *S28, the warning.* Approving a document with findings still unconfirmed shows how many, and lets the user proceed. This replaces the plan's "export blocked while findings need review".

**Two readings to confirm**

- *A fixed order where the owner said "random" (S39).* Pattern findings are found again every time the document is opened (S25). With a random tie-break, the default name of a finding could change between two visits to the same review, and a test could not be repeated. A fixed order, such as the order of the packs, is just as arbitrary for the user and gives the same answer every time.
- *When a review is "done" (S35).* Three ways: the last stage is confirmed; the user ends the review early; or the user approves the document through the warning (S28). In each case the findings accepted so far become marks at that moment. Otherwise a value the user accepted would stay in the file, and the warning, which counts only unconfirmed findings, would not mention it.

**Costs the owner accepted**

- *S29:* a user who confirms every stage is not told that names, addresses and scanned pages were not searched. A rule stopped by the time limit is still reported (A7); that is a failure report, not a coverage notice.
- *S31:* a user who notices a missed name during a review cannot mark it until the review ends.
- *S27:* when a wider capture was right, its extra text stays in the file unless the user picks "remove more".

### 2. Regex engine

**What the owner proposed:** Vectorscan compiled to WebAssembly, for speed and for safety against slow patterns.

**What the research found about Vectorscan** (*checked*):

- It is C++, a fork of Intel Hyperscan. It is not Rust. It needs a C++17 compiler and Boost.
- I found no WebAssembly build of Vectorscan or Hyperscan. Vectorscan has a SIMDe backend that emulates SSE4.2 on other hardware, and Emscripten supports WebAssembly SIMD, so a build may be possible. Nobody appears to have published one. We would own that port.
- It does not support capture groups, backreferences or arbitrary lookaround. A pattern using them fails to compile.
- By default it reports only where a match ends. Reporting where a match starts needs a flag (`HS_FLAG_SOM_LEFTMOST`), and many bounded repeats that compile without the flag do not compile with it. Account-number rules are bounded repeats (`\d{9,18}`).
- Nosey Parker, a secret scanner built on Hyperscan, runs a second regex engine on every hit to recover the start and the captures. So Vectorscan would be a first-pass filter in front of another engine, not the only engine.
- A compiled pattern database must be scanned by the same library version that built it. Compiling a user's custom pattern needs the compiler inside the browser, which is the large part of the library.

**The strongest case for it:** it scans the text once no matter how many patterns are loaded. If the packs grow to thousands of rules (the secrets databases list 1,600 and more), scanning each rule separately gets slow, and a multi-pattern engine fixes that.

**The case against it today:**

- Hyperscan was built for network inspection: tens of thousands of patterns over gigabits per second. A document is a few kilobytes per page, and the packs for phase 4 are a few hundred rules. Nothing has been measured yet that shows JavaScript `RegExp` is too slow at that size.
- A redaction needs the exact start and end of a value, and often a capture group ("the number after the word SSN"). Those are the two things Vectorscan is weakest at.
- It adds an unpublished C++ to WebAssembly port, with Boost, to a repo whose checks cover only TypeScript.

**Alternatives**

| Engine | Linear time (safe against slow patterns) | Start offsets and captures | One pass for many patterns | State (*checked* unless noted) |
| --- | --- | --- | --- | --- |
| JavaScript `RegExp` (V8) | No. It backtracks | Yes | No, one rule at a time, or rules joined with `\|` | Built in, no download. Lookbehind and Unicode classes supported |
| Rust `regex` crate in WASM (`rregex` package) | Yes, by design | Yes | Yes (`RegexSet`, or a multi-pattern automaton) | Published, dependency-free WASM build that tracks the crate version. Its maintainer reports 3 to 8 times faster than JS including the copy cost; that is their benchmark, not ours. No lookaround or backreferences. Size not measured; one report says about 150 KB added |
| Rust `regex-automata` with automata built at build time | Yes | Start and end yes; captures need a second pass | Yes | Search-only code runs without the compiler. Suits our own packs; a user's pattern still needs the compiler |
| RE2 in WASM (`re2-wasm`) | Yes | Yes | Limited (`RE2::Set` reports which rules matched, not where) (*from memory*) | Last release February 2021; rated inactive |
| V8's linear-time engine (`l` flag) | Yes | Yes | No | Behind a browser flag; not usable in a shipped app |
| Vectorscan in WASM | Yes | Weak, see above | Yes | No WASM build exists |

**How hard is it to swap engines.** The call interface is small and easy to swap: give the engine a list of rules, give it text, get back rule id, start and end. The hard part is the pattern language. Each engine accepts a different dialect, so a rule written with lookbehind for JavaScript does not run in Rust `regex` or Vectorscan. An engine is swappable only if every pack rule is written in the subset all candidate engines accept (no lookaround, no backreferences), and every rule has fixtures that run against each engine. That choice has to be made before the first rule is written, because it shapes every rule.

**vectorscan-rs.** The owner meant the Rust package `vectorscan-rs`. It is a Rust binding that builds and links the C++ Vectorscan library (*from memory*), so it is the same engine with the same limits. Its speed comes from wide SIMD instructions on desktop processors. WebAssembly SIMD is 128 bits wide, so part of that advantage would not reach the browser.

**How much lookaround, backreferences and groups matter**

- **Groups (captures): needed.** "The number after the label" is a capture. Every candidate except Vectorscan has them.
- **Lookaround: used by a minority of rules, for two jobs.** One is "not next to another digit or letter" where `\b` is not enough. The other is "must contain at least one digit". Both can be done in code after the match. Presidio's card and PAN rules use lookahead (*from memory*). The gitleaks rules are written for Go's engine, which has no lookaround (*from memory*), and they still cover about 150 secret formats.
- **Backreferences: rare.** The usual job is "the same separator both times" (123-45-6789 but not 123-45 6789). Writing each form out, or a check after the match, replaces it.

**What an engine with every feature costs.** Lookaround and backreferences need a backtracking engine: JavaScript `RegExp`, PCRE2 or Oniguruma. A backtracking engine cannot promise that no pattern runs slowly. Safety then comes from two controls outside the engine: our own rules are checked for slow shapes when the packs are built, and a user's rules run in a worker that is stopped at a time limit.

**Measurement (27 Nov 2026).** 300 rules over 100 pages of 3,000 characters took 65 ms in total, 0.6 ms per page, in V8 (Node 24, the engine Chrome uses). The rules were 30 identifier shapes, each with nine keyword-led variants; three used lookaround. Against a one-minute limit that leaves about 900 times the room. Limits of the test: synthetic text, no validators, no PDF text extraction, one machine, each rule run separately with no keyword pre-test. The script is `bench.mjs` in the session scratchpad and is not in the repo, so the result cannot be repeated (review finding M4). It is to be measured again in a Chrome worker with validators, and a 100-page synthetic fixture becomes the speed guard.

**Agreed by the owner on 27 Nov 2026:**

- JavaScript `RegExp` is the first engine. At 100 pages speed is not the constraint, it has groups and lookaround, and it needs no download and no port.
- It sits behind a `RegexEngine` port with one contract, so a linear-time or multi-pattern engine can replace it later. Running the fixtures against each engine waits until a second engine exists (M3).
- The rule format has plain fields for the common lookaround jobs (not next to a digit, keyword within N characters, which group is the value). Most rules then stay in the subset every engine accepts. A rule may still use raw lookaround; the pack build marks it, so the number of rules that block an engine swap is always known.
- Safety: a build-time check of our own rules for slow shapes, and a time limit. The review showed the time limit has no mechanism yet and must cover built-in rules too; see section 1.5.
- Rust `regex` in WASM and Vectorscan stay later options behind the port, for the day the rule count or the document size makes a measurement call for them.

### 3. Sources of patterns and identifier facts

| Source | What it gives | Licence | Verified |
| --- | --- | --- | --- |
| [Presidio](https://presidio.dataprivacystack.org/supported_entities/) | Regex, context words and checksums. Groups today: Global, USA, UK, Spain, Italy, Poland, Singapore, Australia, India, Finland, Korea, Nigeria, Philippines, Canada, Sweden, South Africa, Thailand, Turkey, Germany. **No New Zealand, no Ireland.** USA has 13 types including several medical ones (NPI with checksum, MBI, claim, prescription and referral numbers) | MIT | *checked* |
| [stdnum-js](https://github.com/koblas/stdnum-js) (npm `stdnum`) | TypeScript validators for about half the world's countries, focused on tax, VAT and person numbers. Zero runtime dependencies, per-country imports. Version 1.17.5 | MIT. Its credits thank python-stdnum for "many of the checksum algorithm sources"; python-stdnum is LGPL, so the provenance needs a licence check before we depend on it | *checked* |
| [@stll/stdnum](https://github.com/stella/stdnum) | 11 global identifiers and 96 countries from one Rust implementation, with a WASM package for browsers. Lists US SSN, ITIN, EIN, routing number; UK NINO, NHS, UTR; CA SIN, BN; AU TFN, ABN, ACN; NZ IRD; IE PPS; IN Aadhaar, PAN, GSTIN; IBAN, BIC, LEI, ISIN, cards | Apache-2.0. Young: 1 star, 128 commits | *checked* |
| python-stdnum | The reference for check digits in 200+ formats | LGPL. Use only offline in `tools/` as a test oracle | *from memory* |
| Microsoft Purview sensitive information types | Public documentation of 300+ types. Each entry states the format, whether a checksum exists, the keyword list, the proximity window and what evidence gives high, medium or low confidence | Documentation, not open source. Use as a specification and a coverage checklist; whether keyword lists may be copied needs a check | *checked* (model); list contents *from memory* |
| Google Cloud DLP infoTypes, AWS Macie managed identifiers | Lists of identifier types per country. No patterns | Documentation. Coverage checklists only | *from memory* |
| OECD tax identification number sheets, and each agency's own specification (SSA, IRS, HMRC, UIDAI, ATO, IRD NZ, Revenue IE) | The authoritative format and check-digit rule per identifier | Public | *from memory* |
| gitleaks, detect-secrets | Rules for secrets and keys, with keywords | MIT, Apache-2.0 | *from memory* (HLD) |
| validator.js, libphonenumber-js | Identity card, tax id, passport and IBAN checks by locale; phone numbers by region | MIT | *from memory* |
| OpenRedaction, Philter | Broad regex collections; Philter is medical | MIT; Philter to check | *from memory* (HLD) |
| HIPAA Safe Harbor list of 18 identifier kinds | A checklist of what medical documents must lose | Public | *from memory* |

**Ideas worth porting, by source**

- **Presidio:** the pattern recognizer shape (regex, base score, context words, validate and invalidate hooks, deny list), and an explanation attached to every finding.
- **Purview:** confidence decided by evidence, not by a raw number. A match alone is low; a match plus a keyword within N characters is medium; a match plus a passing checksum is high. This maps directly onto review bands, and onto the owner's custom-pattern form (context words, distance, a simple number pattern).
- **gitleaks:** keywords as a cheap first test. A rule's regex runs only on text that contains one of its keywords.
- **Converters, not copies** (HLD): one script per source regenerates our pack file, so upstream fixes can be pulled, and each rule records its source and licence.

**After the review (M2, M3).** The validators are written by us from the public specifications, with python-stdnum used offline as the test oracle, as the HLD already decided. The app takes no runtime dependency on stdnum-js or @stll/stdnum, which removes the licence question about them. Purview is a checklist only. Rules are ported by hand once with their source recorded; a converter per source is not built.

### 4. Countries and identifiers

The working list is `identifier_catalogue.xlsx`: 82 identifiers for the United States, the United Kingdom, India, Canada and Australia and identifiers used in any country, each with its class, its entry in Presidio, the stdnum libraries and Purview, and where each fact came from. A validator there means a function that takes one candidate string and says whether it is a well-formed number of its kind (format rules and check-digit arithmetic). It does not search text. A rule is a regex that finds candidates, a validator that confirms them, and context words.

**Identifiers that none of the three sources covers (27 Nov 2026).** Nine rows, listed on the workbook's "Gap solutions" sheet: US court docket numbers; UK sort code with account number, and the CHI number; India's bank account number, IFSC, UPI ID, TAN, UAN and ABHA number. No source means we write the rule ourselves from the issuing body's own format. Format facts are not anyone's code, so no licence question arises for the rule text. A missing checksum is replaced by other evidence:

- **A closed list shipped with the app.** IFSC: the first four letters against a list of bank codes. UPI ID: the part after @ against a list of UPI handles. Court dockets: a list of case-type codes. A list match is as strong as a check digit or stronger.
- **A check on a pair.** UK sort code and account number: the modulus check that Vocalink publishes for Pay.UK works on the two numbers together. Deferred until the licence for shipping its tables is verified (M1); until then the rule uses labels.
- **A companion finding.** An Indian bank account number has no format beyond 9 to 18 digits. A valid IFSC in the same block of text raises its evidence level.
- **A label within a distance.** TAN, UAN and the ABHA number have no confirmed check digit, so the label is the evidence.
- **Ruling out.** A 12-digit number after the label "UAN" is not offered as an Aadhaar number even when it passes the Aadhaar check by chance (one in ten does).

Three consequences for the frame:

- Evidence has more kinds than "checksum" and "context word": list match, pair check, companion finding. The rule format and the finding's evidence field need all five.
- Lists are data that goes stale (bank codes, UPI handles). Each list is committed as a dated snapshot with its source and refreshed by a manual script under `tools/`; nothing is fetched during the build. A stale list only moves a finding between stages, because a list never rejects (M1).
- A lookup site or API cannot be used to verify a code, because the request would carry a finding out of the browser. The product rule forbids that. A list raises the evidence level and never rejects a well-formed value: an old statement can carry the code of a branch that has since closed, and that code still has to be found.

Not yet verified: whether the ABHA number has a check digit (government material calls it random); the licence terms for shipping Vocalink's modulus tables; an official machine-readable list of UPI handles.

Industry notes:

- **Finance:** account numbers have no checksum in most countries and depend on a label.
- **Medical:** medical record numbers have no standard format; they are label-only rules or custom patterns per hospital.
- **Legal:** case and docket numbers follow each court's format and have no checksums. Bar numbers likewise.

### 5. The review experience as agreed before the review

This is the owner's design from the clarification turns, restated with the terms above. Decisions S24 to S34 changed parts of it after the review; section 1.10 says how. Where the two disagree, 1.10 and the register win.

- **One Auto mode.** A run starts every recognizer at once.
- **Stages.** One stage is on screen at a time. Every finding in it is selected. The user unticks or changes findings and confirms the stage. Selected findings become marks, the others are rejected and remembered, and one undo reverses the whole confirmation.
- **Late findings.** A confirmed stage is not reopened. Late findings collect into one waiting stage.
- **One value, one finding.** A value found in many places of a document is one finding with a count.
- **Merging.** Overlapping hits become one finding with a default and alternatives. The alternatives show in the panel and in the main view. A type alternative never demands an answer. Clicking a finding moves the document to its place.
- **After a stage is confirmed.** A later finding that a mark already covers is not offered. A later finding that is longer than a mark is offered as an extension, with only the added part highlighted.
- **The reason shows.** "Passed its checksum" or "next to the label SSN" is what lets a reviewer decide, even though the engine's name is hidden.
- **The profile.** Countries and an industry. It belongs to the project and can be overridden for one run.
- **Editing.** Type and edges. A change of edge is a change of value: shortening applies in every place, lengthening only where the neighbouring text is the same.

### 6. What "host" means

"Host" is the program around the engine that supplies the platform pieces. Today the only host is the browser app: `engine/host-browser` gives the engine its worker, locks and storage, and the rest of the engine compiles without browser types. The detection code follows the same rule and stays free of browser APIs outside its worker entry. No reviewer found a problem with this.

## Goals vs. Non-Goals

**In-Scope Goals** (proposed after the review; they need no benchmark):

- A run finds every planted identifier in one generated PDF per pack. A browser test fails on any that is missed and reports the extras.
- Each rule has positive examples and near-miss negatives.
- A review-cost count on those fixtures: actions from Run to an approved document, findings per stage, and unticks needed, against the hand marks the same document needs.
- One timed session with an outside back-office user, as phase 1 did.
- Detection runs without the app and writes offsets in the ground-truth format, so the benchmark can plug in later.
- Pattern findings for a 100-page fixture arrive inside a stated number of seconds in a Chrome worker.
- A downloaded file passes the outside checker, including a fixture with a multi-unit character before an identifier.
- Custom patterns in two forms: a raw regex, and labels plus distance plus a simple pattern.
- Editing a finding: its name and its edges.
- A review that can be left and resumed, and a re-run that skips what was already accepted.

**Out-of-Scope Non-Goals:**

- NER and LLM recognizers. The seams are built to take them.
- The benchmark and the synthetic dataset.
- Scanned pages and formats other than PDF.
- Looking a value up at an outside site or API.
- Any change to how the output file is written.
- Stored pending findings (they are found again on open).
- A runtime dependency on a stdnum library; converters per source; fixtures run against a second regex engine.
- Vocalink's modulus tables until their licence is checked.
- Dynamic stages and a waiting stage for late findings.
- A notice of what Auto mode did not search for.
- Hand marking while a document is in review.
- Keeping a value in single places of a document.
- Keyboard shortcuts for review (REV-11).

## Alternatives Weighed

- **HLD rule "an unapproved detection is redacted by default".** Rejected by author: the composable-engine design overrides the HLD.
- **Vectorscan as the regex engine, in this phase.** Rejected by author: JavaScript `RegExp` scanned 300 rules over 100 pages in 65 ms and has groups and lookaround. Vectorscan and Rust `regex` stay possible behind the port.
- **A smartness slider (Basic, Medium, High).** Rejected by author: one Auto mode.
- **One list sorted by a single confidence number.** Rejected by author: pattern and model scores are not on one scale.
- **Several sections in one panel.** Rejected by author: one stage at a time.
- **Letting the user jump between stages to compare overlapping findings.** Rejected by author: each span is decided in one stage.
- **Running pattern recognizers first and models after them.** Rejected by author: all start in parallel.
- **Six launch countries with India after the MVP (plan as written).** Rejected by author: five countries including India; New Zealand and Ireland are out for now.
- **An industry profile that can switch off a country's core.** Rejected by author.
- **Merging decided by which finding arrived before a stage opened.** Rejected after review (I1): the same document gave different reviews on different machines. Closed batches instead.
- **Stages formed by the app alone.** Rejected after review (B7): the engine design keeps project rules out of `app/`.
- **Storing every finding with a status.** Rejected after review (B2, B14): a stored "accepted" can hide an identifier, and a stored finding needs an identity that survives rule changes. Rejections and the state of a review in progress are stored; "accepted" is not (S25, S26).
- **A country core made of checksum identifiers only.** Rejected after review (B10): it left out SSN.
- **Depending on stdnum-js or @stll/stdnum at run time.** Rejected after review (M2): the validators are few and the licence question goes away.
- **The default of a merged finding removes the most.** Rejected by author (reversed 27 Nov 2026): the value matters, not the context words around it, and a longer mark is no longer known by the identifier inside it (B4).
- **Dynamic stages, and a stage per evidence level.** Rejected by author: two fixed stages, patterns and then models.
- **General mark types for identifiers** (SSN, ITIN and EIN all as "government id"). Rejected by author: specific names only.
- **All country cores always on, with no country choice.** Rejected by author: the country is part of the profile.
- **Keeping the marks list reachable, or hand marking, during a review.** Rejected by author: hand marking is off while a document is in review.
- **Deferring edge editing to the NER phase.** Rejected by author: it is built in this phase.
- **A notice of what Auto mode did not search for.** Rejected by author for this phase.
- **Making marks each time a stage is confirmed.** Rejected by author: accepted findings become marks when the review is done.
- **Keeping a value in some places of a document and removing it in others.** Rejected by author: all places or none.
- **Sorting a stage weakest evidence first.** Rejected by author for now: strongest first, to be reversed if users ask.
- **Verifying a code at an outside site or API.** Proposed for rejection, for the owner to confirm: the request would carry a finding out of the browser.

## Key Decisions & Staging for Next Steps

### Questions for the owner

**Answered on 27 Nov 2026.** "Follows the recommendation" means the owner was told the recommendation would stand unless objected to, and did not object.

| Id | Question | Outcome |
| --- | --- | --- |
| Q1 | What is stored, and what is a finding? | Accepted findings are held in the review's stored state and become marks when the review is done (S35). Rejections are stored. A review in progress is stored (S25). No undo inside a review; one undo after it (S24). Dropping single places is still open: R1 |
| Q2 | Keep "the default removes the most"? | Reversed. The default is the value (S27) |
| Q3 | Findings never confirmed, after a stop or a closed tab? | A warning at approval, and the user may proceed (S28) |
| Q4 | What defines a stage? | Two fixed stages: patterns, then models (S30) |
| Q5 | Where are marks listed during a review? | Not needed. Hand marking is off during a review (S31) |
| Q6 | Is edge editing built in this phase? | Yes (S33) |
| Q7 | Does the user choose countries? | Yes. The country is part of the profile (S32) |
| Q8 | Where is joined evidence computed? | Inside the pattern recognizer in this phase. Follows the recommendation |
| Q9 | Late-arrival behaviour now or with NER? | The waiting stage is dropped with dynamic stages (S30). Kept: the "a mark covers it" rule, which S26 needs, and a finding longer than an existing mark |
| Q10 | What is the stage action called? | "Approve" stays for the document; the stage button states its result. Follows the recommendation |
| Q11 | Does a mark keep the identifier that found it? | Yes, and it is the mark's name (S34) |
| Q12 | Custom patterns: with the project or the browser? | With the project. Follows the recommendation |
| Q13 | One document or the whole project per run? | One document per run. Follows the recommendation |
| Q14 | Search and mark (REV-10), keyboard review (REV-11)? | Search and mark stays, outside a review. Keyboard review is still the owner's call |

**Answered on 27 Nov 2026, second round**

| Id | Question | Outcome |
| --- | --- | --- |
| R1 | May the user keep a value in some places of a document and remove it in the others? | No. All places or none (S36) |
| R2 | What does "half a review" mean? | Stages are confirmed whole; a user who stops part-way returns to the same review (S40) |
| R3 | Can one run use more than one country? | Yes (S37) |
| R4 | Which way is a stage sorted? | Strongest evidence first, for now (S38) |
| R5 | Is keyboard review (REV-11) in this phase? | No (S41) |

### Changes to propose to the Implementation Plan and the HLD

`docs/` holds copies of live documents, so these go to the owner and are not edited here (I20).

- Countries: the plan lists six, with India after the MVP. Now five, including India.
- Bands "auto, needs review": replaced by two fixed stages, all selected by default and sorted by confidence.
- "Export blocked while findings need review" (REV-9): replaced by a warning the user can pass (S28).
- Never-hide list (REV-5): delivered by stored rejections.
- Threshold and strictness settings: dropped with the slider.
- Pack source format: the HLD says YAML compiled to JSON. This brief names none; to be confirmed in design.
- Pack delivery: the HLD mentions packs served to the app. Lists and packs now ship in the bundle.
- The certificate moved to v1, so the run record (A13) is what records what ran.
- Keyboard review (REV-11): moved out of phase 4.
- Entity types: the ground-truth schema lists 14 general types and no India. Specific identifier names on marks (S34) mean it grows, or each identifier maps to one of its types for scoring.
- The HLD's "reduced detection is never silent": not met in this phase for names, addresses and scanned pages (S29).

### Facts to verify before design

- The check-digit facts marked "from memory" in the workbook; the ABHA check digit; the UTR and EPIC disagreements.
- An official list of UPI handles; the licence for Vocalink's tables; whether Purview's keyword lists may be copied.
- That a label and its value in neighbouring table cells are near each other in the page's character order.
- The speed measurement, repeated in a Chrome worker with validators.
- Approval time at about 5,000 marks per document.
- The stored-format step: an optional field or a version 4 migration.

### Next step

The owner confirms the two readings in section 1.10 and that this brief matches the decisions. Then the handoff: publish the brief for feedback, or start the design document, which gets its own Goldfish review.

## Appendix: History

`concepts_brief.pre-review.md` is this brief as it stood before the review. It holds the text this version replaced:

- the first-cut country table for seven countries, which included New Zealand and Ireland;
- the "sections in one panel" proposal and the earlier note on sorting by confidence;
- the timing-based merge rule ("merge if both exist before the stage opens");
- the proposal that stages are formed by the app;
- the country core defined as checksum identifiers only;
- the four open points on the panel swap, two of which were already settled.

# Redactorator Implementation Plan

Nov 18, 2026 · @Sahil Chaddha

## Summary

This plan turns the [PRD](PRD.md) and [HLD](HLD.md) into an order of work. It is ordered so the earliest phases give end-to-end feedback: the first thing built is a browser app in which a person marks text in a PDF by hand and gets back a PDF with that text removed, tested end to end in a real browser. Detection comes later, one layer at a time, and each layer is scored against a dataset with ground truth.

Three tracks run side by side:

- **Build track.** Nine phases to the MVP. Each phase ends with stated exit criteria, at least one of which is a browser test that runs locally.
- **Dataset track.** One ground-truth format; synthetic documents made from existing labelled text datasets; 200 real-world documents labelled with the phase 1 tool.
- **Spike track.** Measurements that settle D10 (NER models) and D6 (OCR engine) before the phases that need them.

This plan is a bird's-eye view: it sets each phase's responsibilities, the order of work and the test that ends each phase. File names, types and library versions are chosen while a phase is built.

**Principles**

1. **A browser test first, then features.** Every phase starts by writing the end-to-end test it must pass.
2. **Integration and unit tests, run locally.** One command runs everything. Integration tests drive the real app in a real browser and check the output file with a checker outside the app; unit tests cover pure logic such as validators, checksums, the normaliser, the matcher and placeholder restore.
3. **The output is judged by an outsider.** Every exported file is checked by an extractor the app does not use, so a bug in our engine cannot hide its own leak.
4. **Measure before choosing.** Models and the OCR engine are chosen on the dataset, not on reputation.
5. **Thin slices behind the HLD's contracts.** Each phase adds one adapter, detector or stage behind its contract, so later swaps stay cheap.

## Phase overview

![Implementation tracks · 9 build phases, 3 dataset steps, 3 spikes](images/plan-tracks.png)

The build track runs in order. The dataset track starts beside phase 0, and the two spikes start once the 500 synthetic PDFs exist. The MuPDF.js check, drawn on the spike track in the diagram, runs inside phase 1. The synthetic documents feed both spikes, and the phase 1 tool is also the labelling tool for the real documents.

| Phase | Delivers | Done when | Waits for |
| --- | --- | --- | --- |
| 0 Setup | Repo, TypeScript app shell, engine worker, MuPDF.js loaded, Playwright and unit tests behind one local command | A test opens a fixture PDF in the app and sees page 1 rendered | Nothing |
| 1 Manual redaction | Mark text or draw a box, apply, download a cleaned PDF; label export | All phase 1 tests pass locally; a person outside the team cleans a real PDF with the preview build (manual check) | Phase 0 |
| 2 Working sets (projects) | Project storage behind one interface (a folder on disk or browser storage), IDE workbench, review states, marks and image boxes spread on approval, outputs saved to the project folder | Phase 2 tests pass locally in Chrome | Phase 1 |
| 3 PDF leak suite | Our PDF leak-vector list and fixtures; the certificate | Every vector on our leak list passes for manually marked values | Phase 2 |
| 4 Rules and review | Regex and validator packs for six countries, term lists, review bands, approval-gated spread | Each rule type's recall is measured and reported; the leak suite passes | Phase 3; synthetic set |
| 5 Pseudonyms and restore | Text adapter, placeholders, vault, restore | Round trip on the synthetic text split and real AI replies with no wrong restores | Phase 4 |
| 6 NER models | Models per detection level, device check, level banner | Recall per level measured and recorded; the banner shows on the three reference devices (run by hand) | Phase 5; D10; the 200 labelled real documents |
| 7 OCR and images | Scanned PDFs, PNG, JPEG and WebP, pixel checks | Scanned and image leak fixtures pass; no ink under any box; recall on the scanned and image splits measured and reported | Phase 6; D6 |
| 8 Accounts and quota | Auth0 sign-in, Accounts API, credits, offline batch, telemetry | Only allowed requests leave the browser; quota enforced | Phase 7 |

## Phases 0 and 1: the walking skeleton

The skeleton is the whole product path with no detection: open, mark, apply, check, download. It goes first because it holds the riskiest part, true removal in the browser, and because every later phase plugs into it.

**Phase 0: setup**

- One repository: `app/` (UI), `engine/` (the Web Worker), `tests/e2e/` (Playwright), `tests/oracle/` (the outside checker), `fixtures/`.
- TypeScript, Vite for the build, MuPDF.js loaded in the worker, Playwright and a unit-test runner behind one local test command. Preview builds are deployed by hand to a static host.
- MuPDF.js is pinned to an exact version; any version change re-runs the leak suite before it lands.
- The engine's shared types live in one module: `DocumentModel`, `Finding`, `Decision`, `Edit` and the worker messages. Boxes use one convention everywhere: points in MuPDF's page space, origin top-left; phase 1's rotated-page test checks it. An `Edit` is either a text range or a free box with no text behind it.
- **Done when** a Playwright test opens a fixture PDF in the app and sees page 1 rendered.

**Phase 1: manual redaction end to end**

What the user can do:

1. Open a PDF by picking or dropping it. The worker renders pages with MuPDF.js; nothing is stored or sent.
2. Select words on a text layer built from MuPDF.js character boxes, or draw a box over any area, images included.
3. See the marks in a list and remove any of them.
4. Apply. The worker adds redaction annotations, applies them with text removal and image-pixel blanking, draws boxes, clears metadata and rewrites the file in full.
5. The worker re-reads the new file and checks that no text is left under any box, then offers the download.
6. In labelling mode, the same screen gives each mark a type and an optional link id, and exports the marks as ground truth in the dataset schema. This is the tool used to label the 200 real documents.

Out of scope: detectors, working sets, storage (files stay in memory), accounts.

**The outside checker.** Tests never trust the app's own check. A stand-alone checker, built fresh in `tests/oracle/` as part of phase 1 and written from the requirements, reads each downloaded file with pdfminer.six and a raw scan of every PDF object (neither shares code with MuPDF.js) and searches for every marked value in the text layers, raw streams, metadata and annotations. Nothing from the POC is used: no code, fixtures, leak lists or numbers, and agents never read it.

Phase 1 browser tests:

| Test | Checks | Carrier |
| --- | --- | --- |
| Mark one word, apply, download | The word is in no text layer or raw stream; the area renders as a box | Text layer, raw stream |
| Box over part of an embedded image | The image's pixels under the box are blank in the file itself | Embedded image |
| Rotated and cropped pages | The box lands where the text was; the text is gone | Page geometry |
| Any export | No Info or XMP metadata; one revision | Metadata, revisions |
| Text near a mark | Glyphs outside every box keep their positions, compared before and after apply | — |
| Labelling mode | The exported JSON is valid and its boxes match the marks | — |

**The MuPDF.js check.** Two unknowns: whether MuPDF.js exposes the image-pixel option, and whether its removal leaves nothing behind. Phase 1's tests answer the first and give a first answer to the second on their cases; the phase 3 leak suite settles it. If the image-pixel option is missing, phase 1b adds the fallback (decode the image, blank the pixels under each box, re-encode it) before phase 2 starts.

**Done when** all six tests pass locally, and a person outside the team cleans a real PDF with the preview build (a manual check).

## Dataset track

The dataset is what every detection phase and both spikes are scored against. It has two parts: synthetic documents made from labelled text datasets that already exist, and 200 real-world documents we label ourselves. Counts below are proposals to adjust once the first scoring runs show where errors fall.

**Step 1: one ground-truth schema.** A JSON file per document:

- source, licence, country, format (born-digital PDF, scanned PDF, image, text), split;
- entities, each with a type from our list, its value, and a link id when two spellings are the same person or thing;
- occurrences, each with page, character offsets in the extracted text, and boxes (PDF points, or pixels for images);
- hidden occurrences (metadata, annotation, form field, hidden layer) with their location, for the leak suite.

Entity types are the PRD's DET-1 list. Boxes are the authority (PDF points in the engine's box convention, or pixels from the top-left for images). Offsets index the text MuPDF.js extracts, so they line up with the app's findings; a tool using another extractor derives its offsets from the boxes. Each file carries a schema version.

A validator checks every file. The phase 1 labelling mode writes the same schema.

**Step 2: synthetic documents from labelled text**

| Source | What it has | Licence | Use |
| --- | --- | --- | --- |
| [Nemotron-PII](https://huggingface.co/datasets/nvidia/Nemotron-PII) (NVIDIA) | Synthetic records with character-offset spans across many document types and 55+ PII types; locale US or international | CC BY 4.0 | Main source of synthetic documents |
| [Gretel synthetic PII finance](https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual) | 55.9k synthetic financial documents with spans, 29 PII types, 7 languages | Apache-2.0 | English rows: contracts, statements, forms |
| [TAB](https://github.com/NorskRegnesentral/text-anonymization-benchmark) (ECHR) | 1,268 real court judgments with identifier spans and co-reference | MIT | Long real prose; tests for linking spellings |
| Our generator | Faker locales for the UK, Canada, Australia, New Zealand and Ireland, with valid identifiers from python-stdnum | Ours | The five launch countries that Nemotron's locales do not name |

Avoided: the ai4privacy datasets (earlier releases limit commercial use; the newest is unclear), Kleister and RealKIE labels (unclear or non-commercial), i2b2/n2c2 (a data-use agreement), CoNLL-2003 (Reuters licence).

How a text record becomes a PDF:

1. Pick a template: letter, form with fields, invoice or table, two-column report, printed email. Vary fonts and sizes.
2. Render with PyMuPDF, then extract each span's glyph boxes from the rendered page, so each span's boxes are exact.
3. Make variants: born-digital; scanned (rasterised at 200 to 300 dpi, noise, slight skew, JPEG), with boxes carried through the same transforms; and hidden carriers (the value copied into metadata, an annotation, a form field or a hidden layer).
4. Re-extract each file and check that every span's text sits in its boxes; drop any file that fails.

The generator is a Python tool in `tools/dataset/`. Tools need not share the product's language.

**Step 3: 200 real-world documents**

Public documents that already carry real names and addresses:

| Kind | Sources to draw from |
| --- | --- |
| Contracts, agreements, filings (US) | SEC EDGAR exhibits; US court opinions from CourtListener |
| Filings and reports (UK) | Companies House, Charity Commission reports, Find Case Law judgments |
| Judgments (CA, AU, NZ, IE) | National court and legal-information sites, each licence checked first |
| Emails and plain text | The Enron email corpus |
| Scanned letters and memos | UCSF Industry Documents Library |

Proposed mix: 100 born-digital PDFs, 50 scanned PDFs, 20 images and 30 emails or text, spread across the six launch countries. DOCX files join in v1.

Labelling:

1. Pre-label with off-the-shelf PII detectors run as a separate script, not the POC, so people correct labels rather than start from blank. From phase 4, the app's own rules can pre-label as well.
2. Correct each document in the phase 1 tool's labelling mode.
3. A second person re-labels 20% blind; agreement is reported, and disagreements update the guideline.
4. The guideline adapts TAB's published annotation guidelines to our entity types.

These documents hold real personal data, even if public. They live in private storage, not in the AGPL repository. A manifest records each one's URL and licence, and they are used for testing only.

**Splits.** A development split for tuning and a held-out test split nobody tunes on, about 70/30. A smoke subset of about 50 development documents gives a quick score; the full set runs on demand.

**Done when:** the schema and validator exist (needed by phase 1), 500 synthetic PDFs exist (needed by the spikes), and the 200 real documents are labelled (needed by phase 6).

## Spike track

The spikes settle HLD decisions D10 (NER models for each detection level) and D6 (OCR engine). The MuPDF.js parity check lives inside phase 1. Both spikes start once the 500 synthetic PDFs exist, and run beside phases 1 to 5.

**One harness for both.** A benchmark page in the app repository uses the same worker and TypeScript code as the product. Playwright drives it through a dataset split and writes a metrics file per candidate; a script turns the files into one comparison table. It runs on three reference devices:

1. a laptop with a strong GPU and WebGPU;
2. an office laptop with integrated graphics;
3. an older or low-memory machine without WebGPU.

There is no outside baseline: candidates are compared with each other on the same documents.

**NER spike (D10)**

- **Candidates:** the OpenAI Privacy Filter, GLiNER2-PII, other GLiNER PII models, and BERT- or DeBERTa-based PII taggers with ONNX exports. A licence check comes first; a model whose licence blocks commercial use is dropped before any measuring.
- **Measures:** recall and precision for names and addresses, overall and per name-origin group; download size; peak memory; cold start; time per page with WebGPU and with WebAssembly.
- **Decision rule:** set a budget per detection level before measuring (download size and time per page). For each level, pick the model with the best recall within that level's budget, and set its thresholds per type.
- **Done when** the Full and Standard detection levels (HLD, Detection stack) have their models and D10 is recorded in the HLD. Must finish before phase 6.

**OCR spike (D6)**

- **Candidates:** Tesseract.js, PaddleOCR PP-OCRv5 (its browser SDK or an ONNX build), and docTR.
- **Measures:** character error rate on the scanned split; box tightness, as the share of ink pixels outside each word box (the HLD's OCR spike method); whether word boxes come out or must be derived from lines; download size; time per page; tolerance to skew.
- **Decision rule:** Tesseract.js stays unless a candidate beats it by a margin agreed before measuring, on both error rate and box tightness.
- **Done when** D6 is recorded in the HLD. Must finish before phase 7.

## Phases 2 to 8, and after the MVP

Each phase keeps every earlier test green and adds its own.

**Phase 2: working sets, shown in the app as projects.** Decided with the owner on 21 Nov 2026; this replaces the encrypted store first planned here.

- *Storage.* One small storage interface (read, write, list and delete files) with no database engine: a project is a folder of JSON records beside its originals, held in memory while open and written file by file as it changes. v1 supports Chrome only (decided 21 Nov 2026). The user can pick a folder on their own disk to hold every project, so browser clean-up cannot delete them; until they do, projects live in the origin-private file system and the app asks for persistent storage, gently and again later. In Chrome both are directory handles with the same API, so one backend serves both. The interface keeps the app free of any one backend, so a backend for Safari or Firefox, or a cloud one, can be added later without changing the app.
- *Layout a person can browse.* In the project folder: the originals under their own names, and the technical files (`project.json`, which holds every document's marks so an approval is saved whole, and each document's extracted text) in a hidden `.redactorator/` folder; global settings in `.redactorator/settings.json` at the top. Dot folders are hidden on macOS and Linux; Windows shows them, and a web page cannot set Windows' hidden attribute.
- *No encryption at rest and no passphrase in v1.* A folder on disk is as private as the user's other files; the origin-private file system is private to our site.
- *Workbench.* IDE-style: a documents explorer on the far left, then the page thumbnails, both hideable; tabs for open documents above the page. Undo and redo within a document's edits; approving cannot be undone, so it clears that document's undo history. Every change autosaves. Projects can be created, renamed, duplicated, archived and deleted; a dropped file on the home screen quietly becomes a new project. Files that cannot be added (not a PDF, encrypted, damaged) are listed with the reason.
- *Review states and spreading.* Each document is Not started, In review or Approved. A mark puts its document In review. Approving a document spreads its marks, and any value it stopped hiding, to every match of the normalised value at word boundaries in the project's other documents (HLD, Working sets, step 2), after a heads-up naming those documents. Nothing spreads before approval. A spread sends an approved document back to In review, marked "Changed since download", and opening it offers a review of only the items the spread brought in. A document added later gets every approved value at import and opens In review, with those items shown as new in the same review. Spreading runs in the worker against each document's stored text model.
- *Boxes.* A box over an embedded image is kept as drawn, measured in that image's own frame, and spreads on approval to the same image, or a near-identical copy, in other documents, at the same place within the image and at whatever size or rotation it is drawn there. A copy is found by a 64-bit difference hash of a small grey copy of the image, or of its soft mask when the colour alone is plain; at most 10 of the 64 bits may differ. A box spreads only when at least half of it lies on one image. Images under 32 pixels a side, near-plain images, images covering more than half their page (a scanned page) or showing no area on it, and images whose shapes differ by more than 10% are never matched (decided 22 Nov 2026). Vector drawings, whether inline in a page's content or stored once as a reusable object, and scanned pages are not matched: MuPDF.js does not report where a reusable drawing is placed, and a box over part of a drawing leaves it in the file (phase 3's line-art fixture), so spreading it would copy that leak. Any other box stays in its own document.
- *Moving a project.* A project goes to another computer as a copy of its folder; "Import a project" copies a picked project folder in. There is no single export file.
- *Outputs.* Built from the original when downloaded, and kept nowhere: a cleaned file is an ordinary browser download, so the project folder holds only originals and its technical files, and deleting a project deletes all of it. A document can be downloaded before it is approved, as a preview whose file name ends `-preview`. Each document shows Not downloaded, Downloaded, or Changed since download; a browser cannot tell where the user put a download, so Downloaded means it was downloaded from this project at some point.

*Tests:* mark a value in document A and approve A, and document B comes out redacted and is back In review; mark a value in A without approving, and B is unchanged; add document C later, and it comes out redacted and opens In review with those items shown as new; a value that differs only in spacing or number formatting is matched; a value inside a longer word is not; a box over part of an image in A hides the same part of that image in B, where it is drawn at another size; a box with nothing behind it stays in A; undo and redo reverse and restore a mark, and approving clears the undo history; reload, and every mark and review state is back; delete leaves no project files behind. The tests run against the origin-private file system; one test stands in for the folder picker with an origin-private folder, because a browser test cannot answer the real picker, and a real folder is checked by hand. *Done when* those pass locally in Chrome.

**Phase 3: PDF leak suite.** The phase starts by writing our own PDF leak-vector list and its fixtures from the PDF specification's hidden carriers: hidden text, off-page text, hidden layers, vector drawings only partly under a box, annotations, form fields, bookmarks, links, attachments, scripts, thumbnails, structure trees, ActualText, metadata and old revisions. Manual marks must remove values from every carrier on the list. Marked values are also found inside hidden carriers after decoding their string encoding. The in-app verifier adds PDF.js as a second extractor. Each export gets a certificate. *Tests:* one browser test per leak fixture, judged by the outside checker. *Done when* every vector on the list passes.

**Phase 4: rules and review.** Regex and validator packs for the US, UK, Canada, Australia, New Zealand and Ireland; term lists; custom patterns; repeats spread within a document. The review screen shows findings in their bands (auto, needs review) and lets the user approve or reject each. An approved finding spreads across the working set; a pending one stays in its own document. The phase starts by listing, per country, the identifier types it covers and the source of each rule. Packs are compiled from YAML to JSON at build time. Custom patterns run in a worker that is stopped when it passes a time limit. *Tests:* each pack is scored on the synthetic set; a browser test approves and rejects findings, and checks that an approved finding spreads to document B while an unapproved one does not; a pattern that never finishes is stopped within the time limit. *Done when* each rule type's recall is measured and reported, with no leak-suite failures.

**Phase 5: pseudonyms and restore.** Text adapter, placeholder surrogates, the vault and the restorer, with unknown placeholders flagged. *Tests:* paste text, pseudonymise, feed back an AI-style reply with changed case, brackets, quotes, markdown emphasis, a trailing possessive, a line break inside a placeholder and an invented `PERSON_9`, and restore exactly; `PERSON_1` is not matched inside `PERSON_10`; a small fixed set of real Claude and ChatGPT replies restores with no wrong restores. *Done when* the round trip passes on the synthetic text split and the real replies with no wrong restores.

**Phase 6: NER models.** Models in the slots D10 chose, the device check, the level banner, the level recorded per document and on the certificate. Models and libraries may load from their public hosts (for example the Hugging Face Hub or a CDN), each pinned to an exact revision; the app checks each downloaded file's hash before using it. The network-allowlist test lists those hosts and fails on any request to them that is not a plain download, and on any request to another host. D10's results (the model in each level, thresholds per type, the device-check limits) are recorded where the engine reads them. *Tests:* recall per level on the real-document test split, reported when run; a browser test forces each level and checks the banner. *Done when* each level's recall is measured and recorded and the banner shows on all three reference devices (run by hand).

**Phase 7: OCR and images.** The phase starts by writing the image leak-vector list (EXIF, XMP, embedded thumbnails, bytes after the image end marker) and its fixtures. The OCR engine D6 chose; scanned PDFs, PDFs mixing text pages and scans, PNG, JPEG and WebP (TIFF per the PRD decisions); the HLD's coordinate mapping, with pages rendered at 300 dpi, deskew before OCR and padded boxes; an existing invisible OCR layer merged with our own OCR. *Tests:* scanned and image leak fixtures pass; a pixel check finds no ink left under any padded box; a mixed PDF is handled page by page. *Done when* those pass and recall on the scanned and image splits is measured and reported.

**Phase 8: accounts, quota and telemetry.** Auth0 sign-in with no passwords, the Accounts API, credits and the offline batch, the one-document trial, the published telemetry schema. The phase starts by writing the telemetry schema (numbers, enums and ids only, no free text) and the network allowlist: our own hosts, plus the public download hosts from phase 6. *Tests:* a network test records every request during a full session and fails on any request outside the allowlist or any telemetry field outside the schema; a quota test runs out of credits and checks that existing data still opens. *Done when* those pass. This completes the MVP.

**MVP gate.** Zero leaks across the leak suite and the dataset; recall per level published; pilot users from the PRD's lead user (the AI-assisted professional) finish an AI round trip unaided.

**After the MVP (v1):** the DOCX leak-vector list and fixtures, then the DOCX adapter and restore into DOCX; Stripe billing and the paid plan; realistic fakes with the restore flags; the verifier browser extension; the India pack and a secrets pack.

## Requirement coverage

P0 requirements and HLD controls the phases above do not name, and the phase that owns each:

| Requirement | Phase |
| --- | --- |
| Content Security Policy; network-allowlist test; pipeline run with the network blocked | 0 |
| RED-6 box colour or `[TYPE]` label; REV-6 preview; DOC-4 refuse encrypted or unknown files | 1 |
| DOC-5 multi-file and folder import; REV-7 undo, redo and autosave; SET-1 manage sets; SET-3 entity view; SET-6 changed-since-download status | 2 |
| AUD-1 run report; hidden-content options | 3 |
| REV-5 never-hide list; REV-9 export blocked while findings need review; REV-10 search and mark; REV-11 keyboard review; threshold and strictness settings | 4 |
| PSE-3 copy or download; PSE-10 restore into `.txt` and `.md` | 5 |
| Detection-depth setting, as the level override | 6 |
| DOC-4 for pages OCR cannot read | 7 |
| Service worker and offline use; D9 release-hash items; ACC-5 plans page; ACC-6 account deletion | 8 |
| WCAG 2.2 AA and keyboard operation | Every phase with UI |
| Pseudonymised PDF output | Open: phase 5 or v1 (PRD owner) |

**PRD decisions (18 Nov 2026)**

- PSE-9 realistic surrogates and PSE-14 restore into DOCX are v1.
- DOC-7 in the MVP covers PNG, JPEG and WebP; TIFF joins if phase 7 confirms MuPDF.js decodes it, otherwise v1; HEIC, GIF and BMP are v1.
- Telemetry can be switched on and off by the user; it starts on.

## Testing strategy

| Layer | What it runs | Judged by | When |
| --- | --- | --- | --- |
| Browser flows | Playwright drives the real app through user steps on fixtures | Visible results and downloaded files | Local test command |
| Leak suite | One fixture per vector on our PDF list, then image vectors (DOCX in v1) | The outside checker | Local test command |
| Dataset scoring | The app's engine over the dataset splits | Recall and precision per type, per level, per name-origin group | On demand |
| Network allowlist | A full session with every request recorded | The allowlist and the telemetry schema | Local test command, from phase 0 |
| Devices | The dataset run on the three reference devices | Speed and memory per level | On demand, from phase 6 |
| Unit tests | Validators, checksums, the normaliser, the matcher, placeholder restore | Plain assertions | Local test command |

**Test rules**

- **One local command** runs the unit tests, browser flows, leak suite and network test.
- **Leak failures are never skipped.** A leak gets a fixture before it is fixed.
- **Nothing leaves the team without a green run.** No build goes to a user outside the team unless the local command passes.
- **Scores inform, they do not block.** Dataset recall and precision are reported; a drop is investigated, never a reason a change cannot land.
- **The engine runs headless too.** The same worker code runs without the UI, so dataset scoring needs no clicking.

## Checkpoints, risks and open questions

**Feedback checkpoints**

| Checkpoint | When | What we learn |
| --- | --- | --- |
| First browser test green | End of phase 1 | True removal works in a browser for the phase 1 cases; whether MuPDF.js has the image-pixel option is known |
| First outside user | End of phase 1 | Whether manual redaction alone is useful, from a person outside the team |
| First dataset scores | Phase 4 | Where rules miss, by type and country |
| Spike readouts | Before phases 6 and 7 | Which models and OCR engine, and what each device level can do |
| AI round trip demo | End of phase 5 | Whether pilot users finish paste, pseudonymise and restore unaided |
| MVP gate | End of phase 8 | Zero leaks; pilot users finish unaided |

**Risks**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| MuPDF.js lacks the image-pixel option | Pixels under boxes on embedded images and scans stay in the file | Found in phase 1; phase 1b re-encodes the image |
| Labelling 200 documents takes longer than planned | Phase 6 has no real test split | Start labelling as soon as phase 1 ships; pre-label with off-the-shelf detectors; label in batches of 50 |
| Real-document licences differ by country | Some sources are unusable | Check each source before collecting; the manifest records licences |
| Synthetic data names the US as the only launch-country locale | Rules look better than they are elsewhere | Our generator fills the five other countries; real documents are spread across all six |
| Models are too heavy for many devices | Most users get Basic detection | The spike's budgets per level; the banner tells them; manual marking and the working-set matcher work at every level |
| Vector drawings partly under a box stay in the file | MuPDF's line-art option used since phase 1 (`REDACT_LINE_ART_REMOVE_IF_COVERED`) removes a path only when the box covers all of it, so a box over most of a vector logo hides it on screen while its drawing commands stay under the box | A leak fixture in phase 3; then cut paths at the box edge, or remove every path the box touches and check what else that removes |
| Browser differences (WebKit storage, WebGPU) | A flow works in one browser only | v1 supports Chrome only; the local suite runs in Chrome. Safari and Firefox come later, each with a storage backend of its own |

**Decisions each phase waits for**

| Decision | Needed before | Proposed default |
| --- | --- | --- |
| UI framework, preview host | Phase 0 | — |
| Storage engine and key setup | Phase 2 | Decided 21 Nov 2026: JSON files behind a storage interface, a folder on disk or browser storage, no encryption in v1 |
| Recall goals per entity type (reported, not a gate) | Phase 4 | 99% for structured identifiers (PRD success metrics) |
| The three reference devices | Phase 6 | — |
| Recall goals for the scanned and image splits (reported, not a gate) | Phase 7 | — |
| Hosting for the Accounts API and telemetry store; whether the MVP needs metering before a paid plan exists | Phase 8 | — |

**Other open questions**

- [ ] Team size and target dates.
- [ ] Who labels the real documents, and who does the 20% second pass.
- [ ] Whether and when the app's repository becomes public for the AGPL; real documents stay in private storage. The POC stays local, outside any repository.

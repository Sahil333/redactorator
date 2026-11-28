# app

## Overview

The browser UI of Redactorator, written in React 19 and TypeScript. It is one
flat folder with no subdirectories. `index.html` loads `main.tsx`, which mounts
`App` under `#root`. All document work is done by the engine in `engine/`,
which this folder imports from `../engine/...`. The UI starts the engine
(`createBrowserEngine`), asks it for page renders, page text and placed images,
and sends it changes to marks, approval, output and history through the engine
`Session`.

The app has three screens:

- **Shell** (`App`, `Home`, `ProjectView`): chooses where projects are kept,
  lists projects, and opens one. The open project is kept in the URL hash
  (`#project=<id>`).
- **Workspace** (`Workspace`, `TopBar`, `MarksPanel`, banners and dialogs): the
  open document, its marks, approval, and the checked output with its download.
- **Viewer and marking** (`PageList`, `PageView`, zoom, selection hooks): pages
  drawn from engine pixels, and marks made by drawing a box or selecting text,
  with the pointer or the keyboard.

## Interface

### Entry and shell

- `index.html` -> `main.tsx` -> `App`. `main.tsx` throws if `#root` is missing.
  It also imports the bundled font `@fontsource-variable/atkinson-hyperlegible-next`.
- `App` (App.tsx): the root component. Builds the engine once `useProjectsFolder`
  knows the first store. Renders `ProjectView` while a session is open,
  otherwise `Home`. Reads `?label` from `location.search` to turn on labelling
  mode.
- `Home` (Home.tsx): the projects screen. It shows the folder card
  (choose, reopen or missing), the project list with rename, duplicate,
  archive and delete, the drop and pick area, import, and the delete
  confirmation dialog.
- `ProjectView` (ProjectView.tsx): the open project. It holds `TopBar`,
  `ApproveDialog`, `Explorer`, `DocumentTabs` and `Workspace`, and wires adding
  files, applying, approving, undo and redo, label export, and setting the
  project's profile.
- `useProjectsFolder`, `Waiting` (useProjectsFolder.ts): find the remembered
  projects folder and its store. Return `{waiting, chooseFolder, reopenFolder,
  pickProjectToImport}`.
- `rememberedFolder`, `rememberFolder`, `pickFolder`, `stillThere`
  (projectsFolder.ts): read and store the folder handle in IndexedDB, wrap
  `showDirectoryPicker`, and check the folder still exists.
- `incomingFiles` (incomingFiles.ts): turns browser `File`s into the engine's
  `IncomingFile`. The bytes are read lazily, in `read()`.
- `PickFiles`, `DropZone`, `NotAdded`: pick PDFs or folders, take dropped files
  and folders, and list the files that were refused.

### Workspace and review

- `Workspace`, `PanelWidths`, `initialWidths`, `Review` (Workspace.tsx): the open
  document view (thumbnails, pages, marks panel) and the checked-output preview
  with its download.
- `TopBar`, `Editing`, `History` (TopBar.tsx): the header with save state,
  status, Auto mode's controls, undo and redo, tool picker, Add documents,
  Approve, Preview, and Export labels.
- `AutoControls`, `Auto` (AutoControls.tsx): Auto mode's controls in the top
  bar. For now only "What to look for", which opens the chooser for the
  project.
- `ProfileChooser` (ProfileChooser.tsx): the dialog that asks which countries
  and industries Auto mode looks for, with "Adds: ..." under each choice, from
  `identifierPacks` and the schema's type names. It starts from the project's
  profile, or with nothing selected, and may be saved with nothing selected. Its
  `purpose` is `project` (stored with `profile.set`) or `run` (for one run
  only, which nothing opens yet). A refusal keeps it open with its sentence.
- `ApproveDialog` (ApproveDialog.tsx): the heads-up shown while an
  `ApprovalPlan` waits: where the approval spreads, and under "Removed from this
  file" the plan's `removed` kinds, one line each in the design's Appendix A.3
  words and order. It confirms or cancels the plan.
- `CheckedBanner`, `ReviewBanner`, `LabelExport`, `AppearanceSettings`: the
  output banner, a walk through new marks brought in by another document's
  approval, the ground-truth label form, and the box appearance settings (box
  colour, and a checkbox that sets `appearance.label` to print the type in each
  box).
- `DocumentTabs`, `tabId`, `DOCUMENT_PANEL_ID`, `Explorer`, `useTabs`: the
  document tabs and the document list. Open tabs are remembered per project.
- `MarksPanel`, `marksPanelWidth` (MarksPanel.tsx): the marks list, with
  retype, remove, keep-here and link controls. A view picker switches between
  "This document", "Whole project" and "New". "Whole project"
  (`MarksPanel.tsx:ProjectList`) lists the values hidden across the project and
  how many places and documents each reaches. Delete on a row removes it while
  marks can be changed (`MarksPanel.tsx:removeOnDelete`).
- `Tool`, `MIN_BOX_POINTS`, `Pending`, `pagesLabel` (marks.ts): the mark tool
  type, the smallest box size (3 pt), the shape of a mark that waits for its
  type, and the page-range label.
- `useMarks`, `Marks` (useMarks.ts): the pending mark, the highlight, the type
  options, and add, retype, remove and link through the `Session`.
- `baseName`, `download`, `savePdf` (download.ts): strip `.pdf` from a name,
  download a Blob through a local object URL, and save a PDF through
  `showSaveFilePicker` and `writeWhole`.
- `errorText` (errors.ts): the sentence the user sees for an `EngineError`.
- Engine hooks: `useEngineState`, `useEngineError`, `useProblem`,
  `engineStatus`, `useDocumentInEngine`, `useUndoKeys`, `useHandOffFocus`.

### Viewer and marking

- `PageList`, `PAGE_LIST_PADDING`, `PageView`, `PageLink`, `Thumbnails`,
  `thumbnailsWidth`: the page list, one page frame with its canvas and mark
  layer, links to a page or mark, and the thumbnail strip.
- `Splitter`, `PanelWidth`: resize a side panel by drag or arrow keys.
- `TypePicker`, `PICKER_WIDTH`: the combobox that picks a mark type or adds a
  custom one.
- `useZoom`, `MIN_ZOOM`, `MAX_ZOOM`, `ZoomControls`: zoom from 0.25 to 3, fit to
  width, Ctrl or Cmd with + - 0, and Ctrl+wheel or pinch.
- `usePageImages`, `RenderDetail`, `useImages`, `useWhenVisible`: request page
  renders and text when pages come into view, and the document's placed images.
- `CSS_PIXELS_PER_POINT`, `PageScale`, `fittingScale`, `pointOnPage`,
  `pageFrameId`, `markElementId`, `showMark` (pageGeometry.ts): page coordinates
  and DOM ids.
- `newBox`, `boxStep` (keyboardMarking.ts), `useKeyboardMarking`,
  `usePointerMarking`: box marking by keyboard and pointer.
- `useTextSelection`, `TextSelecting` (useTextSelection.ts) and `missingPages`,
  `selectionTarget`, `wordAround`, `nextWord`, `wordOnNextLine`, `firstWordIn`,
  `extend` (selection.ts): one text selection for the whole document, which can
  span pages.

## Invariants

### Where data goes

- No file in this folder makes a network request of its own. There is no
  `fetch`, XHR, `sendBeacon`, WebSocket or EventSource. The only requests the
  browser makes for this folder are for the font files that `main.tsx` imports,
  which are bundled assets served from the app's own origin and carry no
  document data. Outputs leave only as local
  saves: `download.ts:download` uses an object URL, and `download.ts:savePdf`
  uses `showSaveFilePicker` with `writeWhole`. Both have a comment saying
  "nothing is uploaded".
- `useTabs.ts:storageKey`: sessionStorage holds "document ids, never anything
  from a document".
- `projectsFolder.ts`: IndexedDB holds only the picked folder handle.
  `withHandles` closes the database after each use.
- `useDocumentInEngine` asks again for a document whose open was refused with
  `busy-updating`, once the update lets it open.
- `errors.ts:errorText` returns the worker's own `error.message` unchanged when
  it has one. Otherwise it uses the app's fixed sentence for `error.code`, which
  fills in only `name`, `doing` and `file` from `error.data`. A code with no
  sentence returns undefined, so nothing is shown. The worker decides what
  `error.message` holds.
- `useEngineError.ts:failed`: a request failure is shown only when it carries a
  sentence the worker wrote.

### Approval and output

- `ApproveDialog.tsx:HeadsUp`: approval needs an explicit confirm, which calls
  `session.approval.confirm(planId)`. Approve has the focus when it opens, so
  Enter confirms. Cancel or Escape calls `session.approval.cancel(planId)`.
- `ApproveDialog.tsx:Removed` shows kinds only, from fixed sentences: never a
  value or a count.
- `Workspace.tsx:Workspace`: the download takes `session.output.bytes()`. If
  the bytes are not ok, it throws "The output is out of date" and saves
  nothing. An approved output is saved as `<base>-redacted.pdf`, an unapproved
  one as `<base>-preview.pdf`. `onDownloaded` runs only when `savePdf` returns
  true.
- `Workspace.tsx:Workspace`: marking is allowed only when no output is shown
  and the engine is ready. Marks are not drawn over the output.
- `CheckedBanner.tsx`: Download is disabled while a save runs, so only one save
  runs at a time.
- `TopBar.tsx:EditingActions`: Approve and Export labels are disabled while
  busy. Preview is too, and works with no marks: the document then downloads
  as its working copy.
- A refused Preview says why in the sentence `errors.ts` gives its code, with
  pages counted from 1 (`useEngineError.failed` keeps a writer refusal, which
  has no message). Its boxes, such as the unmarked letters a mark would also
  remove, are highlighted on its page (`Workspace.tsx:refusedBoxes`, through
  `PageList` to `PageView`) until Dismiss, which `DropZone` shows beside such
  a refusal, or the next Preview. A lost mark's row in `MarksPanel` says
  "Mark again"; marking its letters again replaces it.
  While a project's documents are prepared again for this build, the status
  line says "Updating documents…" (`ProjectView.tsx:statusText`).
  `ProjectView.tsx:useEditing` defines busy as: a mark waits for its type, or
  the engine cannot apply or cannot approve.

### Projects folder

- `useProjectsFolder.ts:firstStore`: a remembered folder is used only when
  `queryPermission({mode:'readwrite'})` is `'granted'` and `stillThere()` is
  true. Otherwise the page waits for the user to reopen it, or reports it
  missing. With no remembered folder, projects live in `privateStore()`. If
  reading the remembered folder or working out the first store throws, the
  engine starts with no store and the problem `projects-read-failed` is shown
  (`useProjectsFolder.ts:useProjectsFolder`).
- `useProjectsFolder.ts:chooseFolder`: a picked folder is adopted only after
  `library.folders.check()` succeeds and the folder is not a single project's
  own folder. `pickProjectToImport` asks for `'read'` access only.
- `App.tsx:useOpenProject`: if `session.close()` fails, the project stays open.
- `ProjectView.tsx:useFlushOnLeave`: the session is flushed on `pagehide` and on
  unmount.

### Geometry and marking

- Marks, boxes and selections are in PDF points.
  `CSS_PIXELS_PER_POINT = 96/72`. `pointOnPage` clamps to the page. Page
  indexes start at 0, and DOM ids and labels add 1 (`page-N`).
- `fittingScale` never goes above printed size.
- A box becomes a mark only if both sides are at least `MIN_BOX_POINTS`
  (`usePointerMarking.ts:onPointerUp`). Keyboard resizing never goes below that
  size (`keyboardMarking.ts:boxStep`).
- When `tool` is undefined (a preview, or the engine is busy), a page takes no
  marks (`PageView.tsx`, `useKeyboardMarking.ts:onKeyDown`).
- `selection.ts:selectionTarget` returns undefined when a page's text is
  missing. `useTextSelection.ts:markWhenReady` waits for the text before it
  marks.

### Page images

- Pages are drawn from engine RGBA pixels as `ImageData`. `PageView.tsx` puts
  them straight onto its `<canvas>` with `putImageData`. `Thumbnails.tsx` puts
  them onto an `OffscreenCanvas`, then scales that onto its `<canvas>` with
  `drawImage`. The viewer creates no object URLs and no `<img>` elements.
- `usePageImages.ts`: images of the `'original'` and `'output'` sources are
  kept apart. A change of output clears the output images. At most
  `MAX_FINE_PAGES = 6` pages are kept at detail 2. A finer image is kept over a
  coarser one that arrives after it (`usePageImages.ts:withImage`). When a page
  is evicted from detail 2, its image and its requests are dropped
  (`usePageImages.ts:forget`), so it can be drawn again at detail 1.

## Side Effects

- Engine state changes go through the `Session`. Marks: `marks.add`, `retype`,
  `remove`, `keepHere`. Also `labelling.link`, `labelling.exportGroundTruth`
  (`ProjectView.tsx:saveLabels`), `documents.add`, `documents.markDownloaded`,
  `output.apply` and `discard`, `approval.plan`, `confirm` and `cancel`,
  `history.undo` and `redo`, `profile.set` (`ProfileChooser`), `flush`, and
  `close` (`App.tsx:useOpenProject`).
  Library calls: `projects.create`, `open`, `rename`, `duplicate`, `archive`,
  `remove`, plus `folders.check`, `folders.importFrom`, `folders.switchTo` and
  `settings.update`. The viewer
  only reads: `viewer.open`, `render`, `pageText`, `images`.
- File System Access: `showDirectoryPicker` with ids `redactorator-projects`
  (readwrite) and `redactorator-import` (read); `queryPermission` and
  `requestPermission`; `showSaveFilePicker` (projectsFolder.ts,
  useProjectsFolder.ts, download.ts).
- IndexedDB: database `redactorator` v1, store `handles`, key
  `projects-folder` (projectsFolder.ts).
- sessionStorage: `redactorator:tabs:<projectId>` (useTabs.ts).
- `navigator.storage.persist()`, only when projects are kept in the browser
  and at least one exists (`useProjectsFolder.ts:keptInBrowser`).
- History: `pushState` and `replaceState` through `App.tsx:navigate`, to
  `#project=<id>` when a project opens and to the bare address with no hash
  (`homeAddress`) when it closes or cannot be opened, plus a `popstate`
  listener (App.tsx).
- Local reads of the user's files: `File.arrayBuffer()` (incomingFiles.ts), and
  `webkitGetAsEntry` with `readEntries` (DropZone.tsx).
- Labelling mode downloads `<name>.truth.json` through `download`
  (`ProjectView.tsx:saveLabels`).
- DOM: canvas drawing, IntersectionObserver, ResizeObserver, pointer capture,
  global keydown listeners (`useZoom.ts`, `useUndoKeys.ts`), a non-passive
  wheel listener on the pages pane (`useZoom.ts`), a `requestAnimationFrame` loop that
  scrolls during a text drag, `scrollIntoView`, focus moves, and modal dialogs
  and popovers.

## Verification

- Run: `pnpm test`

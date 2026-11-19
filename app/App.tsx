import { useState } from "react";
import type { Appearance, PageIndex } from "../engine/contract";
import { baseName, download } from "./download";
import { DropZone } from "./DropZone";
import { groundTruth, type DocumentFacts } from "./groundTruth";
import { LabelExport } from "./LabelExport";
import { toEdits, type Mark, type Tool } from "./marks";
import { TopBar, type Editing } from "./TopBar";
import { useEngine, type Engine, type OpenDocument } from "./useEngine";
import { useHandOffFocus } from "./useHandOffFocus";
import { useMarks } from "./useMarks";
import { initialWidths, Workspace } from "./Workspace";

function statusText(engine: Engine, currentPage: PageIndex | undefined): string {
  if (engine.state === "starting") return "Starting the PDF engine…";
  if (engine.state === "stopped") return "The PDF engine is not running.";
  if (engine.state === "applying") return "Applying and checking…";
  if (engine.document === undefined) return "Choose a PDF to open.";
  return `Page ${(currentPage ?? 0) + 1} of ${engine.document.model.pages.length}`;
}

// Labelling mode, for building the evaluation dataset: open the app with ?label.
const labelling = new URLSearchParams(window.location.search).has("label");

const FILE_INPUT_ID = "open-pdf";

function EmptyState() {
  return (
    <div className="m-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <h2 className="font-serif text-3xl">Open a PDF to redact</h2>
      <p className="text-base text-ink-muted">Drop a file here or choose one. It stays in this browser: nothing is uploaded.</p>
      <label htmlFor={FILE_INPUT_ID} className="mt-2 cursor-pointer rounded-md bg-ink px-4 py-2 text-paper hover:bg-ink/85">
        Choose a PDF
      </label>
    </div>
  );
}

function saveLabels(marks: readonly Mark[], facts: DocumentFacts, opened: OpenDocument) {
  const truth = groundTruth(marks, facts, opened.sha256);
  download(new Blob([JSON.stringify(truth, null, 2)], { type: "application/json" }), `${baseName(opened.name)}.truth.json`);
}

export function App() {
  const engine = useEngine();
  // Any change after apply drops the checked output: it no longer matches what is on screen.
  const marking = useMarks(engine.discardOutput);
  const { marks, pending } = marking;
  const [tool, setTool] = useState<Tool>("text");
  const [appearance, setAppearance] = useState<Appearance>({ colour: "#000000", label: false });
  const [currentPage, setCurrentPage] = useState<PageIndex | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [lastFacts, setLastFacts] = useState<DocumentFacts | undefined>(undefined);
  const [widths, setWidths] = useState(initialWidths);
  const { document: opened, output } = engine;
  const focus = useHandOffFocus(output !== undefined);
  const editing: Editing = {
    tool,
    onTool: setTool,
    appearance,
    onAppearance: changeAppearance,
    applyRef: focus.applyRef,
    hasMarks: marks.length > 0,
    busy: pending !== undefined || engine.state !== "ready",
    onApply: () => engine.apply(marks.flatMap(toEdits), appearance),
    onExportLabels: () => setExporting(true),
  };

  function openFile(picked: File) {
    marking.clear();
    setCurrentPage(undefined);
    void engine.open(picked);
  }

  function changeAppearance(next: Appearance) {
    engine.discardOutput();
    setAppearance(next);
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <TopBar
        labelling={labelling}
        fileName={opened?.name}
        status={statusText(engine, currentPage)}
        fileInputId={FILE_INPUT_ID}
        canOpen={engine.state === "ready"}
        onOpen={openFile}
        editing={opened !== undefined && output === undefined ? editing : undefined}
      />
      {exporting && opened !== undefined && (
        <LabelExport
          last={lastFacts}
          onExport={(facts) => {
            setLastFacts(facts);
            setExporting(false);
            saveLabels(marks, facts, opened);
          }}
          onClose={() => setExporting(false)}
        />
      )}
      {opened === undefined ? (
        <div className="grid">
          <DropZone error={engine.error} onFile={openFile}>
            <EmptyState />
          </DropZone>
        </div>
      ) : (
        <Workspace
          engine={engine}
          pages={(output ?? opened).model.pages}
          marks={marking}
          tool={tool}
          labelling={labelling}
          currentPage={currentPage}
          onCurrentPage={setCurrentPage}
          onFile={openFile}
          widths={widths}
          onWidths={setWidths}
          downloadRef={focus.downloadRef}
          onBack={() => {
            focus.backToEditing();
            engine.discardOutput();
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import type { PageIndex } from "../engine/model/geometry";
import { ApproveDialog } from "./ApproveDialog";
import { baseName, download } from "./download";
import { DocumentTabs, DOCUMENT_PANEL_ID, tabId } from "./DocumentTabs";
import { DropZone } from "./DropZone";
import { Explorer } from "./Explorer";
import type { DocumentFacts } from "../engine/model/groundTruth";
import { LabelExport } from "./LabelExport";
import type { Tool } from "./marks";
import { NotAdded } from "./NotAdded";
import type { DocumentId, Project, ProjectDocument, Settings } from "../engine/model/project";
import type { Refusal } from "../engine/api/errors";
import type { Session } from "../engine/api/facade";
import type { DocumentHandle, EngineState, SessionState } from "../engine/api/state";
import type { Appearance } from "../engine/model/document";
import { TopBar, type Editing, type History } from "./TopBar";
import { engineStatus } from "./engineStatus";
import { useDocumentInEngine } from "./useDocumentInEngine";
import type { useEngineError } from "./useEngineError";
import { useHandOffFocus } from "./useHandOffFocus";
import { useImages } from "./useImages";
import { incomingFiles } from "./incomingFiles";
import { useMarks } from "./useMarks";
import { errorText } from "./errors";
import { useTabs } from "./useTabs";
import { useUndoKeys } from "./useUndoKeys";
import { initialWidths, Workspace, type Review } from "./Workspace";

interface ProjectViewProps {
  readonly session: Session;
  /** The Session's part of the engine's state. */
  readonly opened: SessionState;
  /** Files that could not be added when the project was made, still to be shown. */
  readonly initialRefused: readonly Refusal[];
  readonly worker: EngineState["worker"];
  /** What went wrong with the PDF worker, which opening a document or applying clears. */
  readonly failure: ReturnType<typeof useEngineError>;
  readonly settings: Settings;
  readonly onAppearance: (appearance: Appearance) => void;
  readonly labelling: boolean;
  /** Why something outside this project failed, such as saving the settings. */
  readonly problem: string | undefined;
  readonly onClose: () => void;
}

interface Panels {
  readonly documents: boolean;
  readonly pages: boolean;
}

function statusText(worker: EngineState["worker"], shown: DocumentHandle | undefined, currentPage: PageIndex | undefined): string {
  if (worker.status !== "ready") return engineStatus(worker) ?? "";
  if (shown === undefined) return "";
  return `Page ${(currentPage ?? 0) + 1} of ${shown.pages.length}`;
}

function saveLabels(session: Session, document: ProjectDocument, facts: DocumentFacts) {
  const truth = session.labelling.exportGroundTruth(document.id, facts);
  if (truth.ok) download(new Blob([JSON.stringify(truth.value, null, 2)], { type: "application/json" }), `${baseName(document.file)}.truth.json`);
}

const panelButtons: readonly { readonly id: keyof Panels; readonly label: string; readonly icon: string }[] = [
  { id: "documents", label: "Documents", icon: "M4 3h8l4 4v10H4z M12 3v4h4" },
  { id: "pages", label: "Pages", icon: "M3 3h6v8H3z M11 3h6v8h-6z M3 13h6v4H3z M11 13h6v4h-6z" },
];

/** The thin strip at the far left that shows and hides the side panels, as in a code editor. */
function PanelStrip({ panels, onToggle }: { readonly panels: Panels; readonly onToggle: (id: keyof Panels) => void }) {
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-1.5 border-r border-rule bg-paper-sunk pt-2">
      {panelButtons.map((button) => (
        <button
          key={button.id}
          type="button"
          aria-label={button.label}
          title={button.label}
          aria-pressed={panels[button.id]}
          onClick={() => onToggle(button.id)}
          className="grid size-8 place-items-center rounded-md text-ink-muted hover:text-ink aria-pressed:bg-paper-raised aria-pressed:text-ink aria-pressed:shadow-[0_0_0_1px_var(--color-rule)]"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current stroke-[1.5]">
            <path d={button.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}

/** Why saving the project, approving, or something outside the project failed. */
function Alerts({ saveFailed, problems }: { readonly saveFailed: boolean; readonly problems: readonly (string | undefined)[] }) {
  return [saveFailed ? errorText({ code: "save-failed" }) : undefined, ...problems]
    .filter((message) => message !== undefined)
    .map((message) => (
      <p key={message} role="alert" className="m-4 mb-0 rounded-md border border-mark/40 bg-fail-wash px-3 py-2 text-mark">
        {message}
      </p>
    ));
}

/** The open document's place in the project's review, for the workspace. */
function reviewOf(session: Session, { project, reach, newFrom, documentStatus }: SessionState, document: ProjectDocument | undefined): Review {
  return {
    file: document?.file ?? "",
    hidden: project.hidden,
    reach,
    newFrom,
    approved: document?.review === "approved",
    lost: new Set(document && documentStatus.get(document.id)?.lost),
    onKeepHere: (mark) => {
      if (document !== undefined) session.marks.keepHere(document.id, mark.id);
    },
    onDownloaded: () => {
      if (document !== undefined) session.documents.markDownloaded(document.id);
    },
  };
}

const documentOf = (project: Project, id: DocumentId | undefined) => project.documents.find((document) => document.id === id);

/** Undo and redo on the tab's record, which need no document open. `waiting`: a mark waits for its type. */
const historyOf = (session: Session, can: SessionState["can"], active: DocumentId, waiting: boolean): History => ({
  canUndo: !waiting && can.undo.has(active),
  canRedo: !waiting && can.redo.has(active),
  onUndo: () => session.history.undo(active),
  onRedo: () => session.history.redo(active),
});

/** Marking the open document: its marks, undo and redo, approving, and the controls the top bar shows. */
function useEditing(
  { session, opened: { project, can, output }, onAppearance }: Pick<ProjectViewProps, "session" | "opened" | "onAppearance">,
  { active, shown }: { readonly active: DocumentId | undefined; readonly shown: DocumentHandle | undefined },
  settings: Settings,
  onFailure: ReturnType<typeof useEngineError>,
) {
  const [tool, setTool] = useState<Tool>("text");
  const [exporting, setExporting] = useState(false);
  const [lastFacts, setLastFacts] = useState<DocumentFacts | undefined>(undefined);
  const focus = useHandOffFocus(output !== undefined);
  const activeDocument = documentOf(project, active);
  const images = useImages(session, active);
  const marking = useMarks(session, shown, activeDocument?.marks ?? [], settings.customTypes);
  const waiting = marking.pending !== undefined;
  const busy = waiting || !can.apply || !can.approve;
  const history = active && historyOf(session, can, active, waiting);
  useUndoKeys(history);

  const editing: Editing = {
    tool,
    onTool: setTool,
    appearance: settings.appearance,
    onAppearance,
    applyRef: focus.applyRef,
    busy,
    onApply: () => {
      onFailure.clear();
      void session.output.apply().then((applied) => {
        if (!applied.ok) onFailure.failed(applied.error);
      });
    },
    review: activeDocument?.review ?? "not-started",
    onApprove: () => {
      if (active !== undefined) void session.approval.plan(active);
    },
    onExportLabels: () => setExporting(true),
  };
  /** Labelling mode's dialog, while it is open. */
  const labels = exporting && shown !== undefined && activeDocument !== undefined && (
    <LabelExport
      last={lastFacts}
      onExport={(facts) => {
        setLastFacts(facts);
        setExporting(false);
        saveLabels(session, activeDocument, facts);
      }}
      onClose={() => setExporting(false)}
    />
  );
  return { marking, history, editing, tool, focus, labels, images };
}

interface DocumentPanelProps extends Omit<Parameters<typeof Workspace>[0], "handle" | "currentPage" | "onCurrentPage"> {
  readonly active: DocumentId | undefined;
  readonly shown: DocumentHandle | undefined;
  readonly missing: string | undefined;
  readonly pageInView: PageInView | undefined;
  readonly onPageInView: (pageInView: PageInView) => void;
}

interface PageInView {
  readonly document: DocumentId;
  readonly page: PageIndex | undefined;
}

const pageOf = (pageInView: PageInView | undefined, active: DocumentId | undefined) =>
  pageInView !== undefined && pageInView.document === active ? pageInView.page : undefined;

/** The open tab's content: its pages and marks once the engine has it, or why it can't be shown. */
function DocumentPanel({ active, shown, missing, pageInView, onPageInView, ...workspace }: DocumentPanelProps) {
  return (
    <div
      id={DOCUMENT_PANEL_ID}
      role="tabpanel"
      aria-labelledby={active === undefined ? undefined : tabId(active)}
      className="flex min-h-0 min-w-0 flex-1"
    >
      {shown !== undefined && active !== undefined ? (
        <Workspace
          key={active}
          {...workspace}
          handle={shown}
          currentPage={pageOf(pageInView, active)}
          onCurrentPage={(page) => onPageInView({ document: active, page })}
        />
      ) : (
        <DropZone error={missing ?? errorText(workspace.error)} onFiles={workspace.onFiles}>
          {active === undefined && <p className="m-auto p-8 text-ink-muted">Open a document from the list, or drop PDFs here to add them.</p>}
        </DropZone>
      )}
    </div>
  );
}

/**
 * Adds chosen files to the project, and keeps the "files not added" notice: an add replaces it
 * with its own refusals, and one refused as a whole lists each file under the notice already shown.
 */
function useAddFiles(session: Session, initialRefused: readonly Refusal[], onAdded: (added: readonly DocumentId[]) => void) {
  const [refused, setRefused] = useState(initialRefused);
  function add(files: readonly File[]) {
    void session.documents.add(incomingFiles(files)).then((result) => {
      if (result.ok) {
        setRefused(result.value.refused);
        onAdded(result.value.added);
      } else if (errorText(result.error) !== undefined) {
        // A refusal the app shows no sentence for came from a control it had disabled.
        setRefused((current) => [...current, ...files.map(({ name }) => ({ file: name, error: result.error }))]);
      }
    });
  }
  return { refused, add, dismiss: () => setRefused([]) };
}

function openInTabs(tabs: ReturnType<typeof useTabs>, documents: readonly DocumentId[]) {
  for (const document of documents) tabs.open(document);
  const [first] = documents;
  if (first !== undefined) tabs.open(first);
}

/** Saves every change so far when the page is left. */
function useFlushOnLeave(session: Session) {
  useEffect(() => {
    const flush = () => void session.flush();
    addEventListener("pagehide", flush);
    return () => {
      removeEventListener("pagehide", flush);
      flush();
    };
  }, [session]);
}

/** An open project: its documents in the explorer and tabs, the open document's pages and marks. */
export function ProjectView(props: ProjectViewProps) {
  const { session, worker, failure, settings, labelling, onClose } = props;
  const { project, output, save, can } = props.opened;
  useFlushOnLeave(session);
  const tabs = useTabs(project.id, project.documents);
  const { active } = tabs;
  const activeDocument = documentOf(project, active);
  const { shown, missing } = useDocumentInEngine(session, props.opened.open, activeDocument, can.switchDocument, failure);
  const adder = useAddFiles(session, props.initialRefused, (added) => openInTabs(tabs, added));
  const { marking, history, editing, tool, focus, labels, images } = useEditing(props, { active, shown }, settings, failure);
  const [panels, setPanels] = useState<Panels>({ documents: true, pages: false });
  const [pageInView, setPageInView] = useState<PageInView | undefined>(undefined);
  const [widths, setWidths] = useState(initialWidths);
  const byId = new Map(project.documents.map((document) => [document.id, document]));
  const openDocuments = tabs.tabs.flatMap((id) => byId.get(id) ?? []);

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
      <TopBar
        labelling={labelling}
        projectName={project.name}
        onProjects={onClose}
        saveState={save}
        status={statusText(worker, shown, pageOf(pageInView, active))}
        canAdd={can.add}
        onAdd={adder.add}
        history={history}
        editing={shown !== undefined && output === undefined ? editing : undefined}
      />
      {labels}
      <ApproveDialog session={session} approval={props.opened.approval} documents={project.documents} />
      <div className="flex min-h-0">
        <PanelStrip panels={panels} onToggle={(id) => setPanels((current) => ({ ...current, [id]: !current[id] }))} />
        {panels.documents && <Explorer documents={project.documents} active={active} canOpen={can.switchDocument} onOpen={tabs.open} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Alerts saveFailed={save === "failed"} problems={[props.problem]} />
          <NotAdded refused={adder.refused} onDismiss={adder.dismiss} />
          <DocumentTabs documents={openDocuments} active={active} canSwitch={can.switchDocument} onSelect={tabs.open} onClose={tabs.close} />
          <DocumentPanel
            active={active}
            shown={shown}
            missing={missing}
            pageInView={pageInView}
            onPageInView={setPageInView}
            session={session}
            output={output}
            ready={worker.status === "ready"}
            canMark={can.mark}
            error={failure.error}
            onFailure={failure.failed}
            onDismissError={failure.clear}
            marks={marking}
            review={reviewOf(session, props.opened, activeDocument)}
            images={images}
            tool={tool}
            labelling={labelling}
            onFiles={adder.add}
            showPages={panels.pages}
            widths={widths}
            onWidths={setWidths}
            downloadRef={focus.downloadRef}
            onBack={() => {
              focus.backToEditing();
              session.output.discard();
            }}
          />
        </div>
      </div>
    </div>
  );
}

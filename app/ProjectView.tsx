import { useEffect, useImperativeHandle, useState, type Ref } from "react";
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
import type { Engine, Session } from "../engine/api/facade";
import type { DocumentHandle, EngineState, SessionState } from "../engine/api/state";
import type { Interim } from "../engine/host-browser/interim";
import type { Appearance } from "../engine/model/document";
import type { Store } from "../engine/storage/store";
import { TopBar, type Editing, type History } from "./TopBar";
import { engineStatus } from "./engineStatus";
import { useAddDocuments } from "./useAddDocuments";
import { useApproval } from "./useApproval";
import { useDocumentInEngine } from "./useDocumentInEngine";
import { useEngineError } from "./useEngineError";
import { useHandOffFocus } from "./useHandOffFocus";
import { useImages } from "./useImages";
import { useMarks } from "./useMarks";
import { useProject } from "./useProject";
import { errorText } from "./errors";
import { useTabs } from "./useTabs";
import { useUndoKeys } from "./useUndoKeys";
import { initialWidths, Workspace, type Review } from "./Workspace";

/** What the app asks of the open project before leaving it. */
export interface ProjectHandle {
  /** Resolves once no add or approval is under way, so each lands in the project before it closes. */
  settled(): Promise<void>;
}

interface ProjectViewProps {
  readonly ref: Ref<ProjectHandle>;
  readonly facade: Engine;
  readonly session: Session;
  /** The Session's part of the engine's state. */
  readonly opened: SessionState;
  readonly interim: Interim;
  readonly store: Store;
  /** Files that could not be added when the project was made, still to be shown. */
  readonly initialRefused: readonly Refusal[];
  readonly worker: EngineState["worker"];
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
function reviewOf(session: Session, { project, reach, newFrom }: SessionState, document: ProjectDocument | undefined): Review {
  return {
    file: document?.file ?? "",
    hidden: project.hidden,
    reach,
    newFrom,
    approved: document?.review === "approved",
    onKeepHere: (mark) => {
      if (document !== undefined) session.marks.keepHere(document.id, mark.id);
    },
    onDownloaded: () => {
      if (document !== undefined) session.documents.markDownloaded(document.id);
    },
  };
}

const documentOf = (project: Project, id: DocumentId | undefined) => project.documents.find((document) => document.id === id);

/** Marking the open document: its marks, undo and redo, approving, and the controls the top bar shows. */
function useEditing(
  { session, interim, store, opened: { can, output }, onAppearance }: Pick<ProjectViewProps, "session" | "interim" | "store" | "opened" | "onAppearance">,
  opened: ReturnType<typeof useProject>,
  { active, shown }: { readonly active: DocumentId | undefined; readonly shown: DocumentHandle | undefined },
  settings: Settings,
  { adding, onFailure }: { readonly adding: boolean; readonly onFailure: ReturnType<typeof useEngineError> },
) {
  const approval = useApproval(interim.readings, store, opened);
  const [tool, setTool] = useState<Tool>("text");
  const [exporting, setExporting] = useState(false);
  const [lastFacts, setLastFacts] = useState<DocumentFacts | undefined>(undefined);
  const focus = useHandOffFocus(output !== undefined);
  const activeDocument = documentOf(opened.project, active);
  const images = useImages(session, active);
  const marking = useMarks(session, shown, activeDocument?.marks ?? [], settings.customTypes);
  // Adding and approving each change the whole project, so Approve waits for an add.
  const busy = marking.pending !== undefined || !can.apply || approval.working || approval.asking !== undefined || adding;
  const history: History | undefined = active && {
    // The state's flags are for the open document, which is the tab's once it is shown.
    canUndo: !busy && shown !== undefined && can.undo,
    canRedo: !busy && shown !== undefined && can.redo,
    onUndo: () => session.history.undo(active),
    onRedo: () => session.history.redo(active),
  };
  useUndoKeys(history);

  const editing: Editing = {
    tool,
    onTool: setTool,
    appearance: settings.appearance,
    onAppearance,
    applyRef: focus.applyRef,
    hasMarks: marking.marks.length > 0,
    busy,
    onApply: () => {
      onFailure.clear();
      void session.output.apply().then((applied) => {
        if (!applied.ok) onFailure.failed(applied.error);
      });
    },
    review: activeDocument?.review ?? "not-started",
    onApprove: () => {
      if (active !== undefined) approval.start(active);
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
  return { marking, history, editing, tool, focus, labels, approval, images };
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

const addingUnless = (approving: boolean, adder: ReturnType<typeof useAddDocuments>) => (files: readonly File[]) =>
  approving ? adder.refuse(files, "add-while-approving") : adder.add(files);

/** What may start now. Adding and approving each change the whole project, so neither starts while the other runs. */
function allowed({ worker, opened }: Pick<ProjectViewProps, "worker" | "opened">, adding: boolean, approving: boolean) {
  const quiet = !adding && !approving;
  return { canAdd: quiet && worker.status !== "stopped", canSwitch: opened.can.switchDocument && quiet };
}

function openInTabs(tabs: ReturnType<typeof useTabs>, documents: readonly ProjectDocument[]) {
  for (const document of documents) tabs.open(document.id);
  const [first] = documents;
  if (first !== undefined) tabs.open(first.id);
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
  const { session, interim, store, worker, settings, labelling, onClose } = props;
  const { output, save } = props.opened;
  const opened = useProject(props.facade, session, props.opened, interim);
  useFlushOnLeave(session);
  const failure = useEngineError(worker);
  const { project } = opened;
  const tabs = useTabs(project.id, project.documents);
  const { active } = tabs;
  const activeDocument = documentOf(project, active);
  const { shown, missing } = useDocumentInEngine(session, props.opened.open, activeDocument, props.opened.can.switchDocument, failure);
  const adder = useAddDocuments(interim, store, { folder: opened.folder, project }, worker.status === "stopped", props.initialRefused, (documents) => {
    opened.addDocuments(documents);
    openInTabs(tabs, documents);
  });
  const { marking, history, editing, tool, focus, labels, approval, images } = useEditing(props, opened, { active, shown }, settings, {
    adding: adder.adding,
    onFailure: failure,
  });
  // Leaving waits for an add or an approval under way: it lands in the project before it is saved and let go.
  useImperativeHandle(props.ref, () => ({ settled: () => adder.settled().then(approval.settled) }));
  const [panels, setPanels] = useState<Panels>({ documents: true, pages: false });
  const [pageInView, setPageInView] = useState<PageInView | undefined>(undefined);
  const [widths, setWidths] = useState(initialWidths);
  const addFiles = addingUnless(approval.working, adder);
  const { canAdd, canSwitch } = allowed(props, adder.adding, approval.working);
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
        canAdd={canAdd}
        onAdd={addFiles}
        history={history}
        editing={shown !== undefined && output === undefined ? editing : undefined}
      />
      {labels}
      <ApproveDialog approval={approval.asking} documents={project.documents} onApprove={approval.confirm} onCancel={approval.cancel} />
      <div className="flex min-h-0">
        <PanelStrip panels={panels} onToggle={(id) => setPanels((current) => ({ ...current, [id]: !current[id] }))} />
        {panels.documents && <Explorer documents={project.documents} active={active} canOpen={canSwitch} onOpen={tabs.open} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Alerts saveFailed={save === "failed"} problems={[approval.problem, props.problem]} />
          <NotAdded refused={adder.refused} onDismiss={adder.dismiss} />
          <DocumentTabs documents={openDocuments} active={active} canSwitch={canSwitch} onSelect={tabs.open} onClose={tabs.close} />
          <DocumentPanel
            active={active}
            shown={shown}
            missing={missing}
            pageInView={pageInView}
            onPageInView={setPageInView}
            session={session}
            output={output}
            ready={worker.status === "ready"}
            error={failure.error}
            onFailure={failure.failed}
            marks={marking}
            review={reviewOf(session, props.opened, activeDocument)}
            images={images}
            tool={tool}
            labelling={labelling}
            onFiles={addFiles}
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

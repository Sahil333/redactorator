import { useImperativeHandle, useState, type Ref } from "react";
import type { PageIndex } from "../engine/model/geometry";
import { ApproveDialog } from "./ApproveDialog";
import { baseName, download } from "./download";
import { DocumentTabs, DOCUMENT_PANEL_ID, tabId } from "./DocumentTabs";
import { DropZone } from "./DropZone";
import { Explorer } from "./Explorer";
import { groundTruth, type DocumentFacts } from "../engine/model/groundTruth";
import type { Refusal } from "./importFiles";
import { LabelExport } from "./LabelExport";
import { itemKey, markKey, toEdits, type Mark } from "../engine/model/marks";
import type { Tool } from "./marks";
import { NotAdded } from "./NotAdded";
import type { DocumentId, Project, ProjectDocument, Settings } from "../engine/model/project";
import type { StoredProject } from "./projects";
import { newFrom, reachOf } from "../engine/model/spread";
import type { Store } from "../engine/storage/store";
import { TopBar, type Editing, type History } from "./TopBar";
import { engineStatus, type Engine, type OpenDocument } from "./useEngine";
import { useAddDocuments } from "./useAddDocuments";
import { useApproval } from "./useApproval";
import { useDocumentInEngine } from "./useDocumentInEngine";
import { useHandOffFocus } from "./useHandOffFocus";
import { useImages } from "./useImages";
import { useMarks } from "./useMarks";
import { useProject } from "./useProject";
import { useTabs } from "./useTabs";
import { useUndoKeys } from "./useUndoKeys";
import { initialWidths, Workspace, type Review } from "./Workspace";

/** What the app asks of the open project before leaving it. */
export interface ProjectHandle {
  /** Saves every change so far: true once they all landed. */
  save(): Promise<boolean>;
}

interface ProjectViewProps {
  readonly ref: Ref<ProjectHandle>;
  readonly store: Store;
  readonly initial: StoredProject;
  /** Files that could not be added when the project was made, still to be shown. */
  readonly initialRefused: readonly Refusal[];
  readonly engine: Engine;
  readonly settings: Settings;
  readonly onSettings: (settings: Settings) => void;
  readonly labelling: boolean;
  /** Why something outside this project failed, such as saving the settings. */
  readonly problem: string | undefined;
  readonly onClose: () => void;
}

interface Panels {
  readonly documents: boolean;
  readonly pages: boolean;
}

function statusText(engine: Engine, shown: OpenDocument | undefined, currentPage: PageIndex | undefined): string {
  if (engine.state !== "ready") return engineStatus(engine) ?? "";
  if (shown === undefined) return "";
  return `Page ${(currentPage ?? 0) + 1} of ${shown.model.pages.length}`;
}

function saveLabels(marks: readonly Mark[], facts: DocumentFacts, shown: OpenDocument) {
  const truth = groundTruth(marks, facts, shown.sha256);
  download(new Blob([JSON.stringify(truth, null, 2)], { type: "application/json" }), `${baseName(shown.name)}.truth.json`);
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

const WAIT_FOR_APPROVAL = "This file wasn't added while a document was being approved. Add it again once the approval is done.";

const SAVE_FAILED = "Your latest changes could not be saved. Check that the disk has space; the next change tries again.";

/** Why saving the project, approving, or something outside the project failed. */
function Alerts({ saveFailed, problems }: { readonly saveFailed: boolean; readonly problems: readonly (string | undefined)[] }) {
  return [saveFailed ? SAVE_FAILED : undefined, ...problems]
    .filter((message) => message !== undefined)
    .map((message) => (
      <p key={message} role="alert" className="m-4 mb-0 rounded-md border border-mark/40 bg-fail-wash px-3 py-2 text-mark">
        {message}
      </p>
    ));
}

/** The open document's place in the project's review, for the workspace. */
function reviewOf(opened: ReturnType<typeof useProject>, document: ProjectDocument | undefined, engine: Engine): Review {
  const { project } = opened;
  return {
    hidden: project.hidden,
    reach: reachOf(project),
    newFrom: document === undefined ? [] : newFrom(project, document),
    approved: document?.review === "approved",
    onKeepHere: (mark) => {
      const key = markKey(mark);
      if (document === undefined || key === undefined) return;
      engine.discardOutput();
      opened.edit(document.id, ({ marks, shown }) => ({ marks: marks.filter((each) => itemKey(each) !== key), shown: [...shown, key] }), "edit");
    },
    onDownloaded: () => {
      if (document !== undefined) opened.downloaded(document.id);
    },
  };
}

const documentOf = (project: Project, id: DocumentId | undefined) => project.documents.find((document) => document.id === id);

/** Marking the open document: its marks, undo and redo, approving, and the controls the top bar shows. */
function useEditing(
  store: Store,
  engine: Engine,
  opened: ReturnType<typeof useProject>,
  active: DocumentId | undefined,
  settings: Settings,
  onSettings: (settings: Settings) => void,
  adding: boolean,
) {
  const approval = useApproval(store, opened, engine);
  const [tool, setTool] = useState<Tool>("text");
  const [exporting, setExporting] = useState(false);
  const [lastFacts, setLastFacts] = useState<DocumentFacts | undefined>(undefined);
  const focus = useHandOffFocus(engine.output !== undefined);
  const activeDocument = documentOf(opened.project, active);
  const images = useImages(store, opened.folder, activeDocument, engine);
  const marking = useMarks(
    active,
    activeDocument?.marks ?? [],
    (update, kind) => {
      if (active === undefined) return;
      if (kind === "edit") engine.discardOutput();
      opened.edit(active, ({ marks, shown }) => ({ marks: update(marks), shown }), kind);
    },
    settings.customTypes,
    (name) => onSettings({ ...settings, customTypes: [...settings.customTypes, name] }),
  );
  // Adding and approving each change the whole project, so Approve waits for an add.
  const busy = marking.pending !== undefined || engine.state !== "ready" || approval.working || approval.asking !== undefined || adding;
  const step = (direction: "undo" | "redo") => () => {
    if (active === undefined) return;
    engine.discardOutput();
    opened[direction](active);
  };
  const history: History | undefined = active && {
    canUndo: !busy && opened.canUndo(active),
    canRedo: !busy && opened.canRedo(active),
    onUndo: step("undo"),
    onRedo: step("redo"),
  };
  useUndoKeys(history);

  const editing: Editing = {
    tool,
    onTool: setTool,
    appearance: settings.appearance,
    onAppearance: (appearance) => {
      engine.discardOutput();
      onSettings({ ...settings, appearance });
    },
    applyRef: focus.applyRef,
    hasMarks: marking.marks.length > 0,
    busy,
    onApply: () => engine.apply(marking.marks.flatMap(toEdits), settings.appearance),
    review: activeDocument?.review ?? "not-started",
    onApprove: () => {
      if (active !== undefined) approval.start(active);
    },
    onExportLabels: () => setExporting(true),
  };
  /** Labelling mode's dialog, while it is open. */
  const labels = (shown: OpenDocument | undefined) =>
    exporting &&
    shown !== undefined && (
      <LabelExport
        last={lastFacts}
        onExport={(facts) => {
          setLastFacts(facts);
          setExporting(false);
          saveLabels(marking.marks, facts, shown);
        }}
        onClose={() => setExporting(false)}
      />
    );
  return { marking, history, editing, tool, focus, labels, approval, images };
}

interface DocumentPanelProps extends Omit<Parameters<typeof Workspace>[0], "pages" | "currentPage" | "onCurrentPage"> {
  readonly active: DocumentId | undefined;
  readonly shown: OpenDocument | undefined;
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
          pages={(workspace.engine.output ?? shown).model.pages}
          currentPage={pageOf(pageInView, active)}
          onCurrentPage={(page) => onPageInView({ document: active, page })}
        />
      ) : (
        <DropZone error={missing ?? workspace.engine.error} onFiles={workspace.onFiles}>
          {active === undefined && <p className="m-auto p-8 text-ink-muted">Open a document from the list, or drop PDFs here to add them.</p>}
        </DropZone>
      )}
    </div>
  );
}

const addingUnless = (approving: boolean, adder: ReturnType<typeof useAddDocuments>) => (files: readonly File[]) =>
  approving ? adder.refuse(files, WAIT_FOR_APPROVAL) : adder.add(files);

function openInTabs(tabs: ReturnType<typeof useTabs>, documents: readonly ProjectDocument[]) {
  for (const document of documents) tabs.open(document.id);
  const [first] = documents;
  if (first !== undefined) tabs.open(first.id);
}

/** An open project: its documents in the explorer and tabs, the open document's pages and marks. */
export function ProjectView(props: ProjectViewProps) {
  const { store, initial, engine, settings, labelling, onClose } = props;
  const opened = useProject(store, initial);
  const { project } = opened;
  const tabs = useTabs(project.id, project.documents);
  const { active } = tabs;
  const activeDocument = documentOf(project, active);
  const { shown, missing } = useDocumentInEngine(store, opened.folder, activeDocument, engine);
  const adder = useAddDocuments(store, { folder: opened.folder, project }, engine, props.initialRefused, (documents) => {
    opened.addDocuments(documents);
    openInTabs(tabs, documents);
  });
  const { marking, history, editing, tool, focus, labels, approval, images } = useEditing(store, engine, opened, active, settings, props.onSettings, adder.adding);
  // Leaving waits for an add or an approval under way: it lands in the project before it is saved and let go.
  useImperativeHandle(props.ref, () => ({ save: () => adder.settled().then(approval.settled).then(opened.save) }));
  const [panels, setPanels] = useState<Panels>({ documents: true, pages: false });
  const [pageInView, setPageInView] = useState<PageInView | undefined>(undefined);
  const [widths, setWidths] = useState(initialWidths);
  // Adding and approving each change the whole project, so neither starts while the other runs.
  const quiet = !adder.adding && !approval.working;
  const addFiles = addingUnless(approval.working, adder);
  const canSwitch = engine.state !== "applying" && quiet;
  const byId = new Map(project.documents.map((document) => [document.id, document]));
  const openDocuments = tabs.tabs.flatMap((id) => byId.get(id) ?? []);

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
      <TopBar
        labelling={labelling}
        projectName={project.name}
        onProjects={onClose}
        saveState={opened.saveState}
        status={statusText(engine, shown, pageOf(pageInView, active))}
        canAdd={quiet && engine.state !== "stopped"}
        onAdd={addFiles}
        history={history}
        editing={shown !== undefined && engine.output === undefined ? editing : undefined}
      />
      {labels(shown)}
      <ApproveDialog approval={approval.asking} documents={project.documents} onApprove={approval.confirm} onCancel={approval.cancel} />
      <div className="flex min-h-0">
        <PanelStrip panels={panels} onToggle={(id) => setPanels((current) => ({ ...current, [id]: !current[id] }))} />
        {panels.documents && <Explorer documents={project.documents} active={active} canOpen={canSwitch} onOpen={tabs.open} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Alerts saveFailed={opened.saveState === "failed"} problems={[approval.problem, props.problem]} />
          <NotAdded refused={adder.refused} onDismiss={adder.dismiss} />
          <DocumentTabs documents={openDocuments} active={active} canSwitch={canSwitch} onSelect={tabs.open} onClose={tabs.close} />
          <DocumentPanel
            active={active}
            shown={shown}
            missing={missing}
            pageInView={pageInView}
            onPageInView={setPageInView}
            engine={engine}
            marks={marking}
            review={reviewOf(opened, activeDocument, engine)}
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
              engine.discardOutput();
            }}
          />
        </div>
      </div>
    </div>
  );
}

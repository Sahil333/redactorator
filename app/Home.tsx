import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DropZone } from "./DropZone";
import type { Refusal } from "./importFiles";
import { NotAdded } from "./NotAdded";
import { PickFiles } from "./PickFiles";
import type { ProjectEntries, StoredProject, UnreadableProject } from "./projects";

interface ProjectActions {
  readonly onOpen: (stored: StoredProject) => void;
  readonly onRename: (stored: StoredProject, name: string) => void;
  readonly onDuplicate: (stored: StoredProject) => void;
  readonly onArchive: (stored: StoredProject, archived: boolean) => void;
  readonly onDelete: (stored: StoredProject) => void;
}

interface HomeProps extends ProjectActions {
  /** Undefined until the projects have been read. */
  readonly projects: ProjectEntries | undefined;
  /** Whether new files can be taken: the engine is ready and nothing else is being added. */
  readonly canAdd: boolean;
  readonly status: string;
  readonly error: string | undefined;
  readonly refused: readonly Refusal[];
  readonly onDismissRefused: () => void;
  readonly onFiles: (files: readonly File[]) => void;
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

const markCount = ({ project }: StoredProject) => project.documents.reduce((sum, document) => sum + document.marks.length, 0);

const approvedCount = ({ project }: StoredProject) => project.documents.filter((document) => document.review === "approved").length;

const problemText: Record<UnreadableProject["problem"], string> = {
  damaged: "Its project file is damaged, so it can't be opened. Start a new project with its documents.",
  newer: "It was saved by a newer version of Redactorator. Reload the page to open it.",
};

const button = "rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk";
// A file input is hidden inside its label, so the label shows its focus.
const pickFocus = "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent";
const darkButton = `cursor-pointer rounded-md bg-ink text-paper hover:bg-ink/85 has-disabled:cursor-not-allowed has-disabled:opacity-50 ${pickFocus}`;

const steps: readonly { readonly title: string; readonly text: string; readonly marked: number }[] = [
  { title: "Add related documents", text: "A client file, a case, a study. Add them all at once.", marked: 0 },
  { title: "Hide a name once", text: "Select it in any document and say what it is.", marked: 1 },
  { title: "It's hidden everywhere", text: "In every document of the project, and in any you add later.", marked: 3 },
];

function Steps() {
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="flex flex-col gap-2 rounded-lg border border-rule bg-paper-raised p-4">
          <span aria-hidden="true" className="flex gap-1.5">
            {[0, 1, 2].map((sheet) => (
              <span key={sheet} className="relative block h-11 w-8 border border-rule bg-white">
                <span className={`absolute top-3.5 left-1 h-[3px] w-4 ${sheet < step.marked ? "bg-ink" : "bg-rule"}`} />
              </span>
            ))}
          </span>
          <span className="font-display font-semibold text-base">
            {index + 1} · {step.title}
          </span>
          <span className="text-ink-muted">{step.text}</span>
        </li>
      ))}
    </ol>
  );
}

function EmptyHome({ canAdd, onFiles }: Pick<HomeProps, "canAdd" | "onFiles">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <h2 className="font-display font-semibold text-3xl text-balance">Hide personal data across a whole project</h2>
      <Steps />
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-field bg-paper-raised p-8 text-center">
        <p className="font-display font-semibold text-xl">Drop PDFs here to start a project</p>
        <div className="flex flex-wrap justify-center gap-2">
          <PickFiles label="Choose PDFs" disabled={!canAdd} className={`${darkButton} px-4 py-2`} onFiles={onFiles} />
          <PickFiles label="Choose a folder" folder disabled={!canAdd} className={`${button} cursor-pointer has-disabled:opacity-50 ${pickFocus}`} onFiles={onFiles} />
        </div>
        <p className="text-ink-muted">Kept in this browser only. Nothing is uploaded.</p>
      </div>
    </div>
  );
}

const menuSteps: Partial<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

/** A row's ⋯ button and its menu. Arrow keys move through the items; Escape or a click outside closes it. */
function RowMenu({ name, children }: { readonly name: string; readonly children: ReactNode }) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = menuSteps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.findIndex((item) => item === document.activeElement);
    items.at((at + step) % items.length)?.focus();
  }

  return (
    <>
      <button
        type="button"
        popoverTarget={menuId}
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-paper-sunk hover:text-ink"
      >
        ⋯
      </button>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label={`Actions for ${name}`}
        onToggle={(event) => {
          if (event.newState === "open") menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        }}
        onKeyDown={onKeyDown}
        onClick={() => menuRef.current?.hidePopover()}
        className="row-menu min-w-40 rounded-md border border-rule bg-paper-raised p-1 text-ink shadow-[0_4px_16px_rgb(31_27_22/0.16)]"
      >
        {children}
      </div>
    </>
  );
}

function MenuItem({ label, onSelect }: { readonly label: string; readonly onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onSelect} className="block w-full rounded px-3 py-1.5 text-left hover:bg-paper-sunk focus:bg-paper-sunk">
      {label}
    </button>
  );
}

function RenameField({ name, onDone }: { readonly name: string; readonly onDone: (name: string | undefined) => void }) {
  const [value, setValue] = useState(name);
  return (
    <input
      aria-label="Project name"
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onDone(value.trim() === "" ? undefined : value.trim());
        if (event.key === "Escape") onDone(undefined);
      }}
      onBlur={() => onDone(undefined)}
      className="h-8 w-full rounded border border-field bg-white px-2 font-display font-semibold text-base"
    />
  );
}

function ProjectRow({ stored, actions }: { readonly stored: StoredProject; readonly actions: ProjectActions }) {
  const [renaming, setRenaming] = useState(false);
  const { project } = stored;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-4 border-t border-rule px-4 py-2.5 first:border-t-0">
      {renaming ? (
        <RenameField
          name={project.name}
          onDone={(name) => {
            setRenaming(false);
            if (name !== undefined && name !== project.name) actions.onRename(stored, name);
          }}
        />
      ) : (
        <button type="button" onClick={() => actions.onOpen(stored)} className="min-h-6 truncate text-left font-display font-semibold text-base hover:underline">
          {project.name}
        </button>
      )}
      <span className="text-ink-muted">{plural(project.documents.length, "document")}</span>
      <span className="text-ink-muted">{plural(markCount(stored), "mark")}</span>
      <span className="text-ink-muted">
        {approvedCount(stored)} of {project.documents.length} approved
      </span>
      <RowMenu name={project.name}>
        <MenuItem label="Rename" onSelect={() => setRenaming(true)} />
        <MenuItem label="Duplicate" onSelect={() => actions.onDuplicate(stored)} />
        <MenuItem label={project.archived ? "Unarchive" : "Archive"} onSelect={() => actions.onArchive(stored, !project.archived)} />
        <MenuItem label="Delete" onSelect={() => actions.onDelete(stored)} />
      </RowMenu>
    </li>
  );
}

function UnreadableRow({ entry }: { readonly entry: UnreadableProject }) {
  return (
    <li className="flex flex-col border-t border-rule px-4 py-2.5 first:border-t-0">
      <span className="font-display font-semibold text-base">{entry.folder}</span>
      <span className="text-mark">{problemText[entry.problem]}</span>
    </li>
  );
}

const byName = (a: StoredProject, b: StoredProject) => a.project.name.localeCompare(b.project.name);

/** The projects in use and the archived ones, each by name, and those that can't be read. */
function sortEntries(projects: ProjectEntries) {
  const current: StoredProject[] = [];
  const archived: StoredProject[] = [];
  const unreadable: UnreadableProject[] = [];
  for (const entry of projects) {
    if ("problem" in entry) unreadable.push(entry);
    else (entry.project.archived ? archived : current).push(entry);
  }
  return { current: current.toSorted(byName), archived: archived.toSorted(byName), unreadable };
}

function ProjectList({ projects, actions }: { readonly projects: ProjectEntries; readonly actions: ProjectActions }) {
  const { current, archived, unreadable } = sortEntries(projects);
  const list = "overflow-hidden rounded-lg border border-rule bg-paper-raised";
  return (
    <>
      {(current.length > 0 || unreadable.length > 0) && (
        <ul className={list}>
          {current.map((stored) => (
            <ProjectRow key={stored.folder} stored={stored} actions={actions} />
          ))}
          {unreadable.map((entry) => (
            <UnreadableRow key={entry.folder} entry={entry} />
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer text-ink-muted">Archived ({archived.length})</summary>
          <ul className={`${list} mt-2`}>
            {archived.map((stored) => (
              <ProjectRow key={stored.folder} stored={stored} actions={actions} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** Asks before a project is deleted for good. */
function DeleteDialog({ stored, onDelete, onClose }: {
  readonly stored: StoredProject;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[26rem] rounded-lg border border-rule bg-paper-raised p-5 text-ink shadow-[0_8px_32px_rgb(31_27_22/0.24)] backdrop:bg-ink/30"
    >
      <div className="flex flex-col gap-3">
        <h2 id={titleId} className="font-display font-semibold text-lg wrap-anywhere">
          Delete “{stored.project.name}”?
        </h2>
        <p>This can't be undone.</p>
        <div className="flex justify-end gap-2">
          <button type="button" autoFocus onClick={() => dialogRef.current?.close()} className={button}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete();
              dialogRef.current?.close();
            }}
            className="rounded-md bg-mark px-3.5 py-1.5 text-white hover:bg-mark/85"
          >
            Delete project
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function Home(props: HomeProps) {
  const { projects, canAdd, status, error, refused, onDismissRefused, onFiles } = props;
  const empty = projects !== undefined && projects.length === 0;
  const [deleting, setDeleting] = useState<StoredProject | undefined>(undefined);
  const actions: ProjectActions = { ...props, onDelete: setDeleting };
  return (
    <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-paper-raised px-4 py-2.5">
        <h1 className="font-display font-semibold text-xl tracking-tight">Redactorator</h1>
        <p role="status" className="text-ink-muted">
          {status}
        </p>
        <div className="flex-1" />
        {projects !== undefined && !empty && (
          <PickFiles label="New project" disabled={!canAdd} className={`${darkButton} px-3.5 py-1.5`} onFiles={onFiles} />
        )}
      </header>
      <DropZone error={error} onFiles={onFiles}>
        <NotAdded refused={refused} onDismiss={onDismissRefused} />
        {empty && <EmptyHome canAdd={canAdd} onFiles={onFiles} />}
        {projects !== undefined && !empty && (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-8">
            <h2 className="font-display font-semibold text-2xl">Projects</h2>
            <ProjectList projects={projects} actions={actions} />
            <p className="text-ink-muted">
              Projects are kept in this browser on this device. Clearing this site's data in the browser deletes them.
            </p>
          </div>
        )}
      </DropZone>
      {deleting && <DeleteDialog stored={deleting} onDelete={() => props.onDelete(deleting)} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}

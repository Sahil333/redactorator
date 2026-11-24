import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Refusal } from "../engine/api/errors";
import type { LibraryState, ProjectSummary } from "../engine/api/state";
import { DropZone } from "./DropZone";
import { NotAdded } from "./NotAdded";
import { PickFiles } from "./PickFiles";
import type { Waiting } from "./useProjectsFolder";

/** A project on the list that can be read. */
type Listed = Extract<ProjectSummary, { readonly id: string }>;

type Unreadable = Extract<ProjectSummary, { readonly unreadable: string }>;

interface ProjectActions {
  readonly onOpen: (listed: Listed) => void;
  readonly onRename: (listed: Listed, name: string) => void;
  readonly onDuplicate: (listed: Listed) => void;
  readonly onArchive: (listed: Listed, archived: boolean) => void;
  readonly onDelete: (listed: Listed) => void;
}

interface HomeProps extends ProjectActions {
  /** The engine's Library; undefined until the engine starts. */
  readonly library: LibraryState | undefined;
  /** The remembered folder, when the page can't use it until the user acts. */
  readonly waiting: Waiting | undefined;
  readonly status: string;
  readonly error: string | undefined;
  readonly refused: readonly Refusal[];
  readonly onDismissRefused: () => void;
  readonly onFiles: (files: readonly File[]) => void;
  /** Whether the user put off moving the projects into a folder, on this visit. */
  readonly later: boolean;
  readonly folder: FolderActions;
}

/** Where the projects are kept, as Home tells the user. */
type Whereabouts =
  | { readonly kind: "browser" }
  /** In the picked folder; or, before that, moving the projects into it or opening it again. */
  | { readonly kind: "moving" | "opening" | "folder"; readonly name: string }
  | Waiting;

function whereabouts(library: LibraryState | undefined, waiting: Waiting | undefined): Whereabouts | undefined {
  if (waiting !== undefined || library === undefined) return waiting;
  const { place, phase } = library;
  if (place.kind === "none") return undefined;
  if (place.kind === "folder" && (phase === "moving" || phase === "opening")) return { kind: phase, name: place.name };
  return place;
}

interface FolderActions {
  readonly onChoose: () => void;
  readonly onReopen: () => void;
  readonly onLater: () => void;
  /** Copies in a project folder, say one from another computer. */
  readonly onImport: () => void;
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

const problemText: Record<Unreadable["unreadable"], string> = {
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

const card = "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-accent/25 bg-accent-wash px-4 py-3";

/** Where the projects are kept, when that asks something of the user: a folder to pick, or Chrome's permission again. */
function FolderCard({ where, later, folder, canChoose }: { readonly where: Whereabouts | undefined; readonly canChoose: boolean } & Pick<HomeProps, "later" | "folder">) {
  if (where === undefined || where.kind === "folder" || (where.kind === "browser" && later)) return null;
  if (where.kind === "moving" || where.kind === "opening") {
    return (
      <p role="status" className={card}>
        {where.kind === "moving" ? `Moving your projects into “${where.name}”…` : `Opening “${where.name}”…`}
      </p>
    );
  }
  const name = where.kind === "browser" ? "" : where.name;
  const { title, text, action, onAction } = {
    browser: {
      title: "Keep your projects in a folder on this computer",
      text: "Right now they live inside Chrome, which can delete them when you clear site data. In a folder, they are ordinary files you can see, copy and back up.",
      action: "Choose a folder for projects",
      onAction: folder.onChoose,
    },
    reopen: {
      title: "Reopen your projects folder",
      text: `Your projects are in “${name}”. Chrome asks again before this page can use it.`,
      action: "Reopen your projects folder",
      onAction: folder.onReopen,
    },
    missing: {
      title: "Your projects folder can't be found",
      text: `“${name}” may have been moved, renamed or deleted. Choose it again where it is now.`,
      action: "Choose a folder for projects",
      onAction: folder.onChoose,
    },
  }[where.kind];
  return (
    <section aria-label={title} className={card}>
      <div className="min-w-0 flex-1">
        <p className="font-display font-semibold text-base">{title}</p>
        <p className="text-ink-muted">{text}</p>
      </div>
      <button type="button" disabled={!canChoose} onClick={onAction} className="rounded-md bg-ink px-3.5 py-1.5 text-paper enabled:hover:bg-ink/85 disabled:opacity-50">
        {action}
      </button>
      {where.kind === "browser" && (
        <button type="button" onClick={folder.onLater} className="rounded-md px-3 py-1.5 text-ink-muted hover:bg-paper-sunk">
          Later
        </button>
      )}
    </section>
  );
}

function EmptyHome({ canAdd, canImport, onFiles, folder, where }: {
  readonly canAdd: boolean;
  readonly canImport: boolean;
  readonly onFiles: HomeProps["onFiles"];
  readonly folder: FolderActions;
  readonly where: Whereabouts | undefined;
}) {
  const link = "underline hover:text-ink disabled:opacity-50";
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
        <p className="text-ink-muted">Kept on this computer only. Nothing is uploaded.</p>
      </div>
      {/* Kept inside Chrome, as after its site data is cleared: an existing projects folder can be opened. */}
      {where?.kind === "browser" && (
        <p className="text-center text-ink-muted">
          Already keep your projects in a folder on this computer?{" "}
          <button type="button" disabled={!canAdd} onClick={folder.onChoose} className={link}>
            Open your projects folder
          </button>
        </p>
      )}
      <p className="text-center text-ink-muted">
        Moving to this computer from another?{" "}
        <button type="button" disabled={!canImport} onClick={folder.onImport} className={link}>
          Import a project
        </button>
      </p>
    </div>
  );
}

const menuSteps: Partial<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

/** A row's ⋯ button and its menu. Arrow keys move through the items; Escape or a click outside closes it. */
function RowMenu({ name, disabled, children }: { readonly name: string; readonly disabled: boolean; readonly children: ReactNode }) {
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
        disabled={disabled}
        className="grid size-8 place-items-center rounded-md text-ink-muted enabled:hover:bg-paper-sunk enabled:hover:text-ink disabled:opacity-50"
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

/** A project on Home. While projects move into a folder, it can't be opened or changed. */
function ProjectRow({ listed, actions, can }: { readonly listed: Listed; readonly actions: ProjectActions; readonly can: LibraryState["can"] }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-4 border-t border-rule px-4 py-2.5 first:border-t-0">
      {renaming ? (
        <RenameField
          name={listed.name}
          onDone={(name) => {
            setRenaming(false);
            if (name !== undefined && name !== listed.name) actions.onRename(listed, name);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!can.open}
          onClick={() => actions.onOpen(listed)}
          className="min-h-6 truncate text-left font-display font-semibold text-base enabled:hover:underline disabled:text-ink-muted"
        >
          {listed.name}
        </button>
      )}
      <span className="text-ink-muted">{plural(listed.documents, "document")}</span>
      <span className="text-ink-muted">{plural(listed.marks, "mark")}</span>
      <span className="text-ink-muted">
        {listed.approved} of {listed.documents} approved
      </span>
      <RowMenu name={listed.name} disabled={!can.manage}>
        <MenuItem label="Rename" onSelect={() => setRenaming(true)} />
        <MenuItem label="Duplicate" onSelect={() => actions.onDuplicate(listed)} />
        <MenuItem label={listed.archived ? "Unarchive" : "Archive"} onSelect={() => actions.onArchive(listed, !listed.archived)} />
        <MenuItem label="Delete" onSelect={() => actions.onDelete(listed)} />
      </RowMenu>
    </li>
  );
}

function UnreadableRow({ entry }: { readonly entry: Unreadable }) {
  return (
    <li className="flex flex-col border-t border-rule px-4 py-2.5 first:border-t-0">
      <span className="font-display font-semibold text-base">{entry.folder}</span>
      <span className="text-mark">{problemText[entry.unreadable]}</span>
    </li>
  );
}

const byName = (a: Listed, b: Listed) => a.name.localeCompare(b.name);

/** The projects in use and the archived ones, each by name, and those that can't be read. */
function sortEntries(projects: readonly ProjectSummary[]) {
  const current: Listed[] = [];
  const archived: Listed[] = [];
  const unreadable: Unreadable[] = [];
  for (const entry of projects) {
    if ("unreadable" in entry) unreadable.push(entry);
    else (entry.archived ? archived : current).push(entry);
  }
  return { current: current.toSorted(byName), archived: archived.toSorted(byName), unreadable };
}

function ProjectList({ projects, actions, can }: { readonly projects: readonly ProjectSummary[]; readonly actions: ProjectActions; readonly can: LibraryState["can"] }) {
  const { current, archived, unreadable } = sortEntries(projects);
  const list = "overflow-hidden rounded-lg border border-rule bg-paper-raised";
  return (
    <>
      {(current.length > 0 || unreadable.length > 0) && (
        <ul className={list}>
          {current.map((listed) => (
            <ProjectRow key={listed.folder} listed={listed} actions={actions} can={can} />
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
            {archived.map((listed) => (
              <ProjectRow key={listed.folder} listed={listed} actions={actions} can={can} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** Asks before a project is deleted for good. */
function DeleteDialog({ listed, onDelete, onClose }: {
  readonly listed: Listed;
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
          Delete “{listed.name}”?
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
  const { library, status, error, refused, onDismissRefused, onFiles, folder } = props;
  const projects = library?.projects;
  const where = whereabouts(library, props.waiting);
  const canAdd = library?.can.create ?? false;
  const canImport = library?.can.import ?? false;
  const canChoose = library?.can.switchTo ?? false;
  const empty = projects !== undefined && projects.length === 0;
  const [deleting, setDeleting] = useState<Listed | undefined>(undefined);
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
          <>
            <button type="button" disabled={!canImport} onClick={folder.onImport} className={`${button} disabled:opacity-50`}>
              Import a project
            </button>
            <PickFiles label="New project" disabled={!canAdd} className={`${darkButton} px-3.5 py-1.5`} onFiles={onFiles} />
          </>
        )}
      </header>
      <DropZone error={error} onFiles={onFiles}>
        <NotAdded refused={refused} onDismiss={onDismissRefused} />
        {(where?.kind === "reopen" || where?.kind === "missing") && (
          <div className="mx-auto w-full max-w-3xl p-8">
            <FolderCard where={where} later={props.later} folder={folder} canChoose={canChoose} />
          </div>
        )}
        {empty && <EmptyHome canAdd={canAdd} canImport={canImport} onFiles={onFiles} folder={folder} where={where} />}
        {library?.projects !== undefined && !empty && (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-8">
            <FolderCard where={where} later={props.later} folder={folder} canChoose={canChoose} />
            <h2 className="font-display font-semibold text-2xl">Projects</h2>
            <ProjectList projects={library.projects} actions={actions} can={library.can} />
            <p className="text-ink-muted">
              {where?.kind === "folder"
                ? `Projects are kept in the folder “${where.name}” on this computer.`
                : "Projects are kept in this browser on this device. Clearing this site's data in the browser deletes them."}
            </p>
          </div>
        )}
      </DropZone>
      {deleting && <DeleteDialog listed={deleting} onDelete={() => props.onDelete(deleting)} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}

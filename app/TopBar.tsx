import type { RefObject } from "react";
import type { Appearance } from "../engine/contract";
import { AppearanceSettings } from "./AppearanceSettings";
import { PickFiles } from "./PickFiles";
import type { Tool } from "./marks";
import type { SaveState } from "./useProject";

const tools: readonly { readonly id: Tool; readonly label: string }[] = [
  { id: "text", label: "Select text" },
  { id: "box", label: "Draw box" },
];

/** The controls for marking the open document, shown while it is not in the preview. */
export interface Editing {
  readonly tool: Tool;
  readonly onTool: (tool: Tool) => void;
  readonly appearance: Appearance;
  readonly onAppearance: (appearance: Appearance) => void;
  readonly applyRef: RefObject<HTMLButtonElement | null>;
  readonly hasMarks: boolean;
  /** A new mark waits for its type, or the engine is at work: nothing can be applied or exported. */
  readonly busy: boolean;
  readonly onApply: () => void;
  /** Labelling mode only. */
  readonly onExportLabels: () => void;
}

export interface History {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

interface TopBarProps {
  readonly labelling: boolean;
  readonly projectName: string;
  readonly onProjects: () => void;
  readonly saveState: SaveState;
  readonly status: string;
  readonly canAdd: boolean;
  readonly onAdd: (files: readonly File[]) => void;
  /** Undefined while no document is open. */
  readonly history: History | undefined;
  readonly editing: Editing | undefined;
}

const saveText: Record<SaveState, string> = { saved: "Saved", saving: "Saving…", failed: "Not saved" };

function ToolPicker({ tool, onTool }: Pick<Editing, "tool" | "onTool">) {
  return (
    <div role="group" aria-label="Tool" className="flex rounded-md border border-rule bg-paper p-0.5">
      {tools.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={tool === option.id}
          onClick={() => onTool(option.id)}
          className="rounded px-3 py-1 text-ink-muted aria-pressed:bg-paper-raised aria-pressed:text-ink aria-pressed:shadow-[0_0_0_1px_var(--color-rule)]"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const historyIcons = {
  undo: "M7.5 4.5 4 8l3.5 3.5 M4 8h7.5a4.25 4.25 0 0 1 0 8.5H9",
  redo: "M12.5 4.5 16 8l-3.5 3.5 M16 8H8.5a4.25 4.25 0 0 0 0 8.5H11",
} as const;

function HistoryButton({ action, enabled, onClick }: { readonly action: keyof typeof historyIcons; readonly enabled: boolean; readonly onClick: () => void }) {
  const label = action === "undo" ? "Undo" : "Redo";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={!enabled}
      onClick={onClick}
      className="grid size-8 place-items-center text-ink hover:bg-paper-sunk disabled:cursor-not-allowed disabled:text-field disabled:hover:bg-transparent"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-[18px] fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]">
        <path d={historyIcons[action]} />
      </svg>
    </button>
  );
}

function HistoryButtons({ history }: { readonly history: History }) {
  return (
    <div role="group" aria-label="History" className="flex divide-x divide-rule overflow-hidden rounded-md border border-rule bg-paper-raised">
      <HistoryButton action="undo" enabled={history.canUndo} onClick={history.onUndo} />
      <HistoryButton action="redo" enabled={history.canRedo} onClick={history.onRedo} />
    </div>
  );
}

function EditingActions({ editing, labelling }: { readonly editing: Editing; readonly labelling: boolean }) {
  return (
    <>
      {labelling && (
        <button
          type="button"
          disabled={editing.busy}
          onClick={editing.onExportLabels}
          className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk disabled:opacity-40"
        >
          Export labels
        </button>
      )}
      <AppearanceSettings appearance={editing.appearance} onAppearance={editing.onAppearance} />
      <button
        ref={editing.applyRef}
        type="button"
        disabled={!editing.hasMarks || editing.busy}
        onClick={editing.onApply}
        className="rounded-md bg-ink px-3.5 py-1.5 text-paper hover:bg-ink/85 disabled:opacity-40"
      >
        Apply and check
      </button>
    </>
  );
}

export function TopBar(props: TopBarProps) {
  const { labelling, projectName, saveState, history, editing } = props;
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-paper-raised px-4 py-2.5">
      <h1 className="font-display font-semibold text-xl tracking-tight">Redactorator</h1>
      {labelling && (
        <span className="rounded border border-accent/40 bg-accent-wash px-1.5 py-0.5 text-xs text-accent">Labelling</span>
      )}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-ink-muted">
        <a
          href="#projects"
          onClick={(event) => {
            event.preventDefault();
            props.onProjects();
          }}
          className="hover:text-ink hover:underline"
        >
          Projects
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="truncate text-ink">
          {projectName}
        </span>
      </nav>
      <span className={`flex items-center gap-1.5 ${saveState === "failed" ? "text-mark" : "text-ink-muted"}`}>
        <span aria-hidden="true" className={`size-1.5 rounded-full ${saveState === "saved" ? "bg-pass" : saveState === "saving" ? "bg-field" : "bg-mark"}`} />
        <span>{saveText[saveState]}</span>
      </span>
      <p role="status" className="truncate text-ink-muted">
        {props.status}
      </p>
      <div className="flex-1" />
      {history && <HistoryButtons history={history} />}
      {editing && <ToolPicker tool={editing.tool} onTool={editing.onTool} />}
      <PickFiles
        label="Add documents"
        disabled={!props.canAdd}
        className="grid size-8 cursor-pointer place-items-center rounded-md border border-rule hover:bg-paper-sunk has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
        onFiles={props.onAdd}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current stroke-[1.5]">
          <path d="M5 2.75h6.5l3.5 3.5v11H5z M11.5 2.75v3.5H15 M10 9v6 M7 12h6" />
        </svg>
      </PickFiles>
      {editing && <EditingActions editing={editing} labelling={labelling} />}
    </header>
  );
}

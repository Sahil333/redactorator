import type { ChangeEvent, RefObject } from "react";
import type { Appearance } from "../engine/contract";
import { AppearanceSettings } from "./AppearanceSettings";
import type { Tool } from "./marks";

const tools: readonly { readonly id: Tool; readonly label: string }[] = [
  { id: "text", label: "Select text" },
  { id: "box", label: "Draw box" },
];

/** The controls for marking an open document, shown while it is not in the preview. */
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

interface TopBarProps {
  readonly labelling: boolean;
  readonly fileName: string | undefined;
  readonly status: string;
  readonly fileInputId: string;
  readonly canOpen: boolean;
  readonly onOpen: (file: File) => void;
  readonly editing: Editing | undefined;
}

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

export function TopBar({ labelling, fileName, status, fileInputId, canOpen, onOpen, editing }: TopBarProps) {
  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (picked !== undefined) onOpen(picked);
  }

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-paper-raised px-4 py-2.5">
      <h1 className="font-serif text-xl tracking-tight">Redactorator</h1>
      {labelling && (
        <span className="rounded border border-accent/40 bg-accent-wash px-1.5 py-0.5 text-xs text-accent">Labelling</span>
      )}
      <p className="flex min-w-0 gap-2 truncate text-ink-muted">
        {fileName !== undefined && <span className="truncate text-ink">{fileName}</span>}
        <span role="status">{status}</span>
      </p>
      <div className="flex-1" />
      {editing && <ToolPicker tool={editing.tool} onTool={editing.onTool} />}
      <label
        htmlFor={fileInputId}
        className="cursor-pointer rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk has-disabled:cursor-not-allowed has-disabled:opacity-50"
      >
        Open a PDF
        <input id={fileInputId} type="file" accept="application/pdf" disabled={!canOpen} onChange={onPick} className="sr-only" />
      </label>
      {editing && <EditingActions editing={editing} labelling={labelling} />}
    </header>
  );
}

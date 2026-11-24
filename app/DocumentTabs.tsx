import { useEffect, useRef, type KeyboardEvent } from "react";
import type { DocumentId, ProjectDocument } from "../engine/model/project";

export const tabId = (id: DocumentId) => `tab-${id}`;
export const DOCUMENT_PANEL_ID = "document-panel";

interface DocumentTabsProps {
  readonly documents: readonly ProjectDocument[];
  readonly active: DocumentId | undefined;
  readonly canSwitch: boolean;
  readonly onSelect: (id: DocumentId) => void;
  readonly onClose: (id: DocumentId) => void;
}

/**
 * The open documents, one tab each. Left and Right move between tabs, Home and End to the ends.
 * Tabs that don't fit scroll sideways with no scrollbar, and the open document's tab scrolls into view.
 */
export function DocumentTabs({ documents, active, canSwitch, onSelect, onClose }: DocumentTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active === undefined) return;
    listRef.current?.querySelector(`#${CSS.escape(tabId(active))}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = documents.length - 1;
    const to = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: last }[event.key];
    if (to === undefined || !canSwitch) return;
    event.preventDefault();
    const target = documents[Math.min(Math.max(to, 0), last)];
    if (target === undefined) return;
    onSelect(target.id);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(target.id))}`)?.focus();
  }

  return (
    <div ref={listRef} role="tablist" aria-label="Open documents" className="flex shrink-0 overflow-x-auto [scrollbar-width:none] border-b border-rule bg-paper-sunk">
      {documents.map((document, index) => {
        const selected = document.id === active;
        return (
          <div
            key={document.id}
            role="presentation"
            className={`flex max-w-56 shrink-0 items-center border-r border-rule ${selected ? "bg-paper shadow-[inset_0_2px_0_var(--color-accent)]" : "bg-paper-sunk"}`}
          >
            <button
              id={tabId(document.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={DOCUMENT_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              disabled={!canSwitch && !selected}
              onClick={() => onSelect(document.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`min-w-0 truncate py-1.5 pl-3 ${selected ? "text-ink" : "text-ink-muted hover:text-ink"}`}
            >
              {document.file}
            </button>
            <button
              type="button"
              aria-label={`Close ${document.file}`}
              disabled={!canSwitch}
              onClick={() => onClose(document.id)}
              className="mx-1 grid size-6 shrink-0 place-items-center rounded text-ink-muted hover:bg-paper-raised hover:text-ink"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

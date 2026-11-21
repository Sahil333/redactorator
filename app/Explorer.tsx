import type { DocumentId, ProjectDocument } from "./project";

interface ExplorerProps {
  readonly documents: readonly ProjectDocument[];
  readonly active: DocumentId | undefined;
  /** False while switching documents would lose work under way, such as an apply. */
  readonly canOpen: boolean;
  readonly onOpen: (id: DocumentId) => void;
}

/** Every document in the project. Opening one shows it in a tab. */
export function Explorer({ documents, active, canOpen, onOpen }: ExplorerProps) {
  return (
    <nav aria-label="Documents" className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-rule bg-paper">
      <h2 className="flex items-baseline justify-between px-3 pt-3 pb-2 font-display font-semibold text-base">
        Documents <span className="text-xs font-normal text-ink-muted">{documents.length}</span>
      </h2>
      <ul>
        {documents.map((document) => (
          <li key={document.id} className="border-t border-rule">
            <button
              type="button"
              aria-current={document.id === active ? "true" : undefined}
              disabled={!canOpen}
              onClick={() => onOpen(document.id)}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-paper-raised aria-[current=true]:bg-paper-raised aria-[current=true]:shadow-[inset_3px_0_0_var(--color-ink)] disabled:cursor-not-allowed"
            >
              <span className="w-full truncate">{document.file}</span>
              <span className="text-xs text-ink-muted">
                {document.pages === 1 ? "1 page" : `${document.pages} pages`}
                {document.marks.length > 0 && ` · ${document.marks.length === 1 ? "1 mark" : `${document.marks.length} marks`}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

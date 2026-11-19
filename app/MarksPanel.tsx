import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { firstPage, markName, pagesLabel, type Mark } from "./marks";
import { markTypeLabel, type MarkTypeOption } from "./markTypes";
import { pageFrameId } from "./pageGeometry";
import type { PanelWidth } from "./Splitter";
import { TypePicker } from "./TypePicker";

export const marksPanelWidth: PanelWidth = { initial: 288, min: 240, max: 480 };

interface MarksPanelProps {
  readonly id: string;
  readonly width: number;
  readonly marks: readonly Mark[];
  readonly typeOptions: readonly MarkTypeOption[];
  /** The mark under the pointer here or on its page. */
  readonly highlighted: Mark["id"] | undefined;
  readonly onHighlight: (mark: Mark["id"] | undefined) => void;
  readonly onRemove: (mark: Mark) => void;
  readonly onRetype: (mark: Mark, type: MarkTypeOption) => void;
  /** Labelling mode only: gives each mark a link id field. */
  readonly onLink?: (mark: Mark, linkId: string) => void;
}

export function MarksPanel({
  id,
  width,
  marks,
  typeOptions,
  highlighted,
  onHighlight,
  onRemove,
  onRetype,
  onLink,
}: MarksPanelProps) {
  const [retyping, setRetyping] = useState<Mark["id"] | undefined>(undefined);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Where focus goes once a removed mark's row is gone: the row now in its place, or the heading.
  const focusAfterRemove = useRef<number | undefined>(undefined);

  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === undefined) return;
    focusAfterRemove.current = undefined;
    const links = listRef.current?.querySelectorAll("a");
    const next = links?.[Math.min(index, links.length - 1)];
    (next ?? headingRef.current)?.focus();
  }, [marks]);

  function remove(mark: Mark) {
    focusAfterRemove.current = marks.indexOf(mark);
    onRemove(mark);
  }

  function onRowKey(event: KeyboardEvent, mark: Mark) {
    if (event.key !== "Delete" || event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    remove(mark);
  }
  return (
    <aside id={id} aria-label="Marks" className="flex min-h-0 flex-col bg-paper-raised" style={{ width }}>
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <h2 ref={headingRef} tabIndex={-1} className="font-serif text-lg">
          Marks
        </h2>
        <span className="text-xs text-ink-muted">{marks.length === 1 ? "1 mark" : `${marks.length} marks`}</span>
      </div>
      {marks.length === 0 ? (
        <p className="px-4 text-ink-muted">Select text or draw a box on a page to mark it for removal.</p>
      ) : (
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
          {marks.map((mark) => {
            const where = `${markName(mark)} on ${pagesLabel(mark.target)}`;
            return (
              <li
                key={mark.id}
                onKeyDown={(event) => onRowKey(event, mark)}
                onPointerEnter={() => onHighlight(mark.id)}
                onPointerLeave={(event) => {
                  if (!event.currentTarget.contains(document.activeElement)) onHighlight(undefined);
                }}
                onFocus={() => onHighlight(mark.id)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(undefined);
                }}
                className={`relative flex items-center gap-2 border-b border-rule px-4 py-2 ${mark.id === highlighted ? "bg-mark-wash" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <a href={`#${pageFrameId(firstPage(mark.target))}`} className="block min-h-6 truncate leading-6 hover:underline">
                    {markName(mark)}
                  </a>
                  <button
                    type="button"
                    aria-label={`Change type of ${where}`}
                    onClick={() => setRetyping(mark.id)}
                    className="min-h-6 rounded text-xs text-ink-muted hover:text-ink hover:underline"
                  >
                    {markTypeLabel(mark.type)} · {pagesLabel(mark.target)}
                  </button>
                  {onLink !== undefined && (
                    <input
                      aria-label={`Link id for ${where}`}
                      placeholder="Link id"
                      value={mark.linkId}
                      onChange={(event) => onLink(mark, event.target.value)}
                      className="mt-1 block h-7 w-full rounded border border-field bg-white px-2 text-xs placeholder:text-ink-muted"
                    />
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove mark ${where}`}
                  onClick={() => remove(mark)}
                  className="min-h-6 min-w-6 rounded text-ink-muted hover:bg-paper-sunk hover:text-ink"
                >
                  ×
                </button>
                {retyping === mark.id && (
                  <div className="absolute top-full right-4 z-10">
                    <TypePicker
                      options={typeOptions}
                      initial={mark.type}
                      onPick={(type) => {
                        setRetyping(undefined);
                        onRetype(mark, type);
                      }}
                      onCancel={() => setRetyping(undefined)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

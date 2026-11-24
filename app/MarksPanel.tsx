import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PlacedImage } from "../engine/model/document";
import { anchorOf } from "../engine/model/images";
import { firstPage, itemKey, markKey, markName, markPages, type Mark } from "../engine/model/marks";
import { pagesLabel } from "./marks";
import { markTypeLabel, type MarkTypeOption } from "../engine/model/markTypes";
import { PageLink } from "./PageLink";
import type { HiddenValue } from "../engine/model/project";
import type { Reach } from "../engine/model/spread";
import type { PanelWidth } from "./Splitter";
import { TypePicker } from "./TypePicker";

export const marksPanelWidth: PanelWidth = { initial: 288, min: 240, max: 480 };

interface MarksPanelProps {
  readonly id: string;
  readonly width: number;
  readonly marks: readonly Mark[];
  /** The values hidden in the whole project, and how far each reaches. */
  readonly hidden: readonly HiddenValue[];
  readonly reach: ReadonlyMap<string, Reach>;
  /** The document's images a box can spread over; undefined until they are read. */
  readonly images: readonly PlacedImage[] | undefined;
  readonly typeOptions: readonly MarkTypeOption[];
  /** The mark under the pointer here or on its page. */
  readonly highlighted: Mark["id"] | undefined;
  readonly onHighlight: (mark: Mark["id"] | undefined) => void;
  readonly onRemove: (mark: Mark) => void;
  readonly onRetype: (mark: Mark, type: MarkTypeOption) => void;
  /** "Don't hide here": keeps a hidden value visible in this document only. */
  readonly onKeepHere: (mark: Mark) => void;
  /** Labelling mode only: gives each item a link id field. */
  readonly onLink?: (mark: Mark, linkId: string) => void;
}

type View = "document" | "project" | "new";

const views: readonly { readonly id: View; readonly label: string }[] = [
  { id: "document", label: "This document" },
  { id: "project", label: "Whole project" },
  { id: "new", label: "New" },
];

/** One row of the list: every mark of one value, or one box. */
type Item = readonly [Mark, ...Mark[]];

function itemsOf(marks: readonly Mark[]): Item[] {
  const byKey = new Map<string, [Mark, ...Mark[]]>();
  for (const mark of marks) {
    const item = byKey.get(itemKey(mark));
    if (item === undefined) byKey.set(itemKey(mark), [mark]);
    else item.push(mark);
  }
  return [...byKey.values()];
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** "page 2", "pages 2–3" for one mark across pages, or "3 places, pages 1 and 4". */
function placesLabel([first, ...rest]: Item): string {
  if (rest.length === 0) return pagesLabel(first.target);
  const pages = [...new Set([first, ...rest].flatMap((mark) => markPages(mark.target)))].toSorted((a, b) => a - b).map((page) => page + 1);
  const last = pages.pop();
  const list = pages.length === 0 ? `page ${last}` : `pages ${pages.join(", ")} and ${last}`;
  return `${rest.length + 1} places, ${list}`;
}

function ViewPicker({ view, onView, newCount }: { readonly view: View; readonly onView: (view: View) => void; readonly newCount: number }) {
  return (
    <div role="group" aria-label="Show" className="mx-4 mb-2 flex rounded-md border border-rule bg-paper p-0.5 text-xs">
      {views.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={view === option.id}
          onClick={() => onView(option.id)}
          className="flex-1 rounded px-2 py-1 text-ink-muted aria-pressed:bg-paper-raised aria-pressed:text-ink aria-pressed:shadow-[0_0_0_1px_var(--color-rule)]"
        >
          {option.label}
          {option.id === "new" && newCount > 0 && ` (${newCount})`}
        </button>
      ))}
    </div>
  );
}

/** The values hidden in every document of the project, and how far each reaches. */
function ProjectList({ hidden, reach }: Pick<MarksPanelProps, "hidden" | "reach">) {
  if (hidden.length === 0) {
    return <p className="px-4 text-ink-muted">Nothing is hidden across the project yet. Approving a document hides its marked text, and its boxes over images, in every document.</p>;
  }
  return (
    <ul aria-label="Hidden in this project" className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
      {hidden.map((value) => {
        const { places = 0, documents = 0 } = reach.get(value.key) ?? {};
        return (
          <li key={value.key} className="border-b border-rule px-4 py-2">
            <span className="block truncate">{value.text}</span>
            <span className="text-xs text-ink-muted">
              {markTypeLabel(value.type)} · {plural(places, "place")} in {plural(documents, "document")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface ItemRowProps extends Pick<MarksPanelProps, "typeOptions" | "onHighlight" | "onRetype" | "onLink"> {
  readonly item: Item;
  readonly highlighted: boolean;
  /** Whether it is a box that no approval will spread, being mostly on no image. */
  readonly stays: boolean;
  readonly onRemove: () => void;
  /** Given when its value is hidden across the project, so it can be kept visible here alone. */
  readonly onKeepHere: (() => void) | undefined;
}

function ItemRow({ item, highlighted, stays, typeOptions, onHighlight, onRetype, onLink, onRemove, onKeepHere }: ItemRowProps) {
  const [retyping, setRetyping] = useState(false);
  const [mark] = item;
  const where = `${markName(mark)} on ${placesLabel(item)}`;
  const isNew = item.some((each) => each.isNew);
  const tint = highlighted ? "bg-mark-wash" : isNew ? "bg-accent-wash" : "";
  return (
    <li
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Delete" || event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        onRemove();
      }}
      onPointerEnter={() => onHighlight(mark.id)}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) onHighlight(undefined);
      }}
      onFocus={() => onHighlight(mark.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(undefined);
      }}
      className={`relative flex items-center gap-2 border-b border-rule px-4 py-2 ${tint}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {isNew && <span className="shrink-0 rounded bg-accent px-1 py-px text-[10px] leading-3 font-medium text-white">New</span>}
          <PageLink page={firstPage(mark.target)} mark={mark.id} className="block min-h-6 min-w-0 truncate leading-6 hover:underline">
            {markName(mark)}
          </PageLink>
        </div>
        <button
          type="button"
          aria-label={`Change type of ${where}`}
          onClick={() => setRetyping(true)}
          className="min-h-6 rounded text-left text-xs text-ink-muted hover:text-ink hover:underline"
        >
          {markTypeLabel(mark.type)} · {placesLabel(item)}
        </button>
        {stays && <p className="text-xs text-ink-muted">Stays in this document</p>}
        {onKeepHere !== undefined && (
          <button
            type="button"
            aria-label={`Don't hide ${where} here`}
            onClick={onKeepHere}
            className="block min-h-6 rounded text-xs text-ink-muted underline hover:text-ink"
          >
            Don't hide here
          </button>
        )}
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
        title={onKeepHere === undefined ? "Remove" : "Stop hiding everywhere, once this document is approved"}
        onClick={onRemove}
        className="min-h-6 min-w-6 rounded text-ink-muted hover:bg-paper-sunk hover:text-ink"
      >
        ×
      </button>
      {retyping && (
        <div className="absolute top-full right-4 z-10">
          <TypePicker
            options={typeOptions}
            initial={mark.type}
            onPick={(type) => {
              setRetyping(false);
              onRetype(mark, type);
            }}
            onCancel={() => setRetyping(false)}
          />
        </div>
      )}
    </li>
  );
}

/** Whether a mark is a box that approving won't spread: one not yet anchored, and mostly on no image. */
function staysPut({ target }: Mark, images: readonly PlacedImage[] | undefined): boolean {
  return target.kind === "box" && target.image === undefined && images !== undefined && anchorOf(target.page, target.box, images) === undefined;
}

export function MarksPanel({ id, width, marks, hidden, reach, images, highlighted, onRemove, onKeepHere, ...row }: MarksPanelProps) {
  const [view, setView] = useState<View>("document");
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Where focus goes once a removed item's row is gone: the row now in its place, or the heading.
  const focusAfterRemove = useRef<number | undefined>(undefined);
  const hiddenKeys = new Set(hidden.map((value) => value.key));
  const newMarks = marks.filter((mark) => mark.isNew);
  const items = itemsOf(view === "new" ? newMarks : marks);

  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === undefined) return;
    focusAfterRemove.current = undefined;
    const links = listRef.current?.querySelectorAll("a");
    const next = links?.[Math.min(index, links.length - 1)];
    (next ?? headingRef.current)?.focus();
  }, [marks]);

  const empty = view === "new" ? "No marks are new here." : "Select text or draw a box on a page to mark it for removal.";
  return (
    <aside id={id} aria-label="Marks" className="flex min-h-0 shrink-0 flex-col bg-paper-raised" style={{ width }}>
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <h2 ref={headingRef} tabIndex={-1} className="font-display font-semibold text-lg">
          Marks
        </h2>
        <span className="text-xs text-ink-muted">{plural(marks.length, "mark")}</span>
      </div>
      <ViewPicker view={view} onView={setView} newCount={newMarks.length} />
      {view === "project" ? (
        <ProjectList hidden={hidden} reach={reach} />
      ) : items.length === 0 ? (
        <p className="px-4 text-ink-muted">{empty}</p>
      ) : (
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
          {items.map((item, index) => {
            const [mark] = item;
            const key = markKey(mark);
            return (
              <ItemRow
                key={itemKey(mark)}
                item={item}
                highlighted={item.some((each) => each.id === highlighted)}
                stays={staysPut(mark, images)}
                {...row}
                onRemove={() => {
                  focusAfterRemove.current = index;
                  onRemove(mark);
                }}
                onKeepHere={
                  key !== undefined && hiddenKeys.has(key)
                    ? () => {
                        focusAfterRemove.current = index;
                        onKeepHere(mark);
                      }
                    : undefined
                }
              />
            );
          })}
        </ul>
      )}
    </aside>
  );
}

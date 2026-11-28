import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { packNames, packOrder, type PackId } from "../engine/model/detection";
import { identifierPacks } from "../engine/model/identifiers";
import { customMarkType, generalTypeIds, type MarkType, type MarkTypeOption } from "../engine/model/markTypes";

interface TypePickerProps {
  readonly options: readonly MarkTypeOption[];
  readonly initial: MarkType;
  readonly onPick: (option: MarkTypeOption) => void;
  readonly onCancel: () => void;
  /** Shift with an arrow: move the end of the selection the new mark came from. */
  readonly onAdjust?: (event: KeyboardEvent) => void;
}

/** The picker's width in CSS pixels, so it can be kept on the page. */
export const PICKER_WIDTH = 240;

/** A row of the list, with its place in the order the arrow keys move through. */
interface Row {
  readonly option: MarkTypeOption;
  readonly index: number;
}

interface Listed {
  /** The general types and the user's own, listed first and in no group. */
  readonly ungrouped: readonly Row[];
  /** The identifiers Auto mode finds, under their pack, in pack order. */
  readonly groups: readonly { readonly pack: PackId; readonly rows: readonly Row[] }[];
  /** The row that adds the typed name as a new type: none when a type already has that name. */
  readonly added: Row | undefined;
  /** Every type, in the order the arrow keys move through them. */
  readonly choices: readonly MarkTypeOption[];
  /** The row the typed name picks: the type with that very name, or else the first. */
  readonly picked: number;
}

const packOf = ({ id }: MarkTypeOption): PackId | undefined => (generalTypeIds.has(id) ? undefined : identifierPacks[id]);

function listFor(options: readonly MarkTypeOption[], query: string): Listed {
  const typed = query.trim();
  const name = typed.toLowerCase();
  const byPack = new Map<PackId | undefined, MarkTypeOption[]>();
  let exact: MarkTypeOption | undefined;
  for (const option of options) {
    const label = option.label.toLowerCase();
    if (!label.includes(name)) continue;
    if (exact === undefined && label === name) exact = option;
    const pack = packOf(option);
    const bucket = byPack.get(pack);
    if (bucket === undefined) byPack.set(pack, [option]);
    else bucket.push(option);
  }
  const choices: MarkTypeOption[] = [];
  const row = (option: MarkTypeOption): Row => ({ option, index: choices.push(option) - 1 });
  const ungrouped = (byPack.get(undefined) ?? []).map(row);
  const groups = packOrder.flatMap((pack) => {
    const packOptions = byPack.get(pack);
    return packOptions === undefined ? [] : [{ pack, rows: packOptions.map(row) }];
  });
  const added = name === "" || exact !== undefined ? undefined : row(customMarkType(typed));
  return { ungrouped, groups, added, choices, picked: Math.max(0, choices.findIndex((choice) => choice === exact)) };
}

/**
 * A combobox: type to filter, arrows to move, Enter to pick. A name no type has, ignoring case,
 * gets a row that adds it; Enter alone still picks the highlighted type when any type matches.
 * Escape, a click outside or a Tab out of it cancels.
 */
export function TypePicker({ options, initial, onPick, onCancel, onAdjust }: TypePickerProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const { ungrouped, groups, added, choices } = listFor(options, query);
  const [active, setActive] = useState(() => Math.max(0, choices.findIndex((option) => option.id === initial)));
  const activeIndex = Math.min(active, choices.length - 1);
  const optionId = (index: number) => `${listId}-${index}`;
  const labelId = (pack: PackId) => `${listId}-${pack}`;
  // A group's first type brings the group's name into view with it.
  const headedBy = groups.find(({ rows }) => rows[0]?.index === activeIndex)?.pack;

  // Focus stays in the text field, so the list does not follow the active type by itself.
  useEffect(() => {
    if (headedBy !== undefined) document.getElementById(labelId(headedBy))?.scrollIntoView({ block: "nearest" });
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [listId, activeIndex, headedBy]);
  // Read before autoFocus moves focus here, so closing the picker can put it back, without
  // scrolling: a mark across pages starts on a page that may be out of view.
  const [returnTo] = useState(() => document.activeElement);
  // Set once the picker is done, so the focus it hands back is not taken as leaving it.
  const closed = useRef(false);
  const close = () => {
    closed.current = true;
    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  };
  const pick = (choice: MarkTypeOption) => {
    close();
    onPick(choice);
  };

  // Focus went elsewhere, by a click or a Tab: it stays where the user put it.
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (closed.current || event.currentTarget.contains(event.relatedTarget)) return;
    closed.current = true;
    onCancel();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (onAdjust !== undefined && event.shiftKey && event.key.startsWith("Arrow")) {
      event.preventDefault();
      onAdjust(event);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + choices.length) % choices.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const choice = choices[activeIndex];
      if (choice !== undefined) pick(choice);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      onCancel();
    }
  }

  // A click anywhere in the picker leaves focus in its input, where the keys work.
  function onMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
  }

  return (
    <div onBlur={onBlur} onMouseDown={onMouseDown} style={{ width: PICKER_WIDTH }} className="rounded-md border border-rule bg-paper-raised p-2 shadow-[0_4px_16px_rgb(31_27_22/0.16)]">
      <input
        autoFocus
        role="combobox"
        aria-label="Type for this mark"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={choices.length > 0 ? optionId(activeIndex) : undefined}
        value={query}
        placeholder="Person, or a new type"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(listFor(options, event.target.value).picked);
        }}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded border border-field bg-white px-2 text-sm placeholder:text-ink-muted"
      />
      {/* Not a Tab stop of its own, though it scrolls: the arrow keys move through it. */}
      <div id={listId} role="listbox" aria-label="Types" tabIndex={-1} className="mt-1 max-h-56 overflow-y-auto">
        {ungrouped.map(({ option, index }) => (
          <TypeOption key={option.id} id={optionId(index)} label={option.label} active={index === activeIndex} onPick={() => pick(option)} />
        ))}
        {groups.map(({ pack, rows }) => (
          <div key={pack} role="group" aria-labelledby={labelId(pack)}>
            <div id={labelId(pack)} role="presentation" className="px-2 pt-2 pb-0.5 text-xs font-semibold text-ink-muted">
              {packNames[pack]}
            </div>
            {rows.map(({ option, index }) => (
              <TypeOption key={option.id} id={optionId(index)} label={option.label} active={index === activeIndex} onPick={() => pick(option)} />
            ))}
          </div>
        ))}
        {added !== undefined && (
          <TypeOption id={optionId(added.index)} label={`Add “${added.option.label}” as a new type`} active={added.index === activeIndex} onPick={() => pick(added.option)} />
        )}
      </div>
    </div>
  );
}

function TypeOption({ id, label, active, onPick }: { readonly id: string; readonly label: string; readonly active: boolean; readonly onPick: () => void }) {
  return (
    <div id={id} role="option" aria-selected={active} onClick={onPick} className={`cursor-pointer rounded px-2 py-1 ${active ? "bg-accent-wash text-accent" : ""}`}>
      {label}
    </div>
  );
}

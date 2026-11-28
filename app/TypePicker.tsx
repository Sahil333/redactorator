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

interface Listed {
  /** The general types and the user's own, listed first and in no group. */
  readonly ungrouped: readonly MarkTypeOption[];
  /** The identifiers Auto mode finds, under their pack, in pack order. */
  readonly groups: readonly { readonly pack: PackId; readonly options: readonly MarkTypeOption[] }[];
  /** The row that adds the typed name as a new type: none when a type already has that name. */
  readonly added: MarkTypeOption | undefined;
  /** Every row in the order the arrow keys move through them. */
  readonly choices: readonly MarkTypeOption[];
  /** The row the typed name picks: the type with that very name, or else the first. */
  readonly picked: number;
}

const packOf = ({ id }: MarkTypeOption): PackId | undefined => (generalTypeIds.has(id) ? undefined : identifierPacks[id]);

function listFor(options: readonly MarkTypeOption[], query: string): Listed {
  const name = query.trim().toLowerCase();
  const matches = options.filter((option) => option.label.toLowerCase().includes(name));
  const exact = matches.findIndex((option) => option.label.toLowerCase() === name);
  const ungrouped = matches.filter((option) => packOf(option) === undefined);
  const groups = packOrder
    .map((pack) => ({ pack, options: matches.filter((option) => packOf(option) === pack) }))
    .filter((group) => group.options.length > 0);
  const added = name === "" || exact >= 0 ? undefined : customMarkType(query.trim());
  const choices = [...ungrouped, ...groups.flatMap((group) => group.options), ...(added === undefined ? [] : [added])];
  const match = matches[exact];
  return { ungrouped, groups, added, choices, picked: match === undefined ? 0 : choices.indexOf(match) };
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
  const optionId = (choice: MarkTypeOption) => `${listId}-${choices.indexOf(choice)}`;

  // Focus stays in the text field, so the list does not follow the active type by itself.
  useEffect(() => {
    const option = document.getElementById(`${listId}-${activeIndex}`);
    // A group's first type brings the group's name into view with it.
    const label = option?.previousElementSibling;
    if (label?.role === "presentation") label.scrollIntoView({ block: "nearest" });
    option?.scrollIntoView({ block: "nearest" });
  }, [listId, activeIndex]);
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
        aria-activedescendant={choices.length > 0 ? `${listId}-${activeIndex}` : undefined}
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
        {ungrouped.map((choice) => (
          <TypeOption key={choice.id} id={optionId(choice)} label={choice.label} active={choice === choices[activeIndex]} onPick={() => pick(choice)} />
        ))}
        {groups.map(({ pack, options: packOptions }) => (
          <div key={pack} role="group" aria-labelledby={`${listId}-${pack}`}>
            <div id={`${listId}-${pack}`} role="presentation" className="px-2 pt-2 pb-0.5 text-xs font-semibold text-ink-muted">
              {packNames[pack]}
            </div>
            {packOptions.map((choice) => (
              <TypeOption key={choice.id} id={optionId(choice)} label={choice.label} active={choice === choices[activeIndex]} onPick={() => pick(choice)} />
            ))}
          </div>
        ))}
        {added !== undefined && (
          <TypeOption id={optionId(added)} label={`Add “${added.label}” as a new type`} active={added === choices[activeIndex]} onPick={() => pick(added)} />
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

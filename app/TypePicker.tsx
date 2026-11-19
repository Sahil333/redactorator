import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { customMarkType, type MarkType, type MarkTypeOption } from "./markTypes";

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

/**
 * A combobox: type to filter, arrows to move, Enter to pick. A name that matches no type adds it.
 * Escape, a click outside or a Tab out of it cancels.
 */
export function TypePicker({ options, initial, onPick, onCancel, onAdjust }: TypePickerProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const name = query.trim();
  const matches = options.filter((option) => option.label.toLowerCase().includes(name.toLowerCase()));
  const exact = matches.some((option) => option.label.toLowerCase() === name.toLowerCase());
  const added = name === "" || exact ? undefined : customMarkType(name);
  const choices = added === undefined ? matches : [...matches, added];
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((option) => option.id === initial)));
  const activeIndex = Math.min(active, choices.length - 1);
  const listRef = useRef<HTMLUListElement>(null);

  // Focus stays in the text field, so the list does not follow the active type by itself.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
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
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded border border-field bg-white px-2 text-sm placeholder:text-ink-muted"
      />
      {/* Not a Tab stop of its own, though it scrolls: the arrow keys move through it. */}
      <ul ref={listRef} id={listId} role="listbox" aria-label="Types" tabIndex={-1} className="mt-1 max-h-56 overflow-y-auto">
        {choices.map((choice, index) => (
          <li
            key={choice.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => pick(choice)}
            className={`cursor-pointer rounded px-2 py-1 ${index === activeIndex ? "bg-accent-wash text-accent" : ""}`}
          >
            {choice === added ? `Add “${choice.label}” as a type` : choice.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

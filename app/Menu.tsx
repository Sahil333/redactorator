import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

const menuSteps: Partial<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

/** A ⋯ button and its menu, both named `label`. Arrow keys move through the items; Escape or a click outside closes it. */
export function Menu({ label, disabled, children }: { readonly label: string; readonly disabled: boolean; readonly children: ReactNode }) {
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
        aria-label={label}
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
        aria-label={label}
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

export function MenuItem({ label, onSelect }: { readonly label: string; readonly onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onSelect} className="block w-full rounded px-3 py-1.5 text-left hover:bg-paper-sunk focus:bg-paper-sunk">
      {label}
    </button>
  );
}

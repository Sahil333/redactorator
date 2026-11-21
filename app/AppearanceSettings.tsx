import { useId } from "react";
import type { Appearance } from "../engine/contract";

interface AppearanceSettingsProps {
  readonly appearance: Appearance;
  readonly onAppearance: (appearance: Appearance) => void;
}

const presets = [
  { label: "Black", colour: "#000000" },
  { label: "White", colour: "#ffffff" },
] as const;

/** A settings button that opens how the boxes in the output look. A click outside or Escape closes it. */
export function AppearanceSettings({ appearance, onAppearance }: AppearanceSettingsProps) {
  const popoverId = useId();
  const titleId = useId();
  const custom = !presets.some((preset) => preset.colour === appearance.colour);
  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        aria-label="Appearance"
        title="Appearance"
        className="appearance-anchor grid size-8 place-items-center rounded-md border border-rule hover:bg-paper-sunk"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-paper-raised stroke-current stroke-[1.5]">
          <path d="M3 5h14M3 10h14M3 15h14" />
          <circle cx="7" cy="5" r="1.75" />
          <circle cx="13" cy="10" r="1.75" />
          <circle cx="9" cy="15" r="1.75" />
        </svg>
      </button>
      <div
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-labelledby={titleId}
        className="appearance-popover w-72 rounded-md border border-rule bg-paper-raised p-4 text-ink shadow-[0_4px_16px_rgb(31_27_22/0.16)]"
      >
        <h2 id={titleId} className="mb-2 font-display font-semibold text-base">
          Appearance
        </h2>
        <div role="radiogroup" aria-label="Box colour" className="flex flex-wrap items-center gap-2">
          {presets.map((preset) => (
            <label
              key={preset.colour}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-rule px-2 py-1 has-checked:border-accent has-checked:bg-accent-wash has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name="box-colour"
                checked={appearance.colour === preset.colour}
                onChange={() => onAppearance({ ...appearance, colour: preset.colour })}
                className="sr-only"
              />
              <span className="size-3.5 rounded-sm border border-ink-muted" style={{ background: preset.colour }} />
              {preset.label}
            </label>
          ))}
          <label
            className={`flex items-center gap-1.5 rounded border px-2 py-1 ${custom ? "border-accent bg-accent-wash" : "border-rule"}`}
          >
            <input
              type="color"
              aria-label="Custom colour"
              value={appearance.colour}
              onChange={(event) => onAppearance({ ...appearance, colour: event.target.value })}
              className="size-4 cursor-pointer border-0 bg-transparent p-0"
            />
            Custom
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={appearance.label}
            onChange={(event) => onAppearance({ ...appearance, label: event.target.checked })}
            className="size-4 shrink-0 accent-accent"
          />
          Print the type in each box, like [PERSON]
        </label>
      </div>
    </>
  );
}

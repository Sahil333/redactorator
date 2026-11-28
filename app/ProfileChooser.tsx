import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Result } from "../engine/api/errors";
import { countries, industries, packNames, type PackId, type Profile } from "../engine/model/detection";
import { identifierPacks } from "../engine/model/identifiers";
import { markTypeLabel } from "../engine/model/markTypes";
import { errorText } from "./errors";

/** The names of the identifiers each pack adds, in the design's order. */
const addedNames = new Map<PackId, string[]>();
for (const [type, pack] of Object.entries(identifierPacks)) addedNames.set(pack, [...(addedNames.get(pack) ?? []), markTypeLabel(type)]);

const namesOf = (pack: PackId) => addedNames.get(pack) ?? [];

/** "a, b and c". */
function inWords(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * Whose choice the chooser makes: the project's, which is stored, or one run's, which replaces the
 * project's for that run only. Either starts from the project's profile.
 */
type ChooserPurpose = "project" | "run";

const submitLabel: Record<ChooserPurpose, string> = { project: "Save", run: "Run Auto mode" };

interface ProfileChooserProps {
  readonly purpose: ChooserPurpose;
  /** The project's profile; undefined while it has none, and then nothing is selected. */
  readonly profile: Profile | undefined;
  /** Takes the answer; a refusal keeps the chooser open with its sentence. */
  readonly onChoose: (profile: Profile) => Result<void>;
  readonly onClose: () => void;
}

/** Asks which countries and industries Auto mode looks for, and lists what each choice adds. Nothing selected is an answer too. */
export function ProfileChooser({ purpose, profile, onChoose, onClose }: ProfileChooserProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [chosen, setChosen] = useState<ReadonlySet<PackId>>(() => new Set([...(profile?.countries ?? []), ...(profile?.industries ?? [])]));
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    // Chrome gives the opened dialog's focus to the choices' scrolling area, which no key acts on.
    dialog?.querySelector("input")?.focus();
  }, []);

  function onToggle(pack: PackId, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(pack);
      else next.delete(pack);
      return next;
    });
  }

  function onSubmit(event: FormEvent) {
    // Never submitted for real: the page's policy allows no form actions.
    event.preventDefault();
    const chose = onChoose({ countries: countries.filter((pack) => chosen.has(pack)), industries: industries.filter((pack) => chosen.has(pack)) });
    // Closing the dialog, rather than only unmounting it, returns focus to the button that opened it.
    if (chose.ok) dialogRef.current?.close();
    else setRefusal(errorText(chose.error));
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[36rem] max-w-[calc(100vw-2rem)] rounded-lg border border-rule bg-paper-raised text-ink shadow-[0_8px_32px_rgb(31_27_22/0.24)] backdrop:bg-ink/30"
    >
      {/* Only the choices scroll, so the title and the buttons stay in view on a short screen. */}
      <form onSubmit={onSubmit} className="flex max-h-[calc(100vh-2rem)] flex-col">
        <h2 id={titleId} className="px-5 pt-5 pb-3 font-display font-semibold text-lg">
          What should Auto mode look for?
        </h2>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-1">
          <p className="text-ink-muted">Every run looks for {inWords(namesOf("universal"))}, whatever you choose.</p>
          <ChoiceGroup legend="Countries" packs={countries} chosen={chosen} onToggle={onToggle} />
          <ChoiceGroup legend="Industries" packs={industries} chosen={chosen} onToggle={onToggle} />
        </div>
        {refusal !== undefined && (
          <p role="alert" className="mx-5 mt-3 rounded-md border border-mark/40 bg-fail-wash px-3 py-2 text-mark">
            {refusal}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-rule px-5 pt-3 pb-5 mt-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk">
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-ink px-3.5 py-1.5 text-paper hover:bg-ink/85">
            {submitLabel[purpose]}
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface ChoiceGroupProps {
  readonly legend: string;
  readonly packs: readonly PackId[];
  readonly chosen: ReadonlySet<PackId>;
  readonly onToggle: (pack: PackId, on: boolean) => void;
}

function ChoiceGroup({ legend, packs, chosen, onToggle }: ChoiceGroupProps) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2 font-semibold">{legend}</legend>
      {packs.map((pack) => (
        <Choice key={pack} pack={pack} checked={chosen.has(pack)} onChange={(on) => onToggle(pack, on)} />
      ))}
    </fieldset>
  );
}

/** One choice, with the identifiers it adds written out under it and read as its description. */
function Choice({ pack, checked, onChange }: { readonly pack: PackId; readonly checked: boolean; readonly onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2">
      <input
        id={`${id}-box`}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-adds`}
        className="size-4 shrink-0 translate-y-0.5 accent-accent"
      />
      <label htmlFor={`${id}-box`} className="font-medium">
        {packNames[pack]}
      </label>
      <p id={`${id}-adds`} className="col-start-2 text-sm text-ink-muted">
        Adds: {namesOf(pack).join(", ")}
      </p>
    </div>
  );
}

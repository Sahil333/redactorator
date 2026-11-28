import { useState } from "react";
import type { Result } from "../engine/api/errors";
import type { Profile } from "../engine/model/detection";
import { ProfileChooser } from "./ProfileChooser";

/** What the Auto mode controls need: the project's profile, and how to set it. */
export interface Auto {
  /** Undefined until the user chooses. */
  readonly profile: Profile | undefined;
  readonly onSetProfile: (profile: Profile) => Result<void>;
}

/** Auto mode's controls in the top bar: for now, the entry that opens the chooser for the project. */
export function AutoControls({ profile, onSetProfile }: Auto) {
  const [choosing, setChoosing] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setChoosing(true)} className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk">
        What to look for
      </button>
      {choosing && <ProfileChooser purpose="project" profile={profile} onChoose={onSetProfile} onClose={() => setChoosing(false)} />}
    </>
  );
}

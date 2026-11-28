import { useEffect, useRef, useState } from "react";
import type { Result } from "../engine/api/errors";
import type { Profile } from "../engine/model/detection";
import { Menu, MenuItem } from "./Menu";
import { ProfileChooser } from "./ProfileChooser";
import { runLine } from "./RunNotices";
import type { Findings } from "./useFindings";

/** What the Auto mode controls need: the project's profile, how to set it, and the runs. */
export interface Auto {
  /** Undefined until the user chooses. */
  readonly profile: Profile | undefined;
  readonly onSetProfile: (profile: Profile) => Result<void>;
  readonly findings: Findings;
}

const done: Result<void> = { ok: true, value: undefined };

/** Which chooser is open: the project's from its entry, or one run's from the Run control. */
type Choosing = "project" | "this-run" | undefined;

/**
 * Auto mode's controls in the top bar: the entry that opens the chooser for the project, and the
 * Run control. While a run is under way the control counts its pages and offers Stop.
 */
export function AutoControls({ profile, onSetProfile, findings }: Auto) {
  const [choosing, setChoosing] = useState<Choosing>(undefined);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setChoosing("project")} className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk">
        What to look for
      </button>
      <RunControl findings={findings} onThisRun={() => setChoosing("this-run")} />
      {choosing === "project" && <ProfileChooser purpose="project" profile={profile} onChoose={onSetProfile} onClose={() => setChoosing(undefined)} />}
      {choosing === "this-run" && (
        <ProfileChooser
          purpose="run"
          profile={profile}
          onChoose={(chosen) => {
            findings.run(chosen);
            return done;
          }}
          onClose={() => setChoosing(undefined)}
        />
      )}
      {findings.asking && (
        <ProfileChooser
          purpose="run"
          profile={undefined}
          onChoose={(chosen) => {
            const set = onSetProfile(chosen);
            if (set.ok) findings.run();
            return set;
          }}
          onClose={findings.onAsked}
        />
      )}
    </>
  );
}

interface RunControlProps {
  readonly findings: Findings;
  readonly onThisRun: () => void;
}

/**
 * Run and its menu, or, during a run, the page counter and Stop. Focus left with nowhere to go,
 * as the button pressed is replaced, moves to the one that takes its place.
 */
function RunControl({ findings, onThisRun }: RunControlProps) {
  const { here, running } = findings;
  const canRun = here?.can.run === true;
  const runRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const line = running === undefined ? (findings.refusal ?? (here && runLine(here))) : `Searching page ${running.page} of ${running.pages}`;

  const idle = running === undefined;
  const wasIdle = useRef(idle);
  useEffect(() => {
    if (wasIdle.current === idle) return;
    wasIdle.current = idle;
    if (document.activeElement === document.body) (idle ? runRef : stopRef).current?.focus();
  }, [idle]);

  return (
    <div className="flex items-center gap-2">
      {idle ? (
        <div role="group" aria-label="Auto mode" className="flex items-center rounded-md border border-rule">
          <button ref={runRef} type="button" disabled={!canRun} onClick={() => findings.run()} className="rounded-l-md px-3 py-1.5 enabled:hover:bg-paper-sunk disabled:opacity-40">
            Run Auto mode
          </button>
          <Menu label="Run options" disabled={!canRun}>
            <MenuItem label="For this run only" onSelect={onThisRun} />
          </Menu>
        </div>
      ) : (
        <button ref={stopRef} type="button" onClick={findings.stop} className="rounded-md border border-rule px-3 py-1.5 hover:bg-paper-sunk">
          Stop
        </button>
      )}
      {/* Not a status: the top bar's page status is the view's only one. */}
      <span aria-live="polite" className="text-ink-muted">
        {line}
      </span>
    </div>
  );
}

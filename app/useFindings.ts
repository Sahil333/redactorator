import { useState } from "react";
import type { Session } from "../engine/api/facade";
import type { DocumentDetection, SessionState } from "../engine/api/state";
import type { Profile } from "../engine/model/detection";
import type { DocumentId } from "../engine/model/project";
import { errorText } from "./errors";

/** Auto mode as the app shows it: the open document's run and findings review, and the project's run in progress. */
export interface Findings {
  /** The open document's; undefined while none is open. */
  readonly here: DocumentDetection | undefined;
  /** The run in progress in the project, on whichever document. */
  readonly running: { readonly document: DocumentId; readonly page: number; readonly pages: number } | undefined;
  /** Why the open document's last Run was refused. */
  readonly refusal: string | undefined;
  /** The first Run on a project with no profile: the chooser asks for one, then the run starts. */
  readonly asking: boolean;
  /** Runs Auto mode on the open document; `profile` replaces the project's for this run only. */
  readonly run: (profile?: Profile) => void;
  readonly onAsked: () => void;
  readonly stop: () => void;
}

function runningIn(detection: SessionState["detection"]): Findings["running"] {
  for (const [document, { run }] of detection) if (run.state === "running") return { document, page: run.page, pages: run.pages };
  return undefined;
}

/** Reads Auto mode's state for the open document `active`, and wraps the Session's commands. */
export function useFindings(session: Session, detection: SessionState["detection"], active: DocumentId | undefined): Findings {
  const [refused, setRefused] = useState<{ readonly document: DocumentId; readonly text: string } | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const running = runningIn(detection);

  function run(profile?: Profile) {
    if (active === undefined) return;
    setRefused(undefined);
    void session.detection.run(active, profile).then((ran) => {
      if (ran.ok) return;
      if (ran.error.code === "no-profile") setAsking(true);
      const text = errorText(ran.error);
      if (text !== undefined) setRefused({ document: active, text });
    });
  }

  return {
    here: active === undefined ? undefined : detection.get(active),
    running,
    refusal: refused?.document === active ? refused?.text : undefined,
    asking,
    run,
    onAsked: () => setAsking(false),
    stop: () => {
      if (running !== undefined) session.detection.stop(running.document);
    },
  };
}

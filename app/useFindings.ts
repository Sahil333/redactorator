import { useState } from "react";
import type { Session } from "../engine/api/facade";
import type { DocumentDetection, SessionState } from "../engine/api/state";
import type { EngineError, Result } from "../engine/api/errors";
import type { Profile } from "../engine/model/detection";
import type { DocumentId } from "../engine/model/project";
import { errorText } from "./errors";

/** The open document's findings review, and what the findings panel does with it. */
export interface OpenReview extends NonNullable<DocumentDetection["findings"]> {
  readonly canConfirm: boolean;
  readonly canClose: boolean;
  readonly setTicked: (key: string, ticked: boolean) => void;
  /** Marks the ticked values and rejects the others; the panel has asked first. */
  readonly confirm: () => void;
  /** Ends the findings review, keeping nothing; the panel has asked first. */
  readonly close: () => void;
}

/** Auto mode as the app shows it: the open document's run and findings review, and the project's run in progress. */
export interface Findings {
  /** The open document's; undefined while none is open. */
  readonly here: DocumentDetection | undefined;
  /** The run in progress in the project, on whichever document. */
  readonly running: { readonly document: DocumentId; readonly page: number; readonly pages: number } | undefined;
  /** The open document's findings review; undefined while none is open. */
  readonly review: OpenReview | undefined;
  /** Why the open document's last Run, Confirm or Close was refused. */
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

  const here = active === undefined ? undefined : detection.get(active);

  /** Tells the user why a command on `document` was refused, when the app has a sentence for it. */
  function refusedOn(document: DocumentId, error: EngineError) {
    const text = errorText(error);
    if (text !== undefined) setRefused({ document, text });
  }

  function run(profile?: Profile) {
    if (active === undefined) return;
    setRefused(undefined);
    void session.detection.run(active, profile).then((ran) => {
      if (ran.ok) return;
      if (ran.error.code === "no-profile") setAsking(true);
      refusedOn(active, ran.error);
    });
  }

  /** Runs `command` on the open document, after clearing the last refusal. */
  function ending(command: (document: DocumentId) => Promise<Result<unknown>>) {
    if (active === undefined) return;
    setRefused(undefined);
    void command(active).then((result) => {
      if (!result.ok) refusedOn(active, result.error);
    });
  }

  const open = here?.findings;
  const review: OpenReview | undefined = open && {
    ...open,
    canConfirm: here.can.confirm,
    canClose: here.can.close,
    setTicked: (key, ticked) => {
      if (active !== undefined) session.findings.setTicked(active, key, ticked);
    },
    confirm: () => ending(session.findings.confirm),
    close: () => ending(session.findings.close),
  };

  return {
    here,
    running,
    review,
    refusal: refused?.document === active ? refused?.text : undefined,
    asking,
    run,
    onAsked: () => setAsking(false),
    stop: () => {
      if (running !== undefined) session.detection.stop(running.document);
    },
  };
}

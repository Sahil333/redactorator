import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { DocumentId } from "../../../model/project";
import type { DetectionClient } from "../../detect-client/client";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";
import type { ReadingSource } from "./readings";

/** What a run of Auto mode uses: the Session's state and gate, its project's stored page texts, how changes land, and the detection worker. */
interface DetectionHost {
  readonly source: ReadingSource;
  view(): SessionView | undefined;
  allowed(command: "run" | "stop", document?: DocumentId): Result<SessionView>;
  dispatch(change: SessionChange, ...effects: (() => void)[]): void;
  /** Dispatches a change to the project record, which saves it. */
  change(change: SessionChange): void;
  readonly client: DetectionClient;
}

const notStarted: Result<never> = { ok: false, error: { code: "detector-not-started" } };

/** Runs of Auto mode, behind the gate. No detection worker exists yet, so no run starts. */
export function detectionOf({ allowed }: DetectionHost): Session["detection"] {
  return {
    run(document, profile) {
      const at = allowed("run", document);
      if (!at.ok) return at;
      if ((profile ?? at.value.parts.record.present.project.profile) === undefined) return { ok: false, error: { code: "no-profile" } };
      return notStarted;
    },
    stop(document) {
      const at = allowed("stop", document);
      return at.ok ? notStarted : at;
    },
  };
}

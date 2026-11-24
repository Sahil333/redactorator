import { useState } from "react";
import type { Engine } from "../engine/api/facade";
import type { EngineState } from "../engine/api/state";
import { errorText } from "./errors";

/**
 * A problem the app found itself, and the engine's revision when it did. The newer of it and the
 * engine's problems shows. Without text it shows nothing over older engine problems, as a change
 * that succeeds clears them; `at` -1 leaves them shown.
 */
interface OwnProblem {
  readonly text: string | undefined;
  readonly at: number;
}

const noOwnProblem: OwnProblem = { text: undefined, at: -1 };

/** The one problem slot the app shows, outside the worker's own error: the app's problem or the engine's. */
export function useProblem(engine: Engine | undefined) {
  const [own, setOwn] = useState<OwnProblem>(noOwnProblem);
  return {
    /** Shows `text`; undefined clears every problem shown so far. Stamped with the engine's revision now, not this render's. */
    raise: (text: string | undefined) => setOwn({ text, at: engine?.getState().revision ?? 0 }),
    /** Drops the app's own problem, leaving the engine's shown. */
    drop: () => setOwn(noOwnProblem),
    /** The newer of the app's own problem and the engine's newest, which are joined when raised together. */
    shown(state: EngineState | undefined): string | undefined {
      const problems = state?.problems ?? [];
      const newest = Math.max(-1, ...problems.map((problem) => problem.raisedAt));
      if (own.at >= newest) return own.text;
      return problems
        .filter((problem) => problem.raisedAt === newest)
        .flatMap((problem) => errorText(problem.error) ?? [])
        .join(" ");
    },
  };
}

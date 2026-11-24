import { useSyncExternalStore } from "react";
import type { Engine } from "../engine/api/facade";
import type { EngineState } from "../engine/api/state";

const unstarted = () => undefined;
const nothingToWatch = () => () => undefined;

/** The engine's state, rendering again on each change; undefined until the engine is started. */
export function useEngineState(engine: Engine | undefined): EngineState | undefined {
  return useSyncExternalStore(engine?.subscribe ?? nothingToWatch, engine?.getState ?? unstarted);
}

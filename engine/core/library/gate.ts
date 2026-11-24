import type { ErrorCode } from "../../api/errors";
import type { LibraryState } from "../../api/state";
import type { LibraryView } from "./host";

/** The Library's commands, by what the gate asks of each. */
type LibraryCommand = "open" | "create" | "manage" | "import" | "check" | "switchTo" | "settings";

/** Why `command` is refused now, or undefined when it may run. */
export function gate({ library, worker, session }: LibraryView, command: LibraryCommand): ErrorCode | undefined {
  // A project opened or changed while projects move could be left behind in the old store.
  const { phase } = library.place;
  if (phase === "moving" || phase === "opening") return "busy-moving";
  if (session !== undefined && (command === "open" || command === "create" || command === "switchTo")) return "session-open";
  if ((command === "create" || command === "import") && worker.status !== "ready") return "worker-not-ready";
  return undefined;
}

/** What Home may offer: each command the gate allows, once there is a list to offer it on. */
export function can(view: LibraryView): LibraryState["can"] {
  const listed = view.library.list.projects !== undefined;
  const allows = (command: LibraryCommand) => listed && gate(view, command) === undefined;
  return { create: allows("create"), open: allows("open"), manage: allows("manage"), import: allows("import") };
}

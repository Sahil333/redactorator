import type { ErrorCode } from "../../api/errors";
import type { LibraryState } from "../../api/state";
import type { LibraryView } from "./host";

/** The Library's commands, by what the gate asks of each. */
type LibraryCommand = "open" | "create" | "manage" | "import" | "check" | "switchTo" | "settings";

/** Why `command` is refused now, or undefined when it may run. */
export function gate({ library, session }: LibraryView, command: LibraryCommand): ErrorCode | undefined {
  // A project opened or changed while projects move could be left behind in the old store.
  const { phase } = library.place;
  if (phase === "moving" || phase === "opening") return "busy-moving";
  if (session !== undefined && (command === "open" || command === "create" || command === "switchTo")) return "session-open";
  return undefined;
}

/**
 * What Home may offer: each command the gate allows, once there is a list to offer it on. Adding
 * and importing are offered only while the PDF worker is ready, though files chosen before then
 * wait for it.
 */
export function can(view: LibraryView): LibraryState["can"] {
  const listed = view.library.list.projects !== undefined;
  const allows = (command: LibraryCommand) => listed && gate(view, command) === undefined;
  const ready = view.worker.status === "ready";
  return { create: ready && allows("create"), open: allows("open"), manage: allows("manage"), import: ready && allows("import") };
}

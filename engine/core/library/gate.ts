import type { ErrorCode } from "../../api/errors";
import type { LibraryState } from "../../api/state";
import type { LibraryView } from "./host";

/** The Library's commands, by what the gate asks of each. `manage` is rename, duplicate, archive and remove. */
type LibraryCommand = "open" | "create" | "manage" | "import" | "check" | "switchTo" | "settings";

/** Why `command` is refused now, or undefined when it may run. `projectId`: the project a `manage` command changes. */
export function gate({ library, session }: LibraryView, command: LibraryCommand, projectId?: string): ErrorCode | undefined {
  // A project opened or changed while projects move could be left behind in the old store.
  const { phase } = library.place;
  if (phase === "moving" || phase === "opening") return "busy-moving";
  // A store still loading may yet have projects moved into it, under folder names a new project could take too.
  if (phase === "loading" && (command === "create" || command === "import")) return "busy-moving";
  if (session !== undefined && (command === "open" || command === "create" || command === "switchTo")) return "session-open";
  // A project being made is written into the store in use, which a folder chosen now would leave behind.
  if (library.settings.creating && (command === "open" || command === "create" || command === "switchTo")) return "busy-creating";
  // This engine's own Session holds the lock, which would otherwise read as another tab's.
  if (command === "manage" && session !== undefined && session.project.id === projectId) return "open-here";
  return undefined;
}

/**
 * What Home may offer: each command the gate allows, once there is a list to offer it on. Adding
 * and importing are offered only while the PDF worker is ready, though files chosen before then
 * wait for it, and not while files are being made into a project.
 */
export function can(view: LibraryView): LibraryState["can"] {
  const listed = view.library.list.projects !== undefined;
  const allows = (command: LibraryCommand) => listed && gate(view, command) === undefined;
  const free = view.worker.status === "ready" && !view.library.settings.creating;
  return {
    create: free && allows("create"),
    open: allows("open"),
    manage: allows("manage"),
    import: free && allows("import"),
    // A folder can be chosen before any list, as when the remembered one is missing.
    switchTo: gate(view, "switchTo") === undefined,
  };
}

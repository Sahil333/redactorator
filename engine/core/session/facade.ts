import type { Session } from "../../api/facade";
import type { Project } from "../../model/project";
import type { Store } from "../../storage/store";
import type { LockHold } from "../ports";

/** The open Session, and the project as it was read when it opened, in the store and folder it lives in. */
export interface OpenSession {
  readonly session: Session;
  readonly store: Store;
  readonly folder: string;
  readonly project: Project;
}

/**
 * A Session holding `hold` on the project until it closes. Closing lets the lock go, then runs
 * `closed`, the Library's part.
 */
export function openSession(opening: Omit<OpenSession, "session">, hold: LockHold, closed: () => Promise<void>): OpenSession {
  let open = true;
  const session: Session = {
    projectId: opening.project.id,
    async close() {
      if (!open) return { ok: false, error: { code: "session-closed" } };
      open = false;
      hold.release();
      await closed();
      return { ok: true, value: undefined };
    },
  };
  return { ...opening, session };
}

import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";

/** What setting the profile uses: the Session's gate, and how a change to the project record lands. */
interface ProfileHost {
  allowed(command: "profile"): Result<SessionView>;
  /** Dispatches a change to the project record, which saves it. */
  change(change: SessionChange): void;
}

/** The project's profile, behind the gate. Setting it is not undone, and puts no document back in review. */
export function profileOf({ allowed, change }: ProfileHost): Session["profile"] {
  return {
    set(profile) {
      const at = allowed("profile");
      if (!at.ok) return at;
      change({ type: "profileSet", profile });
      return { ok: true, value: undefined };
    },
  };
}

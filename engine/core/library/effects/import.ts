import type { ErrorCode, Result } from "../../../api/errors";
import type { Store } from "../../../storage/store";
import { importProject } from "../../stored/projects";
import type { LibraryHost } from "../host";
import { refresh } from "./refresh";

const notImported = { projects: "import-projects", missing: "import-missing", damaged: "import-damaged", newer: "import-newer" } as const satisfies Record<
  NonNullable<Awaited<ReturnType<typeof importProject>>>,
  ErrorCode
>;

/** Copies the project folder `from` into `into`, then lists the projects again. */
export async function importInto(host: LibraryHost, from: Store, into: Store): Promise<Result<void>> {
  let code: ErrorCode | undefined;
  try {
    const why = await importProject(from, into);
    code = why && notImported[why];
  } catch {
    code = "import-failed";
  }
  if (code === undefined) host.dispatch({ type: "imported" });
  await refresh(host);
  return code === undefined ? { ok: true, value: undefined } : { ok: false, error: { code } };
}

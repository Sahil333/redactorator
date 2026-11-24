import type { Result } from "../../../api/errors";
import { toEdits } from "../../../model/marks";
import type { PdfClient } from "../../pdf-client/client";
import type { OutputTag, SessionChange } from "../changes";
import type { SessionView } from "../gate";

/**
 * Writes and checks the open document's cleaned file from its marks as they are now, tagged with
 * what it was written from, so a change made while it is written leaves it out of date.
 * `view` is the Session as the gate allowed the apply, with a document open.
 */
export function applyOutput(view: SessionView, client: Pick<PdfClient, "apply">, dispatch: (change: SessionChange, ...effects: (() => void)[]) => void): Promise<Result<void>> {
  const { handle } = view.parts.viewer;
  const { project, edits } = view.parts.record.present;
  const document = project.documents.find(({ id }) => id === handle?.document);
  if (document === undefined) return Promise.resolve({ ok: false, error: { code: "stale-handle" } });
  const tag: OutputTag = { document: document.id, edits: edits.get(document.id) ?? 0, appearance: view.settings.appearance };
  const written = document.marks.flatMap(toEdits);
  async function run(): Promise<Result<void>> {
    const applied = await client.apply(written, tag.appearance);
    if ("code" in applied) {
      dispatch({ type: "applyFailed" });
      return { ok: false, error: applied };
    }
    dispatch({ type: "applied", tag, bytes: applied.bytes, shown: { document: tag.document, pages: applied.model.pages } });
    return { ok: true, value: undefined };
  }
  return new Promise((resolve) => dispatch({ type: "applyStarted" }, () => resolve(run())));
}

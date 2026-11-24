import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EngineError } from "../engine/api/errors";
import type { Session } from "../engine/api/facade";
import type { DocumentHandle } from "../engine/api/state";
import type { DocumentId, ProjectDocument } from "../engine/model/project";
import { errorText } from "./errors";

/**
 * Opens the shown tab's document in the PDF worker. `shown` is the open document once it is that
 * tab's, and undefined until then; `missing` says why its original could not be read. While
 * `canOpen` is false (another operation runs), a newly shown document waits to open.
 */
export function useDocumentInEngine(
  session: Session,
  open: DocumentHandle | undefined,
  document: ProjectDocument | undefined,
  canOpen: boolean,
  onFailure: { readonly failed: (error: EngineError) => void; readonly clear: () => void },
) {
  const [missing, setMissing] = useState<string | undefined>(undefined);
  const asked = useRef<DocumentId | undefined>(undefined);
  const shown = document !== undefined && open?.document === document.id ? open : undefined;

  const ask = useEffectEvent(() => {
    if (document === undefined) {
      asked.current = undefined;
      setMissing(undefined);
      return;
    }
    if (!canOpen || asked.current === document.id) return;
    const { id } = document;
    asked.current = id;
    setMissing(undefined);
    onFailure.clear();
    void session.viewer.open(id).then((result) => {
      if (result.ok || asked.current !== id) return;
      if (result.error.code === "original-missing") setMissing(errorText(result.error));
      else onFailure.failed(result.error);
    });
  });

  useEffect(() => ask(), [document?.id, canOpen]);

  return { shown, missing };
}

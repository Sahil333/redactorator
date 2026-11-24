import { useEffect, useEffectEvent, useState } from "react";
import type { ProjectDocument } from "../engine/model/project";
import { readOriginal } from "./projects";
import type { Store } from "../engine/storage/store";
import type { Engine, OpenDocument } from "./useEngine";

/**
 * Opens the shown tab's document in the engine. `shown` is the engine's document once it is
 * that tab's, and undefined until then; `missing` says why its original could not be read.
 */
export function useDocumentInEngine(store: Store, folder: string, document: ProjectDocument | undefined, engine: Engine) {
  const [missing, setMissing] = useState<string | undefined>(undefined);
  const opened = engine.document;
  const shown: OpenDocument | undefined =
    opened !== undefined && opened.name === document?.file && opened.sha256 === document.sha256 ? opened : undefined;

  const open = useEffectEvent((isCurrent: () => boolean) => {
    setMissing(undefined);
    if (document === undefined) return;
    const { file, sha256 } = document;
    readOriginal(store, folder, document).then(
      (bytes) => {
        if (isCurrent()) engine.open({ name: file, bytes, sha256 });
      },
      () => {
        if (isCurrent()) setMissing(`${file} is missing from the project's folder, so it can't be shown. Add the file again with Add documents.`);
      },
    );
  });

  useEffect(() => {
    let current = true;
    open(() => current);
    return () => {
      current = false;
    };
  }, [document?.id]);

  return { shown, missing };
}

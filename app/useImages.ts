import { useEffect, useEffectEvent, useState } from "react";
import type { PlacedImage } from "../engine/model/document";
import { imagesOf } from "./documentReadings";
import type { DocumentId, ProjectDocument } from "../engine/model/project";
import type { StoredFiles } from "../engine/host-browser/interim";
import type { Store } from "../engine/storage/store";
import type { PdfEngine } from "./useEngine";

/** The open document's images that a box can spread over, once read from the project; undefined until then, or when unknown. */
export function useImages(files: StoredFiles, store: Store, folder: string, document: ProjectDocument | undefined, engine: Pick<PdfEngine, "inspect">) {
  const [read, setRead] = useState<{ readonly id: DocumentId; readonly images: readonly PlacedImage[] | undefined } | undefined>(undefined);

  const load = useEffectEvent((isCurrent: () => boolean) => {
    if (document === undefined) return;
    const { id } = document;
    // Unread, the images are only not shown as such; spreading reads them again.
    imagesOf(files, store, folder, document, engine).then(
      (images) => {
        if (isCurrent()) setRead({ id, images });
      },
      () => undefined,
    );
  });

  useEffect(() => {
    let current = true;
    load(() => current);
    return () => {
      current = false;
    };
  }, [document?.id]);

  return read !== undefined && read.id === document?.id ? read.images : undefined;
}

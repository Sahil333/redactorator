import { useEffect, useEffectEvent, useState } from "react";
import type { Session } from "../engine/api/facade";
import type { PlacedImage } from "../engine/model/document";
import type { DocumentId } from "../engine/model/project";

/** The open document's images that a box can spread over, once read from the project; undefined until then, or when unknown. */
export function useImages(session: Session, document: DocumentId | undefined) {
  const [read, setRead] = useState<{ readonly id: DocumentId; readonly images: readonly PlacedImage[] | undefined } | undefined>(undefined);

  const load = useEffectEvent((isCurrent: () => boolean) => {
    if (document === undefined) return;
    void session.viewer.images(document).then((images) => {
      if (isCurrent() && images.ok) setRead({ id: document, images: images.value });
    });
  });

  useEffect(() => {
    let current = true;
    load(() => current);
    return () => {
      current = false;
    };
  }, [document]);

  return read !== undefined && read.id === document ? read.images : undefined;
}

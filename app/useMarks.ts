import { useState } from "react";
import type { Session } from "../engine/api/facade";
import type { DocumentHandle } from "../engine/api/state";
import type { Mark } from "../engine/model/marks";
import { builtInMarkTypes, customMarkType, type MarkType, type MarkTypeOption } from "../engine/model/markTypes";
import type { Pending } from "./marks";

export type Marks = ReturnType<typeof useMarks>;

/**
 * The open document's marks, the new mark waiting for its type, and the types on offer.
 * The marks belong to the project; the Session changes them.
 */
export function useMarks(session: Session, handle: DocumentHandle | undefined, marks: readonly Mark[], customTypes: readonly string[]) {
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [highlighted, setHighlighted] = useState<Mark["id"] | undefined>(undefined);
  const [lastType, setLastType] = useState<MarkType>("person");
  const documentKey = handle?.document;
  const [shownKey, setShownKey] = useState(documentKey);
  if (shownKey !== documentKey) {
    setShownKey(documentKey);
    setPending(undefined);
    setHighlighted(undefined);
  }
  const typeOptions = [...builtInMarkTypes, ...customTypes.map(customMarkType)];

  function add(type: MarkTypeOption) {
    if (pending === undefined || handle === undefined) return;
    setLastType(type.id);
    const added = session.marks.add({ handle, type: type.id, target: pending.target });
    setPending(undefined);
    // Highlighted, a new mark shows its type until the pointer or the marks panel moves on.
    if (added.ok) setHighlighted(added.value.markId);
  }

  return {
    marks,
    pending,
    highlighted,
    typeOptions,
    lastType,
    propose: setPending,
    cancel: () => setPending(undefined),
    add,
    /** A value has one type, so retyping a mark retypes its item. */
    retype: (mark: Mark, type: MarkTypeOption) => {
      setLastType(type.id);
      if (documentKey !== undefined) session.marks.retype(documentKey, mark.id, type.id);
    },
    /** Stops hiding a mark's item here, every place of it; approving stops it everywhere. */
    remove: (removed: Mark) => {
      if (documentKey !== undefined) session.marks.remove(documentKey, removed.id);
    },
    link: (mark: Mark, linkId: string) => {
      if (documentKey !== undefined) session.labelling.link(documentKey, mark.id, linkId);
    },
    highlight: setHighlighted,
  };
}

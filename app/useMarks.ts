import { useRef, useState } from "react";
import type { Mark, Pending } from "./marks";
import { builtInMarkTypes, type MarkType, type MarkTypeOption } from "./markTypes";

export type Marks = ReturnType<typeof useMarks>;

/**
 * The marks on the open document, the new mark waiting for its type, and the types on offer.
 * `onChange` runs before any change that alters what an apply would write.
 */
export function useMarks(onChange: () => void) {
  const nextId = useRef(1);
  const [marks, setMarks] = useState<readonly Mark[]>([]);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [highlighted, setHighlighted] = useState<Mark["id"] | undefined>(undefined);
  const [customTypes, setCustomTypes] = useState<readonly MarkTypeOption[]>([]);
  const [lastType, setLastType] = useState<MarkType>("person");
  const typeOptions = [...builtInMarkTypes, ...customTypes];

  function rememberType(type: MarkTypeOption) {
    setLastType(type.id);
    if (!typeOptions.some((option) => option.id === type.id)) setCustomTypes((current) => [...current, type]);
  }

  function change(update: (current: readonly Mark[]) => readonly Mark[]) {
    onChange();
    setMarks(update);
  }

  function add(type: MarkTypeOption) {
    if (pending === undefined) return;
    rememberType(type);
    setMarks((current) => [...current, { id: nextId.current++, type: type.id, linkId: "", ...pending }]);
    setPending(undefined);
  }

  function retype(mark: Mark, type: MarkTypeOption) {
    rememberType(type);
    change((current) => current.map((each) => (each === mark ? { ...each, type: type.id } : each)));
  }

  return {
    marks,
    pending,
    highlighted,
    typeOptions,
    lastType,
    clear: () => {
      setMarks([]);
      setPending(undefined);
    },
    propose: setPending,
    cancel: () => setPending(undefined),
    add,
    retype,
    remove: (removed: Mark) => change((current) => current.filter((mark) => mark !== removed)),
    // A link id is labelling data only: it changes nothing an apply writes.
    link: (mark: Mark, linkId: string) =>
      setMarks((current) => current.map((each) => (each === mark ? { ...each, linkId } : each))),
    highlight: setHighlighted,
  };
}

import { useState } from "react";
import type { Mark, Pending } from "./marks";
import { builtInMarkTypes, customMarkType, type MarkType, type MarkTypeOption } from "./markTypes";

export type Marks = ReturnType<typeof useMarks>;

/**
 * How a change to the marks is kept. An `edit` alters what an apply would write and can be
 * undone; a `label` is labelling data only.
 */
export type MarksChange = (update: (current: readonly Mark[]) => readonly Mark[], kind: "edit" | "label") => void;

const nextId = (marks: readonly Mark[]) => Math.max(0, ...marks.map((mark) => mark.id)) + 1;

/**
 * The open document's marks, the new mark waiting for its type, and the types on offer.
 * The marks themselves belong to the project; this hook changes them through `change`.
 */
export function useMarks(
  /** Names the open document: a new one starts with no pending mark or highlight. */
  documentKey: string | undefined,
  marks: readonly Mark[],
  change: MarksChange,
  customTypes: readonly string[],
  onCustomType: (name: string) => void,
) {
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [highlighted, setHighlighted] = useState<Mark["id"] | undefined>(undefined);
  const [lastType, setLastType] = useState<MarkType>("person");
  const [shownKey, setShownKey] = useState(documentKey);
  if (shownKey !== documentKey) {
    setShownKey(documentKey);
    setPending(undefined);
    setHighlighted(undefined);
  }
  const typeOptions = [...builtInMarkTypes, ...customTypes.map(customMarkType)];

  function rememberType(type: MarkTypeOption) {
    setLastType(type.id);
    if (!typeOptions.some((option) => option.id === type.id)) onCustomType(type.label);
  }

  function add(type: MarkTypeOption) {
    if (pending === undefined) return;
    rememberType(type);
    const { target } = pending;
    change((current) => [...current, { id: nextId(current), type: type.id, linkId: "", target }], "edit");
    setPending(undefined);
  }

  function retype(mark: Mark, type: MarkTypeOption) {
    rememberType(type);
    change((current) => current.map((each) => (each.id === mark.id ? { ...each, type: type.id } : each)), "edit");
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
    retype,
    remove: (removed: Mark) => change((current) => current.filter((mark) => mark.id !== removed.id), "edit"),
    link: (mark: Mark, linkId: string) =>
      change((current) => current.map((each) => (each.id === mark.id ? { ...each, linkId } : each)), "label"),
    highlight: setHighlighted,
  };
}

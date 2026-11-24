import { useState } from "react";
import { itemKey, nextId, type Mark } from "../engine/model/marks";
import type { Pending } from "./marks";
import type { ChangeKind } from "./useProject";
import { builtInMarkTypes, customMarkType, type MarkType, type MarkTypeOption } from "../engine/model/markTypes";

export type Marks = ReturnType<typeof useMarks>;

export type MarksChange = (update: (current: readonly Mark[]) => readonly Mark[], kind: ChangeKind) => void;

const onItem = (mark: Mark, change: (each: Mark) => Mark) => (current: readonly Mark[]) =>
  current.map((each) => (itemKey(each) === itemKey(mark) ? change(each) : each));

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
    change((current) => [...current, { id: nextId(current), type: type.id, linkId: "", target, isNew: false }], "edit");
    setPending(undefined);
    // Highlighted, a new mark shows its type until the pointer or the marks panel moves on.
    setHighlighted(nextId(marks));
  }

  // A value has one type, so retyping a mark retypes its item.
  function retype(mark: Mark, type: MarkTypeOption) {
    rememberType(type);
    change(onItem(mark, (each) => ({ ...each, type: type.id })), "edit");
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
    /** Stops hiding a mark's item here, every place of it; approving stops it everywhere. */
    remove: (removed: Mark) => change((current) => current.filter((mark) => itemKey(mark) !== itemKey(removed)), "edit"),
    link: (mark: Mark, linkId: string) => change(onItem(mark, (each) => ({ ...each, linkId })), "label"),
    highlight: setHighlighted,
  };
}

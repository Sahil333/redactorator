import schema from "../../dataset/ground-truth.schema.json";

/** A type id from the ground-truth schema, or `custom:<name>` for a type the user typed. */
export type MarkType = string;

export interface MarkTypeOption {
  readonly id: MarkType;
  readonly label: string;
}

// DET-1's entity types and the three a drawn box needs, as the dataset schema lists them.
export const builtInMarkTypes: readonly MarkTypeOption[] = schema.$defs.entityType.oneOf.map((type) => ({
  id: type.const,
  label: type.title,
}));

const customPrefix = "custom:";

export const customMarkType = (name: string): MarkTypeOption => ({ id: `${customPrefix}${name}`, label: name });

export function markTypeLabel(type: MarkType): string {
  if (type.startsWith(customPrefix)) return type.slice(customPrefix.length);
  return builtInMarkTypes.find((option) => option.id === type)?.label ?? type;
}

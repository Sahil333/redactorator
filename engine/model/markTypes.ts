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

/** The name of a type the user typed, or undefined for a built-in type. */
export const customTypeName = (type: MarkType): string | undefined => (type.startsWith(customPrefix) ? type.slice(customPrefix.length) : undefined);

export function markTypeLabel(type: MarkType): string {
  return customTypeName(type) ?? builtInMarkTypes.find((option) => option.id === type)?.label ?? type;
}

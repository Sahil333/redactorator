import schema from "../../dataset/ground-truth.schema.json";

/** A type id from the ground-truth schema, or `custom:<name>` for a type the user typed. */
export type MarkType = string;

export interface MarkTypeOption {
  readonly id: MarkType;
  readonly label: string;
}

const optionsOf = (types: readonly { readonly const: string; readonly title: string }[]): readonly MarkTypeOption[] =>
  types.map((type) => ({ id: type.const, label: type.title }));

// DET-1's entity types and the three a drawn box needs, as the dataset schema lists them.
const generalMarkTypes = optionsOf(schema.$defs.generalType.oneOf);

/** The schema's types: the general ones, then the identifiers Auto mode finds that are not one of them. */
export const builtInMarkTypes: readonly MarkTypeOption[] = [...generalMarkTypes, ...optionsOf(schema.$defs.identifierType.oneOf)];

/** The ids of the general types, which the type picker lists first and outside any pack. */
export const generalTypeIds: ReadonlySet<MarkType> = new Set(generalMarkTypes.map((type) => type.id));

const customPrefix = "custom:";

export const customMarkType = (name: string): MarkTypeOption => ({ id: `${customPrefix}${name}`, label: name });

/** The name of a type the user typed, or undefined for a built-in type. */
export const customTypeName = (type: MarkType): string | undefined => (type.startsWith(customPrefix) ? type.slice(customPrefix.length) : undefined);

export function markTypeLabel(type: MarkType): string {
  return customTypeName(type) ?? builtInMarkTypes.find((option) => option.id === type)?.label ?? type;
}

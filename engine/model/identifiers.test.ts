import { expect, test } from "vitest";
import { identifierPacks } from "./identifiers";
import { builtInMarkTypes, generalTypeIds } from "./markTypes";

// The schema is the one list of type ids (decision D3), so a pack can only name a type it lists, and
// the type picker groups every identifier that is not a general type under its pack.
test("every identifier is a type in the dataset schema, and every type there that is not general is an identifier", () => {
  const schemaIds = builtInMarkTypes.map((type) => type.id);
  expect(Object.keys(identifierPacks).filter((id) => !schemaIds.includes(id))).toEqual([]);
  expect(schemaIds.filter((id) => !generalTypeIds.has(id) && !(id in identifierPacks))).toEqual([]);
});

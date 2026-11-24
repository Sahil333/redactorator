import type { LibraryChange } from "../changes";
import { list, noList, type ListPart } from "./list";
import { noPlace, place, type PlacePart } from "./place";
import { firstSettings, settings, type SettingsPart } from "./settings";

export interface LibraryParts {
  readonly list: ListPart;
  readonly place: PlacePart;
  readonly settings: SettingsPart;
}

export const firstLibrary: LibraryParts = { list: noList, place: noPlace, settings: firstSettings };

export function library(parts: LibraryParts, change: LibraryChange): LibraryParts {
  const next = { list: list(parts.list, change), place: place(parts.place, change), settings: settings(parts.settings, change) };
  return next.list === parts.list && next.place === parts.place && next.settings === parts.settings ? parts : next;
}

import type { PackId } from "../model/detection";
import { compiledLists, compiledPacks } from "./packs/generated";
import { parseCompiledList, parsePack, type List, type Pack } from "./recognizer";

/** The compiled packs `ids` names and the lists their rules look values up in; undefined when one is missing or does not parse. */
export function loadPacks(ids: readonly PackId[]): { readonly packs: Pack[]; readonly lists: List[] } | undefined {
  const packs: Pack[] = [];
  for (const id of ids) {
    const pack = parsePack(compiledPacks[id]);
    if (pack === undefined) return undefined;
    packs.push(pack);
  }
  const names = new Set(packs.flatMap(({ rules }) => rules.flatMap(({ list }) => (list === undefined ? [] : [list.name]))));
  const lists: List[] = [];
  for (const name of names) {
    const list = parseCompiledList(compiledLists[name]);
    if (list === undefined) return undefined;
    lists.push(list);
  }
  return { packs, lists };
}

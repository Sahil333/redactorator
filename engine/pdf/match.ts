import { isPageIndex } from "../model/geometry";
import { findAll } from "../model/match";
import type { MatchNumber } from "../pdf-protocol/messages";
import { post } from "./messages";

export function match(number: MatchNumber, keys: readonly string[], documents: readonly (readonly (readonly string[])[])[]): void {
  const found = documents.flatMap((pages, document) =>
    findAll(pages, keys).flatMap((each) => (isPageIndex(each.page) ? [{ ...each, document, page: each.page }] : [])),
  );
  post({ type: "matched", match: number, found });
}

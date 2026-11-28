import type { DocumentDetection } from "../engine/api/state";
import type { PageIndex } from "../engine/model/geometry";

/** "Stopped. Pages 12 to 100 were not searched.", or nothing when every page was searched. */
function notSearchedLine(pages: readonly PageIndex[]): string | undefined {
  const [first] = pages;
  const last = pages.at(-1);
  return first === undefined || last === undefined ? undefined : `Stopped. Pages ${first + 1} to ${last + 1} were not searched.`;
}

/** The line about the open document's last run beside the Run control, while no findings review shows its own. */
export function runLine({ findings, notice }: DocumentDetection): string | undefined {
  if (findings !== undefined || notice?.kind !== "nothing-found") return undefined;
  return notSearchedLine(notice.notSearched) ?? "Auto mode found nothing new in this document.";
}

/** The findings panel's line about the pages a run that ended early did not reach. */
export function NotSearched({ pages }: { readonly pages: readonly PageIndex[] }) {
  const line = notSearchedLine(pages);
  return line === undefined ? null : <p className="mx-4 mb-2 text-ink-muted">{line}</p>;
}

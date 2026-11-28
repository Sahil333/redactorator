import type { DocumentDetection } from "../engine/api/state";
import { errorText } from "./errors";

/** How a run ended, and the pages it did not search. */
type RunEnd = Pick<NonNullable<DocumentDetection["findings"]>, "ended" | "notSearched">;

/**
 * "Stopped. Pages 12 to 100 were not searched." or, for a run a failure ended, "The run ended
 * early because of an error. Pages 12 to 100 were not searched."; nothing when every page was searched.
 */
function notSearchedLine({ ended, notSearched }: RunEnd): string | undefined {
  const [first] = notSearched;
  const last = notSearched.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const how = ended === "failed" ? "The run ended early because of an error." : "Stopped.";
  return `${how} Pages ${first + 1} to ${last + 1} were not searched.`;
}

/** The line about the open document's last run beside the Run control, while no findings review shows its own. */
export function runLine({ findings, notice }: DocumentDetection): string | undefined {
  if (findings !== undefined) return undefined;
  switch (notice?.kind) {
    case "nothing-found":
      return notSearchedLine(notice) ?? "Auto mode found nothing new in this document.";
    case "run-failed":
      return errorText({ code: notice.code });
    default:
      return undefined;
  }
}

/** The findings panel's line about the pages a run that ended early did not reach. */
export function NotSearched({ run }: { readonly run: RunEnd }) {
  const line = notSearchedLine(run);
  return line === undefined ? null : <p className="mx-4 mb-2 text-ink-muted">{line}</p>;
}

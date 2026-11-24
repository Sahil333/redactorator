// The sentence a user sees for each error code the app shows.
import type { ClientError } from "../engine/core/pdf-client/errors";

const sentences: Partial<Record<ClientError["code"], string>> = {
  "worker-not-running": "The PDF engine is not running. Reload the page to try again.",
  "unexpected-reply": "The PDF engine sent something unexpected. Reload the page to try again.",
  "unreadable-reply": "The PDF engine sent something unreadable. Reload the page to try again.",
  "worker-stopped": "The PDF engine stopped. Reload the page to try again.",
};

/** What to tell the user about `error`: the worker's own sentence, or the app's; undefined for one the app never shows. */
export const errorText = (error: ClientError | undefined): string | undefined =>
  error === undefined ? undefined : (error.message ?? sentences[error.code]);

import { parsePdfRequest } from "../pdf-protocol/parse";
import { apply } from "./apply";
import { inspect } from "./inspect";
import { match } from "./match";
import { post } from "./messages";
import { render } from "./render";
import { open } from "./state";
import { text } from "./text";

/** Answers one request from the engine. Synchronous, so replies leave in the order requests came. */
export function handle(data: unknown): void {
  const request = parsePdfRequest(data);
  if (request === undefined) {
    post({
      type: "error",
      file: undefined,
      error: { code: "bad-message", message: "The engine got a message it does not know. Reload the page to try again." },
    });
    return;
  }
  switch (request.type) {
    case "inspect":
      inspect(request.inspection, request.bytes);
      break;
    case "match":
      match(request.match, request.keys, request.documents);
      break;
    case "open":
      open(request.file, request.bytes);
      break;
    case "render":
      render(request.file, request.source, request.page, request.scale);
      break;
    case "text":
      text(request.file, request.page);
      break;
    case "apply":
      apply(request.file, request.edits, request.appearance);
      break;
  }
}

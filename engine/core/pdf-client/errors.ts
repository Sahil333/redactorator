import type { PdfClientErrorCode } from "../../api/errors";
import type { PdfError } from "../../pdf-protocol/messages";

export type ClientErrorCode = PdfClientErrorCode;

/** Why a request failed. `message` is a sentence the worker composed. */
export interface ClientError {
  readonly code: PdfError["code"] | ClientErrorCode;
  readonly message?: string;
}

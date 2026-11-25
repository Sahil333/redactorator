import type { PdfClientErrorCode } from "../../api/errors";
import type { PdfError, PdfErrorData } from "../../pdf-protocol/messages";

export type ClientErrorCode = PdfClientErrorCode;

/** Why a request failed. `message` is a sentence the worker composed; `data` says where, never what the document says. */
export interface ClientError {
  readonly code: PdfError["code"] | ClientErrorCode;
  readonly message?: string;
  readonly data?: PdfErrorData;
}

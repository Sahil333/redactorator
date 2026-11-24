import type { PdfError } from "../../pdf-protocol/messages";

/**
 * Codes the client gives on its own; the worker never sends them. The first five are where the
 * wire's `bad-message` arose.
 */
export type ClientErrorCode =
  | "worker-stopped"
  | "worker-not-running"
  | "unexpected-reply"
  | "unreadable-reply"
  | "unknown-request"
  | "stale-handle";

/** Why a request failed. `message` is a sentence the worker composed. */
export interface ClientError {
  readonly code: PdfError["code"] | ClientErrorCode;
  readonly message?: string;
}

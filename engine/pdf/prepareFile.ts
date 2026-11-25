import type { PreparationNumber } from "../pdf-protocol/messages";
import { post } from "./messages";
import { prepareDocument } from "./prepare";

/** Makes a file's working copy and reading, or says why it can't be added. The bytes are transferred. */
export function prepareFile(preparation: PreparationNumber, bytes: ArrayBuffer): void {
  const prepared = prepareDocument(bytes);
  if ("code" in prepared) {
    post({ type: "refused", preparation, error: prepared });
    return;
  }
  const { preparedBytes, reading, removed } = prepared;
  post({ type: "prepared", preparation, preparedBytes: preparedBytes.buffer, reading, removed }, [preparedBytes.buffer]);
}

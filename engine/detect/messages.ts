import type { DetectReply } from "../detect-protocol/messages";

let send: (message: DetectReply) => void;

export function setSend(fn: (message: DetectReply) => void): void {
  send = fn;
}

export function post(message: DetectReply): void {
  send(message);
}

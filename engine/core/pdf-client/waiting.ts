import type { ClientError } from "./errors";

export const notRunning: ClientError = { code: "worker-not-running" };

/** Numbered requests the worker answers in turn, each waiting for its answer. */
export class Waiting<N extends number, T> {
  private latest = 0;
  private stopped = false;
  private readonly waiting = new Map<N, (answer: T | ClientError) => void>();

  constructor(private readonly isNumber: (value: unknown) => value is N) {}

  ask(send: (number: N) => void): Promise<T | ClientError> {
    const number = this.latest + 1;
    // Once the worker has stopped, nothing would ever answer.
    if (this.stopped || !this.isNumber(number)) return Promise.resolve(notRunning);
    this.latest = number;
    return new Promise((resolve) => {
      this.waiting.set(number, resolve);
      send(number);
    });
  }

  answer(number: N, answer: T | ClientError) {
    this.waiting.get(number)?.(answer);
    this.waiting.delete(number);
  }

  stop(error: ClientError) {
    this.stopped = true;
    for (const answer of this.waiting.values()) answer(error);
    this.waiting.clear();
  }
}

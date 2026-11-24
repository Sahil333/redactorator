// What the engine core asks of its host, so the core never names a platform's API.

/**
 * The one-writer lock on each project. It keeps out holders in the same lock domain only (in a
 * browser, one profile and site), and is not re-entrant.
 */
export interface LockPort {
  /** Holds the project's lock, or resolves to undefined when another holder has it. */
  acquire(projectId: string): Promise<LockHold | undefined>;
}

/** A held lock, let go on `release` or when its holder dies. */
export interface LockHold {
  release(): void;
}

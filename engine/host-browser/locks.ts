import type { LockHold, LockPort } from "../core/ports";

/**
 * Web Locks, held while a project is open so a second tab cannot open it and write over it. The
 * browser lets a lock go when its tab closes.
 */
export const webLocks: LockPort = {
  acquire(projectId) {
    return new Promise<LockHold | undefined>((resolve) => {
      void navigator.locks.request(`redactorator-project:${projectId}`, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve(undefined);
          return undefined;
        }
        return new Promise<void>((release) => resolve({ release: () => release() }));
      });
    });
  },
};

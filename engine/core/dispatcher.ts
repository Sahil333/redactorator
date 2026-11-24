/**
 * The engine's one dispatcher. A pass commits one record's new state, then starts that record's
 * effects in order, then calls the listeners once. A record dispatched during a pass, by an effect
 * or a listener, waits for the passes before it, so a listener never sees a state whose effects
 * have not begun, and no record is lost.
 */
export interface Dispatcher<S, R> {
  getState(): S;
  dispatch(record: R, ...effects: (() => void)[]): void;
  subscribe(listener: () => void): () => void;
}

export function createDispatcher<S, R>(initial: S, reduce: (state: S, record: R) => S): Dispatcher<S, R> {
  let state = initial;
  const listeners = new Set<() => void>();
  const queue: { readonly record: R; readonly effects: readonly (() => void)[] }[] = [];
  let passing = false;

  function pass(record: R, effects: readonly (() => void)[]) {
    const before = state;
    state = reduce(state, record);
    for (const effect of effects) effect();
    if (state !== before) for (const listener of [...listeners]) listener();
  }

  return {
    getState: () => state,
    dispatch(record, ...effects) {
      queue.push({ record, effects });
      if (passing) return;
      passing = true;
      try {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) pass(next.record, next.effects);
      } finally {
        passing = false;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

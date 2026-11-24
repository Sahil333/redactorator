import { describe, expect, test } from "vitest";
import { createDispatcher } from "./dispatcher";

// Each record appends its letter, so a lost or reordered update shows in the state.
const appended = () => createDispatcher<string, string>("", (state, letter) => state + letter);

describe("the dispatcher", () => {
  test("a record an effect dispatches runs after the pass that started the effect, which notifies once", () => {
    const dispatcher = appended();
    const seen: string[] = [];
    dispatcher.subscribe(() => seen.push(dispatcher.getState()));
    dispatcher.dispatch("a", () => dispatcher.dispatch("b"), () => seen.push(`effect saw ${dispatcher.getState()}`));
    expect(dispatcher.getState()).toBe("ab");
    expect(seen).toEqual(["effect saw a", "a", "ab"]);
  });

  test("a record a listener dispatches runs after every listener has seen the pass", () => {
    const dispatcher = appended();
    const seen: string[] = [];
    dispatcher.subscribe(() => {
      seen.push(`first saw ${dispatcher.getState()}`);
      if (dispatcher.getState() === "a") dispatcher.dispatch("b");
    });
    dispatcher.subscribe(() => seen.push(`second saw ${dispatcher.getState()}`));
    dispatcher.dispatch("a");
    expect(dispatcher.getState()).toBe("ab");
    expect(seen).toEqual(["first saw a", "second saw a", "first saw ab", "second saw ab"]);
  });

  test("a record that changes nothing notifies no one", () => {
    const dispatcher = createDispatcher<number, number>(0, (state, value) => Math.max(state, value));
    let notified = 0;
    dispatcher.subscribe(() => notified++);
    dispatcher.dispatch(2);
    dispatcher.dispatch(1);
    expect(notified).toBe(1);
  });
});

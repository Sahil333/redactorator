import type { Settings } from "../../../model/project";
import { saveSettings } from "../../stored/projects";
import type { LibraryHost } from "../host";

/** The effect of a settings change: writes them one after another, so the latest change is the one that lands. */
export function settingsWriter(host: LibraryHost): (settings: Settings) => () => void {
  let writing = Promise.resolve();
  return (settings) => () => {
    const { place, settings: part } = host.state().library;
    const { store } = place;
    if (store === undefined || !part.writable) return;
    writing = writing
      .then(() => saveSettings(store, settings))
      .catch(() => host.dispatch({ type: "problemRaised", error: { code: "settings-save-failed" } }));
  };
}

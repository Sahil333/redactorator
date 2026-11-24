import { defaultSettings, type Settings } from "../../../model/project";
import type { LibraryChange } from "../changes";

export interface SettingsPart {
  readonly settings: Settings;
  /** False once a newer version's settings were found: they are never written over with this version's. */
  readonly writable: boolean;
}

export const firstSettings: SettingsPart = { settings: defaultSettings, writable: true };

export function settings(part: SettingsPart, change: LibraryChange): SettingsPart {
  switch (change.type) {
    case "storeLoaded":
      // Settings that can't be read leave those in use as they are.
      return typeof change.settings === "string" ? { ...part, writable: change.settings !== "newer" } : { settings: change.settings, writable: true };
    case "settingsChanged":
      return { ...part, settings: change.settings };
    default:
      return part;
  }
}

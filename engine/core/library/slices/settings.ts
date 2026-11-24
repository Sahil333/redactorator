import { defaultSettings, type Settings } from "../../../model/project";
import type { LibraryChange } from "../changes";

export interface SettingsPart {
  readonly settings: Settings;
  /** False once a newer version's settings were found: they are never written over with this version's. */
  readonly writable: boolean;
  /** Whether files chosen on Home are being made into a project. */
  readonly creating: boolean;
}

export const firstSettings: SettingsPart = { settings: defaultSettings, writable: true, creating: false };

export function settings(part: SettingsPart, change: LibraryChange): SettingsPart {
  switch (change.type) {
    // Nothing is written into a store before its own settings are read: they may be a newer version's.
    case "storeChanged":
      return { ...part, writable: false };
    case "storeLoaded":
      // Settings that can't be read leave those in use as they are.
      return typeof change.settings === "string" ? { ...part, writable: change.settings !== "newer" } : { ...part, settings: change.settings, writable: true };
    case "settingsChanged":
      return { ...part, settings: change.settings };
    case "createStarted":
    case "createEnded":
      return { ...part, creating: change.type === "createStarted" };
    default:
      return part;
  }
}

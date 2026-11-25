import type { Brand } from "./brand";
import type { Appearance, RemovalKind } from "./document";
import type { ImageAnchor } from "./images";
import type { Mark } from "./marks";
import type { MarkType } from "./markTypes";

/** Names one document in a project. */
export type DocumentId = Brand<string, "DocumentId">;

export const isDocumentId = (value: unknown): value is DocumentId => typeof value === "string" && value !== "";

export const newDocumentId = (): DocumentId => {
  const id = crypto.randomUUID();
  if (!isDocumentId(id)) throw new Error("No id");
  return id;
};

export const reviewStates = ["not-started", "in-review", "approved"] as const;
/** How far the user has got in checking a document's marks. A mark puts it in review. */
export type ReviewState = (typeof reviewStates)[number];

export const downloadStates = ["none", "downloaded", "changed"] as const;
/**
 * Whether a cleaned file has been downloaded from this project, and whether its marks have
 * changed since. A browser can't tell where the download went, or whether it is still there.
 */
export type DownloadState = (typeof downloadStates)[number];

export interface ProjectDocument {
  readonly id: DocumentId;
  /** The original's file name in the project folder. */
  readonly file: string;
  readonly sha256: string;
  readonly pages: number;
  readonly marks: readonly Mark[];
  readonly review: ReviewState;
  readonly download: DownloadState;
  /** Keys of hidden values the user chose not to hide in this document ("Don't hide here"). */
  readonly shown: readonly string[];
  /** What preparing it removed, by kind, as the approval dialog last listed it: a later approval lists only other kinds. */
  readonly removedSeen: readonly RemovalKind[];
}

/**
 * A value, or a part of an image, hidden in every document of the project; set when a document
 * that marks it is approved.
 */
export interface HiddenValue {
  /** A value's normalised form (engine/model/match.ts), which every spelling of it shares, or an image part's key (engine/model/images.ts). */
  readonly key: string;
  /** As it was marked, to show. */
  readonly text: string;
  readonly type: MarkType;
  /** The document whose approval set it. */
  readonly from: DocumentId;
  /** For a part of an image: the image and the part. */
  readonly image?: ImageAnchor;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly created: string;
  readonly archived: boolean;
  readonly documents: readonly ProjectDocument[];
  readonly hidden: readonly HiddenValue[];
}

export interface Settings {
  readonly appearance: Appearance;
  /** Mark types the user typed in, by name, offered on every later mark. */
  readonly customTypes: readonly string[];
}

export const defaultSettings: Settings = { appearance: { colour: "#000000", label: false }, customTypes: [] };

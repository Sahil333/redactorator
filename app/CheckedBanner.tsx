import { useState, type RefObject } from "react";

interface CheckedBannerProps {
  readonly markCount: number;
  /** What the checked file is, and its download button's label. */
  readonly file: { readonly note: string; readonly download: string };
  /** Download gets focus when the banner appears, so a keyboard user lands on it. */
  readonly downloadRef: RefObject<HTMLButtonElement | null>;
  readonly onBack: () => void;
  /** Saves the file; rejects when the save failed. */
  readonly onDownload: () => Promise<void>;
}

/** REV-6: shown over the preview of the cleaned output once every check passed. */
export function CheckedBanner({ markCount, file, downloadRef, onBack, onDownload }: CheckedBannerProps) {
  // A second save while Chrome's dialog is opening would be refused, so one runs at a time.
  const [save, setSave] = useState<"idle" | "saving" | "failed">("idle");
  return (
    <div className="sticky top-0 z-20 m-4 mb-0 flex flex-wrap items-center gap-3 rounded-md border border-pass/40 bg-pass-wash px-4 py-2.5 text-pass">
      <p id="checked-message" className="flex-1">
        <strong className="font-semibold">Checked:</strong> no text is left under the{" "}
        {markCount === 1 ? "mark" : `${markCount} marks`}, and the file's metadata is gone.{" "}
        {file.note}
      </p>
      <button
        type="button"
        onClick={onBack}
        className="rounded-md border border-pass/40 px-3 py-1.5 text-ink hover:bg-paper-raised"
      >
        Back to editing
      </button>
      <button
        ref={downloadRef}
        type="button"
        aria-describedby="checked-message"
        disabled={save === "saving"}
        onClick={() => {
          setSave("saving");
          onDownload().then(
            () => setSave("idle"),
            () => setSave("failed"),
          );
        }}
        className="rounded-md bg-ink px-3.5 py-1.5 text-paper hover:bg-ink/85"
      >
        {file.download}
      </button>
      {save === "failed" && (
        <p role="alert" className="basis-full text-mark">
          The file could not be saved, so it may be empty or missing where you picked. Try again.
        </p>
      )}
    </div>
  );
}

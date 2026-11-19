import type { RefObject } from "react";

interface CheckedBannerProps {
  readonly markCount: number;
  /** Download gets focus when the banner appears, so a keyboard user lands on it. */
  readonly downloadRef: RefObject<HTMLButtonElement | null>;
  readonly onBack: () => void;
  readonly onDownload: () => void;
}

/** REV-6: shown over the preview of the cleaned output once every check passed. */
export function CheckedBanner({ markCount, downloadRef, onBack, onDownload }: CheckedBannerProps) {
  return (
    <div className="sticky top-0 z-20 m-4 mb-0 flex items-center gap-3 rounded-md border border-pass/40 bg-pass-wash px-4 py-2.5 text-pass">
      <p id="checked-message" className="flex-1">
        <strong className="font-semibold">Checked:</strong> no text is left under the{" "}
        {markCount === 1 ? "mark" : `${markCount} marks`}, and the file's metadata is gone. This is the cleaned file.
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
        onClick={onDownload}
        className="rounded-md bg-ink px-3.5 py-1.5 text-paper hover:bg-ink/85"
      >
        Download
      </button>
    </div>
  );
}

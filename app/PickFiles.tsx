import { useEffect, useRef, type ChangeEvent, type ReactNode } from "react";

/**
 * A file input styled as a button, named `label`. It shows `children`, such as an icon, or else
 * the label. `folder` picks a whole folder instead of files.
 */
export function PickFiles({ label, children, folder = false, disabled, className, onFiles }: {
  readonly label: string;
  readonly children?: ReactNode;
  readonly folder?: boolean;
  readonly disabled: boolean;
  readonly className: string;
  readonly onFiles: (files: readonly File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current !== null) inputRef.current.webkitdirectory = folder;
  }, [folder]);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  }

  return (
    <label className={className} title={children === undefined ? undefined : label}>
      {children ?? label}
      <input
        ref={inputRef}
        type="file"
        aria-label={label}
        accept={folder ? undefined : "application/pdf"}
        multiple
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
    </label>
  );
}

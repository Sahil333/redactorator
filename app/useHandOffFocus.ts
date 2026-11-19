import { useEffect, useRef } from "react";

/**
 * The button a keyboard user wants next replaces the one they pressed: Download after
 * Apply and check, and Apply and check after Back to editing.
 */
export function useHandOffFocus(previewing: boolean) {
  const applyRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);
  const backToEditing = useRef(false);

  useEffect(() => {
    if (previewing) {
      downloadRef.current?.focus();
    } else if (backToEditing.current) {
      backToEditing.current = false;
      applyRef.current?.focus();
    }
  }, [previewing]);

  return {
    applyRef,
    downloadRef,
    /** Call as the preview closes from Back to editing. */
    backToEditing: () => {
      backToEditing.current = true;
    },
  };
}

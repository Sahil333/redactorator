import { useEffect, useEffectEvent, type RefObject } from "react";

/** Calls `onVisible` when the element comes near the screen, for as long as `waiting` is true. */
export function useWhenVisible(element: RefObject<Element | null>, waiting: boolean, onVisible: () => void) {
  const becameVisible = useEffectEvent(onVisible);

  useEffect(() => {
    const target = element.current;
    if (target === null || !waiting) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) becameVisible();
      },
      { rootMargin: "50% 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, waiting]);
}

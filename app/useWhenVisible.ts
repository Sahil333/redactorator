import { useEffect, useEffectEvent, type RefObject } from "react";

/**
 * Calls `onVisible` when the element comes near the screen, while it is `waitingFor` something.
 * A new value of `waitingFor` asks again, even if the element never left the screen.
 */
export function useWhenVisible(element: RefObject<Element | null>, waitingFor: string | undefined, onVisible: () => void) {
  const becameVisible = useEffectEvent(onVisible);

  useEffect(() => {
    const target = element.current;
    if (target === null || waitingFor === undefined) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) becameVisible();
      },
      { rootMargin: "50% 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, waitingFor]);
}

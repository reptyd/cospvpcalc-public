import { useEffect, useState } from "react";

/** Reactive `(max-width: 640px)` flag. Same breakpoint as the
 * Custom-tab mobile overrides in App.css.
 *
 * Used by the Custom-Ability / Custom-Timing visual editors to swap
 * the desktop "tile is draggable from anywhere" affordance for a
 * mobile "⋮⋮ handle is the only drag source" pattern. Without the
 * swap, every touch on a tile fires the polyfill's dragstart and
 * the palette / workspace becomes unscrollable on phones. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(max-width: 640px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

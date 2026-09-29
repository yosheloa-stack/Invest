import { useEffect, useRef, useState } from "react";
// Native fullscreen where supported; a viewport overlay works on iPhone too.
export function useChartFullscreen() {
  const root = useRef<HTMLElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const close = () => {
    if (document.fullscreenElement === root.current)
      void document.exitFullscreen().catch(() => {});
    setExpanded(false);
  };
  const toggle = () => {
    if (expanded) {
      close();
      return;
    }
    restore.current = document.activeElement as HTMLElement;
    setExpanded(true);
    void root.current?.requestFullscreen?.().catch(() => {
      /* viewport fallback */
    });
  };
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab") {
        const els = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),a[href],input,select,[tabindex="0"]',
          ) ?? []),
        ].filter((el) => el.getClientRects().length);
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    root.current
      ?.querySelector<HTMLElement>("[data-fullscreen-toggle]")
      ?.focus();
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      restore.current?.focus();
    };
  }, [expanded]);
  return { root, expanded, toggle };
}

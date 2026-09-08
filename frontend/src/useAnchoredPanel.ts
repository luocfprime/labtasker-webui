import { useLayoutEffect, type RefObject } from "react";

/** Keep anchored menus within the viewport, with scrolling for long content. */
export function useAnchoredPanel(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, width: number, align: "left" | "right" = "left", matchAnchor = false) {
  useLayoutEffect(() => {
    const trigger = anchor.current;
    const popup = panel.current;
    if (!open || !trigger || !popup) return;
    const position = () => {
      const margin = 12, gap = 6;
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const vw = viewport?.width || window.innerWidth, vh = viewport?.height || window.innerHeight;
      const w = Math.min(matchAnchor ? Math.max(width, rect.width) : width, vw - 2 * margin);
      popup.style.width = `${w}px`;
      popup.style.minWidth = "0";
      popup.style.right = "auto";
      popup.style.left = `${Math.max(left + margin, Math.min(align === "right" ? rect.right - w : rect.left, left + vw - w - margin))}px`;
      const below = Math.max(0, top + vh - rect.bottom - gap - margin);
      const above = Math.max(0, rect.top - top - gap - margin);
      const up = below < Math.min(popup.scrollHeight, 520) && above > below;
      popup.style.maxHeight = `${Math.max(0, Math.min(520, vh - 2 * margin, up ? above : below))}px`;
      const height = popup.getBoundingClientRect().height;
      popup.style.top = `${Math.max(top + margin, Math.min(up ? rect.top - gap - height : rect.bottom + gap, top + vh - height - margin))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(popup);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
    };
  }, [open, anchor, panel, width, align, matchAnchor]);
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Shared, delay-free hints, rendered outside clipped table cells. */
export function InstantTooltip() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const text = anchor?.dataset.tooltip;

  useEffect(() => {
    const show = (event: Event) => {
      const target = event.target;
      setAnchor(target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null);
    };
    const hide = () => setAnchor(null);
    const leave = (event: MouseEvent) => {
      const target = event.relatedTarget;
      setAnchor(target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("mouseover", show);
    document.addEventListener("mouseout", leave);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!anchor || !tip.current) return;
    const rect = anchor.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    tip.current.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8))}px`;
    const below = rect.bottom + 6;
    tip.current.style.top = `${Math.max(8, below + box.height <= window.innerHeight - 8 ? below : rect.top - box.height - 6)}px`;
  }, [anchor, text]);

  return text && anchor?.isConnected
    ? createPortal(<div ref={tip} role="tooltip" className="instant-tooltip">{text}</div>, document.body)
    : null;
}

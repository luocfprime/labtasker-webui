import { useEffect, useId, useRef, useState } from "react";

import { useAnchoredPanel } from "./useAnchoredPanel";

type Option = { value: string; label: string };
export function Select({ label, value, options, onChange, action, modified }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; action?: {label: string; onSelect: () => void}; modified?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useAnchoredPanel(open, trigger, panel, label === "Data view" ? 280 : 160, "left", true);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('[role="option"].highlighted')?.scrollIntoView({block: "nearest"});
  }, [open, active]);
  const id = useId();
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const choose = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
  };
  return <div className="ui-select" ref={root} onKeyDown={(event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "Tab" && open && action) {
      if (!event.shiftKey && event.target === trigger.current) {
        event.preventDefault();
        actionButton.current?.focus();
      } else if (event.shiftKey && event.target === actionButton.current) {
        event.preventDefault();
        trigger.current?.focus();
      }
    }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open ? `${id}-${active}` : undefined}
      onClick={() => { setActive(selected); setOpen(!open); }}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setOpen(true);
          setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
            !open ? selected : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if ((event.key === "Enter" || event.key === " ") && open) {
          event.preventDefault(); choose(active);
        } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const index = options.findIndex((option, index) => index > active && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
          const next = index >= 0 ? index : options.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
          if (next >= 0) { event.preventDefault(); setOpen(true); setActive(next); }
        }
      }}>
      <span className="select-value"><span className="select-value-text">{options[selected].label}</span>{modified && <span className="view-dirty" role="img" aria-label="Unsaved changes" data-tooltip="Unsaved changes" />}</span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {open && <div ref={panel} className="ui-select-menu">
      <div id={`${id}-list`} role="listbox" aria-label={label}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        aria-selected={value === option.value} className={active === index ? "highlighted" : ""}
        onPointerMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(index)}>
        <span data-tooltip={option.label}>{option.label}</span><span aria-hidden="true">{value === option.value ? "✓" : ""}</span>
      </div>)}
      </div>
      {action && <button ref={actionButton} type="button" className="select-action" onClick={() => {setOpen(false); action.onSelect();}}>{action.label}</button>}
    </div>}
  </div>;
}

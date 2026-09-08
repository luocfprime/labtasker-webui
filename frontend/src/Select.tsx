import { useEffect, useId, useRef, useState } from "react";

type Option = { value: string; label: string };
export function Select({ label, value, options, onChange, action }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; action?: {label: string; onSelect: () => void};
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
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
  return <div className="ui-select" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" role="combobox" aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open ? `${id}-${active}` : undefined}
      onClick={() => { setActive(selected); setOpen(!open); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setOpen(true);
          setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
            !open ? selected : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if ((event.key === "Enter" || event.key === " ") && open) {
          event.preventDefault(); choose(active);
        } else if (event.key.length === 1 && event.key !== " ") {
          const index = options.findIndex((option, index) => index > active && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
          const next = index >= 0 ? index : options.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
          if (next >= 0) { event.preventDefault(); setOpen(true); setActive(next); }
        }
      }}>
      <span>{options[selected].label}</span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {open && <div className="ui-select-menu">
      <div id={`${id}-list`} role="listbox" aria-label={label}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        aria-selected={value === option.value} className={active === index ? "highlighted" : ""}
        onPointerMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(index)}>
        <span>{option.label}</span><span aria-hidden="true">{value === option.value ? "✓" : ""}</span>
      </div>)}
      </div>
      {action && <button type="button" className="select-action" onClick={() => {setOpen(false); action.onSelect();}}>{action.label}</button>}
    </div>}
  </div>;
}

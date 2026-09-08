import { useEffect, useId, useRef, useState } from "react";

import { saveSetting } from "./profile";
const examples = [
  ["Unfinished tasks", 'status in ["pending", "running"]'],
  ["Failed or cancelled", 'status in ["failed", "cancelled"]'],
  ["High-priority pending", 'status == "pending" and priority > 0'],
  ["Low-priority pending", 'status == "pending" and priority < 0'],
  ["Retried tasks", "attempt > 1"],
  ["Tasks with errors", "exists(last_error.type)"],
  ["Negative priority", "priority < 0"],
];
function readPresets(): [string, string][] {
  try {
    const value = JSON.parse(localStorage.getItem("labtasker:filterPresets:v1") || "[]");
    return Array.isArray(value) ? value.filter((item) => Array.isArray(item) && item.length === 2 && item.every((x) => typeof x === "string")) : [];
  } catch { return []; }
}

export function FilterInput({ label, value, onChange }: {
  label: string; value: string; onChange: (value: string) => void;
}) {
  const [presets, setPresets] = useState(readPresets);
  const [presetName, setPresetName] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const help = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="filter filter-input" ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation(); setOpen(false); help.current?.focus();
      }
    }}>
    <input ref={input} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}
      placeholder='Filter · e.g. priority < 0' aria-describedby={open ? `${id}-hint` : undefined} />
    <button ref={help} type="button" className="filter-help-button" aria-label="Filter syntax and examples"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>?</button>
    {open && <section id={id} className="filter-help" aria-label="Filter syntax and examples">
      <strong>Advanced filter</strong>
      <p id={`${id}-hint`}>Use task fields or nested paths such as <code>metadata.owner</code>. Choose an example to fill the input, then click Apply.</p>
      <div className="filter-examples">
        {examples.map(([name, expression]) => <button type="button" key={expression} onClick={() => {
          onChange(expression); setOpen(false); input.current?.focus();
        }}><span>{name}</span>{" "}<code>{expression}</code></button>)}
      </div>
      {presets.length > 0 && <><strong>Saved filters</strong><div className="filter-examples">
        {presets.map(([name, expression]) => <div key={name} className="saved-filter-row">
          <button type="button" onClick={() => { onChange(expression); setOpen(false); input.current?.focus(); }}><span>{name}</span>{" "}<code>{expression}</code></button>
          <button type="button" aria-label={`Remove filter ${name}`} onClick={() => {
            const next = presets.filter(([item]) => item !== name); setPresets(next); saveSetting("labtasker:filterPresets:v1", JSON.stringify(next));
          }}>×</button>
        </div>)}
      </div></>}
      <div className="save-filter">
        <input aria-label="Preset name" placeholder="Name this filter" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
        <button type="button" disabled={!value.trim() || !presetName.trim()} onClick={() => {
          const next: [string, string][] = [...presets.filter(([name]) => name !== presetName.trim()), [presetName.trim(), value.trim()]];
          setPresets(next); saveSetting("labtasker:filterPresets:v1", JSON.stringify(next)); setPresetName("");
        }}>Save current</button>
      </div>
      <p><code>== != &gt; &gt;= &lt; &lt;=</code> compare values. Combine conditions with <code>and</code>, <code>or</code> and parentheses.</p>
      <p>Quote strings. Use <code>True</code>, <code>False</code>, <code>None</code>; check fields with <code>exists(path)</code> or <code>missing(path)</code>.</p>
      <p className="muted">Combined with the status and Task name selectors. Clear the input and click Apply to remove this filter.</p>
    </section>}
  </div>;
}

import { useEffect, useId, useRef, useState } from "react";

import { useAnchoredPanel } from "./useAnchoredPanel";
import { saveSetting } from "./profile";
const taskExamples = [
  ["Includes route", '"gpu-a100" in routes'],
  ["Excludes route", '"gpu-a100" not in routes'],
  ["Unfinished Tasks", 'status in ["pending", "running"]'],
  ["Failed or cancelled", 'status in ["failed", "cancelled"]'],
  ["High-priority pending", 'status == "pending" and priority > 0'],
  ["Low-priority pending", 'status == "pending" and priority < 0'],
  ["Multiple attempts", "attempt > 1"],
  ["Tasks with errors", "exists(last_error.type)"],
  ["Custom field matches", 'metadata.owner == "alice"'],
  ["Custom field missing", "missing(metadata.owner)"],
];
const workerExamples = [
  ["Busy Workers", 'status == "busy"'],
  ["Worker hostname", 'metadata.hostname == "node-7"'],
  ["Low GPU utilization", "telemetry.gpu.utilization < 0.2"],
  ["Missing telemetry", "missing(telemetry.gpu.utilization)"],
  ["Recent telemetry", 'telemetry_updated_at > "2026-01-01T00:00:00Z"'],
];
function readPresets(storageKey: string): [string, string][] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(value) ? value.filter((item) => Array.isArray(item) && item.length === 2 && item.every((x) => typeof x === "string")) : [];
  } catch { return []; }
}

export function FilterInput({ label, value, onChange, onApply, onCommit, kind = "task" }: {
  label: string; value: string; onChange: (value: string) => void; onApply?: () => void; onCommit?: (value: string) => void;
  kind?: "task" | "worker";
}) {
  const storageKey = kind === "worker" ? "labtasker:workerFilterPresets:v1" : "labtasker:filterPresets:v1";
  const examples = kind === "worker" ? workerExamples : taskExamples;
  const [presets, setPresets] = useState(() => readPresets(storageKey));
  const [presetName, setPresetName] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const help = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useAnchoredPanel(open, root, panel, 460);
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
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); onCommit?.(value); } }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation(); setOpen(false); help.current?.focus();
      }
    }}>
    <input ref={input} onKeyDown={event => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); onApply?.(); setOpen(false);
      }
    }} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}
      placeholder={kind === "worker" ? 'Filter · e.g. metadata.hostname == "node-7"' : "Filter · e.g. priority < 0"}
      aria-describedby={open ? `${id}-hint` : undefined} />
    <button ref={help} type="button" className="filter-help-button" aria-label="Filter syntax and examples"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>?</button>
    {open && <section ref={panel} id={id} className="filter-help" aria-label="Filter syntax and examples">
      <strong>Advanced filter</strong>
      <p id={`${id}-hint`}>{kind === "worker" ? <>Use Worker fields or nested <code>metadata.*</code> and <code>telemetry.*</code> paths.</> : <>Use Task fields or nested paths such as <code>metadata.owner</code>.</>} Choose an example to apply it immediately. Typed filters apply when you press Enter or leave this field.</p>
      <div className="filter-examples">
        {examples.map(([name, expression]) => <button type="button" key={expression} onClick={() => {
          onChange(expression); onCommit?.(expression); setOpen(false); input.current?.focus();
        }}><span>{name}</span>{" "}<code>{expression}</code></button>)}
      </div>
      {presets.length > 0 && <><strong>Saved filters</strong><div className="filter-examples">
        {presets.map(([name, expression]) => <div key={name} className="saved-filter-row">
          <button type="button" onClick={() => { onChange(expression); onCommit?.(expression); setOpen(false); input.current?.focus(); }}><span>{name}</span>{" "}<code>{expression}</code></button>
          <button type="button" aria-label={`Remove filter ${name}`} onClick={() => {
            const next = presets.filter(([item]) => item !== name); setPresets(next); saveSetting(storageKey, JSON.stringify(next));
          }}>×</button>
        </div>)}
      </div></>}
      <div className="save-filter">
        <input aria-label="Preset name" placeholder="Name this filter" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
        <button type="button" disabled={!value.trim() || !presetName.trim()} onClick={() => {
          const next: [string, string][] = [...presets.filter(([name]) => name !== presetName.trim()), [presetName.trim(), value.trim()]];
          setPresets(next); saveSetting(storageKey, JSON.stringify(next)); setPresetName("");
        }}>Save current</button>
      </div>
      <p><code>== != &gt; &gt;= &lt; &lt;=</code> compare values. Combine conditions with <code>and</code>, <code>or</code> and parentheses.</p>
      {kind === "task" && <p><code>routes</code> is an array: use <code>"gpu-a100" in routes</code> or <code>"gpu-a100" not in routes</code> to match or exclude an exact route name. Combine route checks with <code>or</code> for any or <code>and</code> for all. Replace example names with your own.</p>}
      <p>Quote strings. Use <code>True</code>, <code>False</code>, <code>None</code>; check fields with <code>exists(path)</code> or <code>missing(path)</code>.</p>
      <p className="muted">{kind === "worker" ? "Combined with the Worker status and selected route." : "Combined with the status and Task name selectors."} Clear the input and leave this field to remove the filter. Apply is also available.</p>
    </section>}
  </div>;
}

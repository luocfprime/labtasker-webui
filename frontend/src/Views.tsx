import { useEffect, useRef, useState } from "react";
import { saveSetting } from "./profile";
import * as Dialog from "@radix-ui/react-dialog";
import { Select } from "./Select";

export type ViewState = {
  filters: {status: string; name: string; filter: string; order_by: string; descending: boolean};
  visible: string[]; custom: string[]; order: string[]; widths: Record<string, number>;
};
type View = {id: string; name: string; state: ViewState};
type Collection = {active: string; views: View[]};
const storageKey = "labtasker:views:v1";
function readAll(): Record<string, Collection> {
  try { const data = JSON.parse(localStorage.getItem(storageKey) || "{}"); return data && typeof data === "object" && !Array.isArray(data) ? data : {}; } catch { return {}; }
}
function read(scope: string): Collection {
  const data = readAll()[scope];
  if (!data || !Array.isArray(data.views)) return {active: "", views: []};
  return {active: typeof data.active === "string" ? data.active : "", views: data.views.filter(v => {
    const s = v?.state;
    return typeof v?.id === "string" && typeof v.name === "string" && s &&
      [s.visible, s.custom, s.order].every(a => Array.isArray(a) && a.every(x => typeof x === "string")) &&
      s.filters && ["status", "name", "filter", "order_by"].every(k => typeof (s.filters as Record<string, unknown>)[k] === "string") &&
      typeof s.filters.descending === "boolean" && s.widths && typeof s.widths === "object" &&
      Object.values(s.widths).every(w => typeof w === "number" && w >= 60 && w <= 10000);
  })};
}
export function Views({scope, current, apply}: {scope: string; current: ViewState; apply: (state: ViewState) => void}) {
  const [data, setData] = useState(() => read(scope));
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"create" | "copy" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = data.views.find(v => v.id === data.active);
  const dirty = !!selected && JSON.stringify(selected.state) !== JSON.stringify(current);
  const save = (next: Collection) => {
    setData(next); saveSetting(storageKey, JSON.stringify({...readAll(), [scope]: next}));
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const dismiss = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const start = (kind: NonNullable<typeof dialog>) => {
    setOpen(false);
    setName(kind === "rename" ? selected?.name || "" : kind === "copy" && selected ? `${selected.name} copy` : "");
    setDialog(kind);
  };
  const trimmed = name.trim();
  const duplicate = data.views.some(v => v.name === trimmed && (dialog !== "rename" || v.id !== data.active));
  const title = dialog === "delete" ? `Delete “${selected?.name}”?` : dialog === "rename" ? "Rename view" : dialog === "copy" ? "Save view as" : "Create view";
  const submit = () => {
    if (dialog === "delete") save({active: "", views: data.views.filter(v => v.id !== data.active)});
    else if (dialog === "rename") save({...data, views: data.views.map(v => v.id === data.active ? {...v, name: trimmed} : v)});
    else {
      const view = {id: crypto.randomUUID(), name: trimmed, state: structuredClone(current)};
      save({active: view.id, views: [...data.views, view]});
    }
    setDialog(null);
  };
  return <div className="views" ref={root}>
    <div className={`view-selector${dirty ? " is-modified" : ""}`}>
      <Select label="Data view" value={selected?.id || ""} options={[{value: "", label: "Unsaved view"}, ...data.views.map(v => ({value: v.id, label: v.name}))]}
        action={{label: "+ Create view", onSelect: () => start("create")}} onChange={id => {
          const view = data.views.find(v => v.id === id);
          save({...data, active: id}); if (view) apply(structuredClone(view.state));
        }} />
      {dirty && <span className="view-dirty" role="img" aria-label="Unsaved changes" data-tooltip="Unsaved changes" />}
    </div>
    {dirty && <button className="view-save" onClick={() => save({...data, views: data.views.map(v => v.id === data.active ? {...v, state: structuredClone(current)} : v)})}>Save</button>}
    <button ref={menuButton} type="button" aria-label="View actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
    {open && <div ref={menu} className="views-menu" role="menu" aria-label="View actions"
      onBlur={e => {if (!root.current?.contains(e.relatedTarget)) setOpen(false);}}
      onKeyDown={e => {
        if (e.key === "Escape") {e.preventDefault(); setOpen(false); menuButton.current?.focus();}
        const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}>
      <button role="menuitem" onClick={() => start("copy")}>Save as…</button>
      <button role="menuitem" disabled={!selected} onClick={() => start("rename")}>Rename</button>
      <button role="menuitem" disabled={!dirty} onClick={() => {if (selected) apply(structuredClone(selected.state)); setOpen(false); menuButton.current?.focus();}}>Reset changes</button>
      <div role="separator" />
      <button role="menuitem" className="view-delete" disabled={!selected} onClick={() => start("delete")}>Delete</button>
    </div>}
    <Dialog.Root open={dialog !== null} onOpenChange={open => {if (!open) setDialog(null);}}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-back" />
        <Dialog.Content className="modal view-dialog" onCloseAutoFocus={e => {e.preventDefault(); menuButton.current?.focus();}}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{dialog === "delete" ? "Only this saved view will be deleted. Tasks will not be deleted." : dialog === "rename" ? "Choose a name for this view." : "Save the current filters, sorting and columns."}</Dialog.Description>
          <form onSubmit={e => {e.preventDefault(); if (dialog === "delete" || (trimmed && !duplicate)) submit();}}>
            {dialog !== "delete" && <><label htmlFor="view-name">View name</label><input id="view-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus aria-invalid={duplicate} aria-describedby={duplicate ? "view-name-error" : undefined} />
              {duplicate && <p id="view-name-error" className="view-name-error">A view with this name already exists.</p>}</>}
            <div className="modal-actions">
              <Dialog.Close asChild><button type="button">Cancel</button></Dialog.Close>
              <button type="submit" className={dialog === "delete" ? "danger" : "primary"} disabled={dialog !== "delete" && (!trimmed || duplicate)}>{dialog === "delete" ? "Delete view" : dialog === "rename" ? "Rename" : dialog === "create" ? "Create view" : "Save"}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}

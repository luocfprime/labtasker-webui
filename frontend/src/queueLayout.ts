import { saveSetting } from "./profile";
export type QueueLayout = {visible: string[]; custom: string[]; order: string[]; widths: Record<string, number>};
export const layoutKey = "labtasker:queueLayouts:v1";
function stored(): Record<string, QueueLayout> {
  try { const value = JSON.parse(localStorage.getItem(layoutKey) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch {return {};}
}
export function readQueueLayout(scope: string): Partial<QueueLayout> {
  const own = stored()[scope];
  if (own && typeof own === "object") return own;
  // Only recover from this queue's own active view, never legacy global columns.
  try {
    const collection = JSON.parse(localStorage.getItem("labtasker:views:v1") || "{}")[scope];
    const view = collection?.views?.find((v: {id: string}) => v.id === collection.active);
    return view?.state || {};
  } catch { return {}; }
}
export function saveQueueLayout(scope: string, value: QueueLayout) {
  saveSetting(layoutKey, JSON.stringify({...stored(), [scope]: value}));
}

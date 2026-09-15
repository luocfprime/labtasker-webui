import { saveSetting } from "./profile";
const key = "labtasker:workspace:v1";
const workerColumns = new Set(["worker", "status", "route", "task", "lastSeen"]);
export type WorkspacePreferences = {collapsed: boolean; inactive: boolean; width: number; workerWidths: Record<string, number>};
function read(): Record<string, WorkspacePreferences> {
  try {const value = JSON.parse(localStorage.getItem(key) || "{}");return value && typeof value === "object" && !Array.isArray(value) ? value : {};} catch {return {};}
}
export function workspacePreferences(scope: string): WorkspacePreferences {
  const saved = read()[scope];
  const workerWidths = saved?.workerWidths && typeof saved.workerWidths === "object"
    ? Object.fromEntries(Object.entries(saved.workerWidths).filter(([column, width]) => workerColumns.has(column) && typeof width === "number" && Number.isFinite(width) && width >= 60 && width <= 10000))
    : {};
  return {collapsed: saved?.collapsed === true, inactive: saved?.inactive === true, width: typeof saved?.width === "number" && Number.isFinite(saved.width) ? Math.max(160, Math.min(480, saved.width)) : 200, workerWidths};
}
export function saveWorkspacePreferences(scope: string, value: WorkspacePreferences) {
  saveSetting(key, JSON.stringify({...read(), [scope]: value}));
}

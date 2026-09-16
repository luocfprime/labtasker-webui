import { saveSetting } from "./profile";
import { pathParts } from "./customColumns";
const key = "labtasker:workspace:v1";
export const workerColumns = ["worker", "status", "route", "task", "lastSeen"] as const;
const workerColumnSet = new Set<string>(workerColumns);
export function workerPath(path: string) {
  const parts = pathParts(path);
  return !!parts && parts.length > 1 && ["metadata", "telemetry"].includes(parts[0]);
}
function validColumn(column: unknown): column is string {
  return typeof column === "string" && (workerColumnSet.has(column) || column.startsWith("path:") && workerPath(column.slice(5)));
}
export type WorkspacePreferences = {
  collapsed: boolean; inactive: boolean; width: number;
  workerWidths: Record<string, number>; workerVisible: string[];
  workerCustom: string[]; workerOrder: string[];
};
function read(): Record<string, WorkspacePreferences> {
  try {const value = JSON.parse(localStorage.getItem(key) || "{}");return value && typeof value === "object" && !Array.isArray(value) ? value : {};} catch {return {};}
}
export function workspacePreferences(scope: string): WorkspacePreferences {
  const saved = read()[scope];
  const workerWidths = saved?.workerWidths && typeof saved.workerWidths === "object"
    ? Object.fromEntries(Object.entries(saved.workerWidths).filter(([column, width]) => validColumn(column) && typeof width === "number" && Number.isFinite(width) && width >= 60 && width <= 10000))
    : {};
  const workerCustom = Array.isArray(saved?.workerCustom) ? saved.workerCustom.filter((path): path is string => typeof path === "string" && workerPath(path)) : [];
  const ids = new Set([...workerColumns, ...workerCustom.map(path => `path:${path}`)]);
  const workerVisible = Array.isArray(saved?.workerVisible)
    ? saved.workerVisible.filter((column): column is string => typeof column === "string" && ids.has(column))
    : [...workerColumns];
  const workerOrder = Array.isArray(saved?.workerOrder)
    ? saved.workerOrder.filter((column): column is string => typeof column === "string" && ids.has(column))
    : [];
  return {
    collapsed: saved?.collapsed === true,
    inactive: saved?.inactive === true,
    width: typeof saved?.width === "number" && Number.isFinite(saved.width) ? Math.max(160, Math.min(480, saved.width)) : 200,
    workerWidths, workerVisible, workerCustom, workerOrder,
  };
}
export function saveWorkspacePreferences(scope: string, value: WorkspacePreferences) {
  saveSetting(key, JSON.stringify({...read(), [scope]: value}));
}

import { saveSetting } from "./profile";
const key = "labtasker:workspace:v1";
export type WorkspacePreferences = {collapsed: boolean; inactive: boolean; width: number};
function read(): Record<string, WorkspacePreferences> {
  try {const value = JSON.parse(localStorage.getItem(key) || "{}");return value && typeof value === "object" && !Array.isArray(value) ? value : {};} catch {return {};}
}
export function workspacePreferences(scope: string): WorkspacePreferences {
  const saved = read()[scope];
  return {collapsed: saved?.collapsed === true, inactive: saved?.inactive === true, width: typeof saved?.width === "number" && Number.isFinite(saved.width) ? Math.max(160, Math.min(480, saved.width)) : 200};
}
export function saveWorkspacePreferences(scope: string, value: WorkspacePreferences) {
  saveSetting(key, JSON.stringify({...read(), [scope]: value}));
}

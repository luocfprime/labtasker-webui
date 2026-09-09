const keys = ["labtasker:workspace:v1", "labtasker:queueLayouts:v1", "labtasker:views:v1", "labtasker:column-widths", "labtasker:columns:v3", "labtasker:customColumns:v1", "labtasker:columnOrder:v1", "labtasker:drawerWidth", "labtasker:lastQueue", "labtasker:filterPresets:v1", "labtasker:filters:v1"];
const pendingKey = "labtasker:profilePending:v1";
function readPending(): Record<string, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(pendingKey) || "{}");
    return Object.fromEntries(Object.entries(stored).filter(([key, value]) => keys.includes(key) && typeof value === "string")) as Record<string, string>;
  } catch { return {}; }
}
let enabled = false;
let pending: Record<string, string> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;
let saveError = false;
const listeners = new Set<() => void>();
export const getProfileSaveError = () => saveError;
export function subscribeProfileSave(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function setSaveError(value: boolean) {
  saveError = value;
  listeners.forEach(listener => listener());
}
export function retryProfileSave() {
  clearTimeout(timer);
  return flush();
}
export function saveSetting(key: string, value: string) {
  localStorage.setItem(key, value);
  if (!enabled || !keys.includes(key)) return;
  pending[key] = value;
  localStorage.setItem(pendingKey, JSON.stringify({...readPending(), [key]: value}));
  clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, 300);
}
function flush(): Promise<void> {
  if (inFlight) return inFlight;
  const values = pending;
  if (!Object.keys(values).length) return Promise.resolve();
  pending = {};
  inFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const body = JSON.stringify(values);
      // Keepalive has a shared 64 KiB browser quota; larger saves use normal fetch.
      const keepalive = new TextEncoder().encode(body).length <= 60 * 1024;
      const response = await fetch("/api/webui/profile", { method: "PATCH", headers: {"Content-Type": "application/json"}, body, keepalive, signal: controller.signal });
      if (!response.ok) throw new Error("Profile save failed");
      const remaining = readPending();
      for (const [key, value] of Object.entries(values)) {
        if (remaining[key] === value) delete remaining[key];
      }
      if (Object.keys(remaining).length) localStorage.setItem(pendingKey, JSON.stringify(remaining));
      else localStorage.removeItem(pendingKey);
      setSaveError(false);
    } catch {
      pending = { ...values, ...pending };
      setSaveError(true);
    } finally {
      clearTimeout(timeout);
      inFlight = undefined;
      if (!saveError && Object.keys(pending).length) {
        clearTimeout(timer);
        timer = setTimeout(() => { void flush(); }, 300);
      }
    }
  })();
  return inFlight;
}
export async function loadProfile() {
  try {
    const response = await fetch("/api/webui/profile", {signal: AbortSignal.timeout(5000)});
    if (!response.ok) return;
    const profile = await response.json();
    enabled = profile.enabled === true;
    if (enabled) {
      const unsaved = readPending();
      for (const key of keys) {
        if (typeof unsaved[key] === "string") saveSetting(key, unsaved[key]);
        else if (typeof profile.ui?.[key] === "string") localStorage.setItem(key, profile.ui[key]);
        else {
          const existing = localStorage.getItem(key) ?? sessionStorage.getItem(key);
          if (existing !== null) saveSetting(key, existing);
        }
      }
    }
  } catch { /* Browser settings remain usable when the profile is unavailable. */ }
}
window.addEventListener("pagehide", () => { void flush(); });

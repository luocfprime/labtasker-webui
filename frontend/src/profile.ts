const keys = ["labtasker:views:v1", "labtasker:column-widths", "labtasker:columns:v3", "labtasker:customColumns:v1", "labtasker:columnOrder:v1", "labtasker:drawerWidth", "labtasker:lastQueue", "labtasker:filterPresets:v1", "labtasker:filters:v1"];
let enabled = false;
let pending: Record<string, string> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
export function saveSetting(key: string, value: string) {
  localStorage.setItem(key, value);
  if (!enabled || !keys.includes(key)) return;
  pending[key] = value;
  clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, 300);
}
async function flush() {
  const values = pending;
  if (!Object.keys(values).length) return;
  pending = {};
  try {
    const response = await fetch("/api/webui/profile", { method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify(values), keepalive: true });
    if (!response.ok) throw new Error("Profile save failed");
  } catch {
    pending = { ...values, ...pending };
    const toast = document.getElementById("toast");
    if (toast) toast.textContent = "Profile could not be saved. Settings remain in this browser.";
  }
}
export async function loadProfile() {
  try {
    const response = await fetch("/api/webui/profile", {signal: AbortSignal.timeout(5000)});
    if (!response.ok) return;
    const profile = await response.json();
    enabled = profile.enabled === true;
    if (enabled) {
      for (const key of keys) {
        if (typeof profile.ui?.[key] === "string") localStorage.setItem(key, profile.ui[key]);
        else {
          const existing = localStorage.getItem(key) ?? sessionStorage.getItem(key);
          if (existing !== null) saveSetting(key, existing);
        }
      }
    }
  } catch { /* Browser settings remain usable when the profile is unavailable. */ }
}
window.addEventListener("pagehide", () => { void flush(); });

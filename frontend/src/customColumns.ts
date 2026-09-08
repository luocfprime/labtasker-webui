export function pathParts(path: string): string[] | null {
  const normalized = path.trim().replace(/^\$\./, "").replace(/\[(\d+)\]/g, ".$1");
  if (!/^[A-Za-z_$][\w$]*(\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(normalized)) return null;
  const parts = normalized.split(".");
  return parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part)) ? null : parts;
}
export function pathValue(task: unknown, path: string): string {
  const parts = pathParts(path);
  if (!parts) return "";
  let value: unknown = task;
  for (const part of parts) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return "";
    value = (value as Record<string, unknown>)[part];
  }
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function readSavedList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
  } catch { return []; }
}

import { useState, useSyncExternalStore } from "react";

type VersionInfo = { server: string; client: string; older: boolean };
let current: VersionInfo | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => current;

export function observeVersionHeaders(headers: Headers | undefined) {
  const client = headers?.get("Labtasker-Client-Version");
  // Responses without an upstream observation (e.g. profile saves) leave it unchanged.
  if (!client) return;
  const server = headers?.get("Labtasker-Server-Version") || "";
  const older = headers?.get("Labtasker-Server-Upgrade-Recommended") === "true";
  if (current?.server === server && current.client === client && current.older === older) return;
  current = { server, client, older };
  listeners.forEach(listener => listener());
}

export function ServerVersionWarning() {
  const version = useSyncExternalStore(subscribe, snapshot);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const key = JSON.stringify([version?.server, version?.client]);
  if (!version?.server || !version.older || dismissed.has(key)) return null;
  return (
    <div className="server-version-warning" role="status">
      <span>
        Labtasker Server {version.server} is older than Client {version.client}.
        {" "}Consider upgrading the Server to {version.client} or later; newer features may be unavailable.
      </span>
      <button className="link" aria-label="Dismiss Server version warning"
        onClick={() => setDismissed(previous => new Set(previous).add(key))}>
        Dismiss
      </button>
    </div>
  );
}

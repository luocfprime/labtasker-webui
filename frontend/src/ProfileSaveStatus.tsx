import { CornerNotification } from "./CornerNotification";
import { useState, useSyncExternalStore } from "react";
import { getProfileSaveError, retryProfileSave, subscribeProfileSave } from "./profile";

export function ProfileSaveStatus() {
  const failed = useSyncExternalStore(subscribeProfileSave, getProfileSaveError);
  const [retrying, setRetrying] = useState(false);
  if (!failed) return null;
  return <CornerNotification><div className="profile-save-error" role="alert">
    <span>Could not save settings to disk. Changes are kept in this browser.</span>
    <button className="secondary compact" disabled={retrying} onClick={async () => {
      setRetrying(true);
      try { await retryProfileSave(); } finally { setRetrying(false); }
    }}>{retrying ? "Retrying…" : "Retry"}</button>
  </div></CornerNotification>;
}

import { type ReactNode } from "react";
import { createPortal } from "react-dom";

export function CornerNotification({children}: {children: ReactNode}) {
  return createPortal(children, document.getElementById("corner-notifications") ?? document.body);
}

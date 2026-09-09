import { observeVersionHeaders } from "./ServerVersionWarning";
import { messages as m } from "./messages";
type ApiError = {
  error?: { code: string; message: string; details?: unknown };
  detail?: unknown;
};
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  observeVersionHeaders(response.headers);
  if (!response.ok) {
    let body: ApiError = {};
    try {
      body = await response.json();
    } catch {}
    const message =
      body.error?.message ||
      (typeof body.detail === "string"
        ? body.detail
        : m.errors.requestFailed(response.status));
    if (
      response.status === 401 &&
      !url.endsWith("/status") &&
      !url.endsWith("/connect")
    ) {
      dispatchEvent(new CustomEvent("labtasker:unauthorized"));
    }
    throw new ApiRequestError(
      message,
      response.status,
      body.error?.code || "request_failed",
      body.error?.details || body.detail,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

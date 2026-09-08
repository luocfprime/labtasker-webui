export function isPermanentRequestError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = error.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
export function retryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 3 && !isPermanentRequestError(error);
}

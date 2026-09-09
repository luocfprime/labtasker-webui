import { useCallback, useState, useSyncExternalStore } from "react";
import { CornerNotification } from "./CornerNotification";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { ApiRequestError } from "./api";

type NoticeGroup = {queries: Query[]; labels: Set<string>};
type PendingRetry = {message: string; token: symbol};

const labels: Record<string, string> = {
  "route-tasks": "Task route counts",
  "route-workers": "Worker counts",
  workers: "Worker list",
};

// Observe the existing requests so hidden/collapsed panels cannot hide failures.
export function ObservationNotices({server, queue}: {server: string; queue: string}) {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  const relevant = useCallback((query: Query) =>
    Object.hasOwn(labels, String(query.queryKey[0])) &&
    query.queryKey[1] === server && query.queryKey[2] === queue &&
    query.getObserversCount() > 0, [server, queue]);
  const subscribe = useCallback((changed: () => void) => cache.subscribe(changed), [cache]);
  const snapshot = useCallback(() => JSON.stringify(cache.getAll().filter(relevant).map(query => [
    query.queryHash, query.state.errorUpdatedAt, query.state.dataUpdatedAt,
    query.state.status, query.state.fetchStatus, query.state.error?.message,
  ])), [cache, relevant]);
  useSyncExternalStore(subscribe, snapshot);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [retrying, setRetrying] = useState<Map<string, PendingRetry>>(() => new Map());
  const groups = new Map<string, NoticeGroup>();
  for (const query of cache.getAll().filter(relevant)) {
    const error = query.state.error;
    if (query.state.fetchMeta?.fetchMore) continue;
    const message = error
      ? error instanceof ApiRequestError && error.status === 501
        ? "Not supported by this Server." : error.message
      : retrying.get(query.queryHash)?.message;
    if (!message) continue;
    const group = groups.get(message) || {queries: [], labels: new Set<string>()};
    group.queries.push(query);
    group.labels.add(labels[String(query.queryKey[0])]);
    groups.set(message, group);
  }
  const dismiss = (message: string) => setDismissed(current => new Set([...current, message]));
  return <CornerNotification><div className="observation-notices" aria-label="Observation notifications">
    {[...groups].filter(([message]) => !dismissed.has(message)).map(([message, group]) => {
      const fetching = group.queries.some(query => retrying.has(query.queryHash) || query.state.fetchStatus === "fetching");
      const updated = Math.min(...group.queries.map(query => query.state.dataUpdatedAt));
      return <div className="observation-notice" key={message} onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); dismiss(message); }
      }}>
        <div role="status"><strong>{message}</strong><p>{[...group.labels].join(" · ")}</p>
          {updated > 0 && <p>Last successful update: {new Date(updated).toLocaleTimeString()}.</p>}
        </div>
        <div className="observation-notice-actions">
          <button className="link" disabled={fetching} onClick={() => {
            const hashes = new Set(group.queries.map(query => query.queryHash));
            const token = Symbol();
            setRetrying(current => {
              const next = new Map(current);
              for (const hash of hashes) next.set(hash, {message, token});
              return next;
            });
            for (const hash of hashes) {
              void client.refetchQueries({predicate: query => query.queryHash === hash}).finally(() => {
                setRetrying(current => {
                  if (current.get(hash)?.token !== token) return current;
                  const next = new Map(current);
                  next.delete(hash);
                  return next;
                });
              });
            }
          }}>{fetching ? "Retrying…" : "Retry"}</button>
          <button className="link" aria-label="Dismiss notification" onClick={() => dismiss(message)}>Dismiss</button>
        </div>
      </div>;
    })}
  </div></CornerNotification>;
}

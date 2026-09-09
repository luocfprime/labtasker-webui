import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, ApiRequestError } from "./api";
import { Select } from "./Select";
import { combineRoutes, readGroups, workerFilter, workerFreshness, type Worker } from "./workerData";
import { isPermanentRequestError } from "./queryPolicy";

const polling = (query: {state: {error: Error | null}}) => document.hidden || (isPermanentRequestError(query.state.error) || query.state.error instanceof ApiRequestError && query.state.error.status === 501) ? false : 15_000;
function duration(ms: number) { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
export function ObservationError({error, updatedAt, retry}: {error: Error | null; updatedAt: number; retry: () => void}) {
  if (!error) return null;
  return <div className="observation-error" role="status">
    <span>{error instanceof ApiRequestError && error.status === 501 ? "Not supported by this Server." : error.message}
      {updatedAt > 0 && <> Last successful update: {new Date(updatedAt).toLocaleTimeString()}.</>}</span>
    <button className="link" onClick={retry}>Retry</button>
  </div>;
}
export function useRouteCounts(queue: string, server: string, inactive: boolean) {
  const prefix = `/api/webui/queues/${encodeURIComponent(queue)}`;
  const tasks = useQuery({queryKey: ["route-tasks", server, queue, inactive], queryFn: () => readGroups(`${prefix}/task-groups?include_inactive=${inactive}`), refetchInterval: polling, retry: (n, error) => n < 3 && !(error instanceof ApiRequestError && error.status === 501) && !isPermanentRequestError(error)});
  const workers = useQuery({queryKey: ["route-workers", server, queue], queryFn: () => readGroups(`${prefix}/worker-groups`), refetchInterval: polling, retry: (n, error) => n < 3 && !(error instanceof ApiRequestError && error.status === 501) && !isPermanentRequestError(error)});
  const rows = useMemo(() => combineRoutes(tasks.data || [], workers.data || []), [tasks.data, workers.data]);
  return {tasks, workers, rows};
}
type Counts = ReturnType<typeof useRouteCounts>;
export const RouteCountsContext = createContext<Counts | null>(null);
export function RouteChips({routes}: {routes: string[]}) {
  const counts = useContext(RouteCountsContext);
  return <div className="chips" data-tooltip={routes.join("\n")}>{routes.map(route =>
    <span key={route}>{counts && <RouteDot counts={counts} route={route} />}{route}</span>
  )}</div>;
}
export function RouteDot({counts, route}: {counts: Counts; route: string}) {
  const row = counts.rows.find(item => item.name === route);
  const known = counts.workers.data && !counts.workers.error && counts.tasks.data && !counts.tasks.error;
  const state = !known ? "unknown" : row?.busy ? "busy" : row?.idle ? "idle" : row && row.pending + row.running > 0 ? "waiting" : "inactive";
  const label = {unknown: "Route observations unavailable", busy: "Busy Workers", idle: "Idle Workers", waiting: "Tasks waiting for Workers", inactive: "No active Tasks or Workers"}[state];
  return <i className={`route-dot route-${state}`} role="img" aria-label={label} data-tooltip={label} />;
}
export function RouteSidebar({counts, route, choose, inactive, setInactive}: {
  counts: Counts; route: string; choose: (route: string) => void;
  inactive: boolean; setInactive: (value: boolean) => void;
}) {
  const rows = counts.rows;
  const workersKnown = !!counts.workers.data && !counts.workers.error;
  const tasksKnown = !!counts.tasks.data && !counts.tasks.error;
  return <aside className="route-sidebar" aria-label="Routes">
    <div className="route-list">
      <button className={`route-item route-all${!route ? " active" : ""}`} aria-pressed={!route} onClick={() => choose("")}>All routes</button>
      {route && !rows.some(row => row.name === route) && <button className="route-item active" aria-pressed={true} data-tooltip={route} onClick={() => choose(route)}><span>{route}</span><small>No current route summary</small></button>}
      {rows.map(row => <button key={row.name} className={`route-item${route === row.name ? " active" : ""}`} aria-pressed={route === row.name} onClick={() => choose(row.name)}>
        <span className="route-name" data-tooltip={row.name}><RouteDot counts={counts} route={row.name} />{row.name}</span>
        <small>{tasksKnown ? <>{row.pending} Pending{row.running > 0 && <> · {row.running} Running</>}</> : "Task counts unavailable"}</small>
        <small>{!workersKnown ? "Worker counts unavailable" : row.idle + row.busy ? <>{row.idle} Idle · {row.busy} Busy</> : <span className={row.pending || row.running ? "observation-delayed" : ""}>{row.pending || row.running ? "No active Workers" : "Inactive"}</span>}</small>
      </button>)}
      {(counts.tasks.isLoading || counts.workers.isLoading) && <small>Loading routes…</small>}
    </div>
    <label className="inactive-routes"><input type="checkbox" checked={inactive} onChange={event => setInactive(event.target.checked)} /> Include inactive routes</label>
    <ObservationError error={counts.tasks.error} updatedAt={counts.tasks.dataUpdatedAt} retry={() => void counts.tasks.refetch()} />
    <ObservationError error={counts.workers.error} updatedAt={counts.workers.dataUpdatedAt} retry={() => void counts.workers.refetch()} />
  </aside>;
}
export function WorkersPanel({queue, server, route, counts, status, setStatus, openTask}: {
  queue: string; server: string; route: string; counts: Counts;
  status: string; setStatus: (status: string) => void; openTask: (id: string) => void;
}) {
  const filter = workerFilter(route, status);
  const list = useInfiniteQuery({
    queryKey: ["workers", server, queue, filter], initialPageParam: null as string | null,
    queryFn: ({pageParam}) => {
      const params = new URLSearchParams();
      if (filter) params.set("filter", filter);
      if (pageParam) params.set("cursor", pageParam);
      return api<{items: Worker[]; next_cursor: string | null}>(`/api/webui/queues/${encodeURIComponent(queue)}/workers?${params}`);
    },
    getNextPageParam: (page, _pages, _last, cursors) => page.next_cursor && !cursors.includes(page.next_cursor) ? page.next_cursor : undefined,
    refetchInterval: polling,
    retry: (n, error) => n < 3 && !(error instanceof ApiRequestError && error.status === 501) && !isPermanentRequestError(error),
  });
  const scroll = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scroll.current || !sentinel.current || !list.hasNextPage || list.isFetching || list.isFetchNextPageError) return;
    const observer = new IntersectionObserver(([entry]) => {if (entry.isIntersecting) void list.fetchNextPage({cancelRefetch: false});}, {root: scroll.current, rootMargin: "100px"});
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [list.hasNextPage, list.isFetching, list.isFetchNextPageError, list.fetchNextPage]);
  useEffect(() => {scroll.current?.scrollTo({top: 0});}, [route, status]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {const timer = setInterval(() => {if (!document.hidden) setNow(Date.now());}, 1000);return () => clearInterval(timer);}, []);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages.flatMap(page => page.items) || []).filter(w => {if (seen.has(w.id)) return false;seen.add(w.id);return true;});
  }, [list.data]);
  const groups = counts.workers.data?.filter(g => !route || g.key.route === route);
  const idle = groups?.filter(g => g.key.status === "idle").reduce((n,g) => n+g.count,0);
  const busy = groups?.filter(g => g.key.status === "busy").reduce((n,g) => n+g.count,0);
  const unavailable = !groups || !!counts.workers.error;
  return <section className="workers-panel" aria-label="Workers">
    <div className="worker-stats">
      <button aria-pressed={!status} onClick={() => setStatus("")}><strong>{unavailable ? "—" : idle!+busy!}</strong> All</button>
      <button className="worker-idle-count" aria-pressed={status === "idle"} onClick={() => setStatus(status === "idle" ? "" : "idle")}><strong>{unavailable ? "—" : idle}</strong> Idle</button>
      <button className="worker-busy-count" aria-pressed={status === "busy"} onClick={() => setStatus(status === "busy" ? "" : "busy")}><strong>{unavailable ? "—" : busy}</strong> Busy</button>
    </div>
    <div className="worker-toolbar"><Select label="Worker status" value={status} onChange={setStatus} options={[{value: "", label: "All statuses"}, {value: "idle", label: "Idle"}, {value: "busy", label: "Busy"}]} /><span>Latest Worker observations</span></div>
    <ObservationError error={list.error} updatedAt={list.dataUpdatedAt} retry={() => void list.refetch()} />
    <ObservationError error={counts.workers.error} updatedAt={counts.workers.dataUpdatedAt} retry={() => void counts.workers.refetch()} />
    <div className="worker-table table-wrap" ref={scroll}>
      <table><thead><tr><th>Worker</th><th>Status</th><th>Route</th><th>Task</th><th>Last seen</th></tr></thead><tbody>
        {rows.map(w => {const freshness = workerFreshness(w, now);return <tr key={w.id}>
          <td><code data-tooltip={w.id}>{w.id}</code></td><td><span className={`badge worker-${w.status}`}>{w.status === "idle" ? "Idle" : "Busy"}</span></td>
          <td><span className="worker-route" data-tooltip={w.route}><RouteDot counts={counts} route={w.route} />{w.route}</span></td>
          <td>{w.task_id ? <button className="link" data-tooltip={w.task_id} onClick={() => openTask(w.task_id!)}>{w.task_id}</button> : "—"}</td>
          <td><time dateTime={w.last_seen_at} data-tooltip={new Date(w.last_seen_at).toLocaleString()}>{duration(freshness.age)} ago</time>
            {!list.error && freshness.delayed && <small className="observation-delayed">{freshness.expired ? "Observation expired" : `Update delayed · Expires in ${duration(freshness.remaining)}`}</small>}
          </td>
        </tr>;})}
      </tbody></table>
      {list.isLoading && <div className="loading">Loading Workers…</div>}
      {!list.isLoading && !list.error && !rows.length && <div className="empty"><h2>No active Worker observations</h2><p>{status ? "No Workers match this state." : "Task execution and Worker observations are independent."}</p></div>}
      <div ref={sentinel} className="load-more">{list.isFetchingNextPage ? "Loading Workers…" : list.isFetchNextPageError && <button onClick={() => void list.fetchNextPage()}>Retry loading</button>}</div>
    </div>
    <div className="list-summary">{rows.length} loaded · {list.dataUpdatedAt ? `Updated ${new Date(list.dataUpdatedAt).toLocaleTimeString()}` : "Waiting for observations"}</div>
  </section>;
}

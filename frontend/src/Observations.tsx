import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type OnChangeFn,
} from "@tanstack/react-table";
import { api, ApiRequestError } from "./api";
import { Select } from "./Select";
import { combineRoutes, readGroups, workerFilter, workerFreshness, type Worker } from "./workerData";
import { isPermanentRequestError } from "./queryPolicy";

const polling = (query: {state: {error: Error | null}}) => document.hidden || (isPermanentRequestError(query.state.error) || query.state.error instanceof ApiRequestError && query.state.error.status === 501) ? false : 15_000;
function duration(ms: number) { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
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
        <small>{!workersKnown ? "Worker counts unavailable" : row.idle + row.busy ? <>{row.idle} Idle · {row.busy} Busy</> : <span className={tasksKnown && (row.pending || row.running) ? "observation-delayed" : ""}>{!tasksKnown || row.pending || row.running ? "No active Workers" : "Inactive"}</span>}</small>
      </button>)}
      {(counts.tasks.isLoading || counts.workers.isLoading) && <small>Loading routes…</small>}
    </div>
    {(counts.tasks.error || counts.workers.error) && <small className="muted">Route counts unavailable</small>}
    <label className="inactive-routes"><span>Inactive routes</span><input type="checkbox" aria-label="Include inactive routes" checked={inactive} onChange={event => setInactive(event.target.checked)} /><span className="inactive-switch" aria-hidden="true" /></label>
  </aside>;
}
export function WorkersPanel({queue, server, route, counts, status, setStatus, openTask, columnSizing, setColumnSizing, notify}: {
  queue: string; server: string; route: string; counts: Counts;
  status: string; setStatus: (status: string) => void; openTask: (id: string) => void;
  columnSizing: ColumnSizingState; setColumnSizing: OnChangeFn<ColumnSizingState>;
  notify: (message: string) => void;
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
  const columns = useMemo<ColumnDef<Worker>[]>(() => [
    {
      id: "worker", header: "Worker", size: 240,
      cell: ({row}) => <code data-tooltip={row.original.id}>{row.original.id}</code>,
    },
    {
      id: "status", header: "Status", size: 100,
      cell: ({row}) => <span className={`badge worker-${row.original.status}`}>{row.original.status === "idle" ? "Idle" : "Busy"}</span>,
    },
    {
      id: "route", header: "Route", size: 200,
      cell: ({row}) => <span className="worker-route" data-tooltip={row.original.route}><RouteDot counts={counts} route={row.original.route} />{row.original.route}</span>,
    },
    {
      id: "task", header: "Task", size: 240,
      cell: ({row}) => row.original.task_id ? <button className="link" data-task-link={row.original.task_id} data-tooltip={row.original.task_id} onClick={() => openTask(row.original.task_id!)}>{row.original.task_id}</button> : "—",
    },
    {
      id: "lastSeen", header: "Last seen", size: 210,
      cell: ({row}) => {
        const freshness = workerFreshness(row.original, now);
        return <><time dateTime={row.original.last_seen_at} data-tooltip={new Date(row.original.last_seen_at).toLocaleString()}>{duration(freshness.age)} ago</time>
          {!list.error && freshness.delayed && <small className="observation-delayed">{freshness.expired ? "Observation expired" : `Update delayed · Expires in ${duration(freshness.remaining)}`}</small>}</>;
      },
    },
  ], [counts, list.error, now, openTask]);
  const table = useReactTable({
    data: rows,
    columns,
    columnResizeMode: "onChange",
    onColumnSizingChange: setColumnSizing,
    defaultColumn: {minSize: 60, maxSize: 10000, size: 160},
    getRowId: worker => worker.id,
    state: {columnSizing},
    getCoreRowModel: getCoreRowModel(),
  });
  const fitColumn = (id: string) => {
    const column = table.getColumn(id);
    const header = scroll.current?.querySelector<HTMLElement>(`th[data-column-id="${id}"]`);
    if (!column?.getCanResize() || !header) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    const sample = scroll.current?.querySelector<HTMLElement>(`td[data-column-id="${id}"]`);
    const measure = (text: string, element: Element = sample || header) => {
      const style = getComputedStyle(element);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return context.measureText(text).width;
    };
    let width = measure(String(column.columnDef.header), header) + 36;
    for (const worker of rows) {
      const freshness = workerFreshness(worker, now);
      const value = id === "worker" ? worker.id
        : id === "status" ? (worker.status === "idle" ? "Idle" : "Busy")
          : id === "route" ? worker.route
            : id === "task" ? worker.task_id || "—"
              : freshness.delayed
                ? `${duration(freshness.age)} ago ${freshness.expired ? "Observation expired" : `Update delayed · Expires in ${duration(freshness.remaining)}`}`
                : `${duration(freshness.age)} ago`;
      width = Math.max(width, measure(value) + (id === "status" ? 38 : id === "route" ? 42 : 24));
    }
    const fitted = Math.min(10000, Math.max(60, Math.ceil(width)));
    setColumnSizing(current => ({...current, [id]: fitted}));
    notify(`${String(column.columnDef.header)} fitted to content · ${fitted}px`);
  };
  return <section className="workers-panel" aria-label="Workers">
    <div className="worker-stats">
      <button aria-pressed={!status} onClick={() => setStatus("")}><strong>{unavailable ? "—" : idle!+busy!}</strong> All</button>
      <button className="worker-idle-count" aria-pressed={status === "idle"} onClick={() => setStatus(status === "idle" ? "" : "idle")}><strong>{unavailable ? "—" : idle}</strong> Idle</button>
      <button className="worker-busy-count" aria-pressed={status === "busy"} onClick={() => setStatus(status === "busy" ? "" : "busy")}><strong>{unavailable ? "—" : busy}</strong> Busy</button>
    </div>
    <div className="worker-toolbar"><Select label="Worker status" value={status} onChange={setStatus} options={[{value: "", label: "All statuses"}, {value: "idle", label: "Idle"}, {value: "busy", label: "Busy"}]} /><span>Latest Worker observations</span></div>
    {list.error && <p className="muted">Worker observations unavailable. Use Refresh to retry.</p>}
    <div className="worker-table table-wrap" ref={scroll}>
      <table style={{width: table.getTotalSize(), minWidth: "100%"}}>
        <colgroup>
          {table.getVisibleLeafColumns().map(column => <col key={column.id} style={{width: column.getSize()}} />)}
          <col className="table-filler" />
        </colgroup>
        <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>
          {group.headers.map(header => <th key={header.id} data-column-id={header.column.id}
            aria-label={String(header.column.columnDef.header)}
            data-tooltip={`${String(header.column.columnDef.header)} · Double-click to fit content`}
            onDoubleClick={() => fitColumn(header.column.id)}>
            {flexRender(header.column.columnDef.header, header.getContext())}
            {header.column.getCanResize() && <span className="column-resizer" role="separator" aria-orientation="vertical"
              aria-label={`Resize ${String(header.column.columnDef.header)}`}
              aria-valuenow={header.column.getSize()} aria-valuemin={header.column.columnDef.minSize ?? 60}
              aria-valuemax={header.column.columnDef.maxSize ?? 10000} tabIndex={0}
              onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()}
              onDoubleClick={event => {event.stopPropagation();fitColumn(header.column.id);}}
              onKeyDown={event => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const min = header.column.columnDef.minSize ?? 60;
                const max = header.column.columnDef.maxSize ?? 10000;
                const size = Math.min(max, Math.max(min, header.column.getSize() + (event.key === "ArrowRight" ? 16 : -16)));
                setColumnSizing(current => ({...current, [header.column.id]: size}));
              }} />}
          </th>)}
          <th className="table-filler" aria-hidden="true" />
        </tr>)}</thead>
        <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>
          {row.getVisibleCells().map(cell => <td key={cell.id} data-column-id={cell.column.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>)}
          <td className="table-filler" aria-hidden="true" />
        </tr>)}</tbody>
      </table>
      {list.isLoading && <div className="loading">Loading Workers…</div>}
      {!list.isLoading && !list.error && !rows.length && <div className="empty"><h2>No active Worker observations</h2><p>{status ? "No Workers match this state." : "Task execution and Worker observations are independent."}</p></div>}
      <div ref={sentinel} className="load-more">{list.isFetchingNextPage ? "Loading Workers…" : list.isFetchNextPageError && <button onClick={() => void list.fetchNextPage()}>Retry loading</button>}</div>
    </div>
    <div className="list-summary">{rows.length} loaded · {list.dataUpdatedAt ? `Updated ${new Date(list.dataUpdatedAt).toLocaleTimeString()}` : "Waiting for observations"}</div>
  </section>;
}

export function QueueWorkerSummary({queue, server}: {queue: string; server: string}) {
  const {workers, tasks, rows} = useRouteCounts(queue, server, false);
  const count = (status: string) => workers.data?.filter(g => g.key.status === status).reduce((n, g) => n + g.count, 0) ?? 0;
  const routesKnown = workers.data && tasks.data && !workers.error && !tasks.error;
  const busy = rows.filter(row => row.busy > 0).length;
  const idle = rows.filter(row => !row.busy && row.idle > 0).length;
  const waiting = rows.filter(row => !row.busy && !row.idle && row.pending + row.running > 0).length;
  return <div className="queue-observation-summary">
    <div className="queue-worker-summary"><span>Workers</span>{workers.error ? <span>Unavailable</span> : !workers.data ? <span>Loading…</span> : <><span className="queue-worker-busy"><b>{count("busy")}</b> Busy</span><span className="queue-worker-idle"><b>{count("idle")}</b> Idle</span></>}</div>
    <div className="queue-route-summary"><span>Routes</span>{!routesKnown ? <span>{workers.error || tasks.error ? "Unavailable" : "Loading…"}</span> : <><span className="queue-route-waiting" data-tooltip="Task demand without active Workers"><b>{waiting}</b> Waiting</span><span className="queue-worker-busy" data-tooltip="Routes with Busy Workers"><b>{busy}</b> Busy</span>{idle > 0 && <span className="queue-worker-idle" data-tooltip="Routes with Idle Workers and no Busy Workers"><b>{idle}</b> Idle</span>}</>}</div>
  </div>;
}

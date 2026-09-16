import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
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
import { FilterInput } from "./FilterInput";
import { JsonBlock } from "./JsonView";
import { pathValue } from "./customColumns";
import { useAnchoredPanel } from "./useAnchoredPanel";
import { workerColumns, workerPath } from "./workspacePreferences";
import { saveSetting } from "./profile";

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
type WorkerLayout = {
  visible: string[];
  custom: string[];
  order: string[];
  widths: ColumnSizingState;
};
const workerLabels: Record<string, string> = {
  worker: "Worker", status: "Status", route: "Route", task: "Task", lastSeen: "Last seen",
};

export function WorkersPanel({queue, server, route, counts, status, setStatus, filter, setFilter, openTask, openWorker, layout, setLayout, notify}: {
  queue: string; server: string; route: string; counts: Counts;
  status: string; setStatus: (status: string) => void; openTask: (id: string) => void;
  filter: string; setFilter: (filter: string) => void; openWorker: (id: string) => void;
  layout: WorkerLayout; setLayout: (layout: WorkerLayout | ((current: WorkerLayout) => WorkerLayout)) => void;
  notify: (message: string) => void;
}) {
  const [draftFilter, setDraftFilter] = useState(filter);
  useEffect(() => setDraftFilter(filter), [filter]);
  const queryFilter = workerFilter(route, status, filter);
  const list = useInfiniteQuery({
    queryKey: ["workers", server, queue, queryFilter], initialPageParam: null as string | null,
    queryFn: ({pageParam}) => {
      const params = new URLSearchParams();
      if (queryFilter) params.set("filter", queryFilter);
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
  const builtInColumns = useMemo<ColumnDef<Worker>[]>(() => [
    {
      id: "worker", header: "Worker", size: 240,
      cell: ({row}) => <button type="button" className="link worker-link" data-worker-link={row.original.id} data-tooltip={row.original.id} onClick={event => {event.stopPropagation(); openWorker(row.original.id);}}>{row.original.id}</button>,
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
      cell: ({row}) => row.original.task_id ? <button className="link" data-task-link={row.original.task_id} data-tooltip={row.original.task_id} onClick={event => {event.stopPropagation(); openTask(row.original.task_id!);}}>{row.original.task_id}</button> : "—",
    },
    {
      id: "lastSeen", header: "Last seen", size: 210,
      cell: ({row}) => {
        const freshness = workerFreshness(row.original, now);
        return <><time dateTime={row.original.last_seen_at} data-tooltip={new Date(row.original.last_seen_at).toLocaleString()}>{duration(freshness.age)} ago</time>
          {!list.error && freshness.delayed && <small className="observation-delayed">{freshness.expired ? "Observation expired" : `Update delayed · Expires in ${duration(freshness.remaining)}`}</small>}</>;
      },
    },
  ], [counts, list.error, now, openTask, openWorker]);
  const columnIds = [...workerColumns, ...layout.custom.map(path => `path:${path}`)];
  const orderedIds = [...layout.order.filter(id => columnIds.includes(id)), ...columnIds.filter(id => !layout.order.includes(id))];
  const columns = useMemo(() => {
    const byId = new Map(builtInColumns.map(column => [column.id, column]));
    for (const path of layout.custom) {
      byId.set(`path:${path}`, {
        id: `path:${path}`, header: path, size: 160,
        cell: ({row}: {row: {original: Worker}}) => pathValue(row.original, path),
      });
    }
    return orderedIds.map(id => byId.get(id)).filter((column): column is ColumnDef<Worker> => !!column);
  }, [builtInColumns, layout.custom, orderedIds.join("\n")]);
  const table = useReactTable({
    data: rows,
    columns,
    columnResizeMode: "onChange",
    onColumnSizingChange: (updater: Parameters<OnChangeFn<ColumnSizingState>>[0]) => setLayout(current => ({...current, widths: typeof updater === "function" ? updater(current.widths) : updater})),
    defaultColumn: {minSize: 60, maxSize: 10000, size: 160},
    getRowId: worker => worker.id,
    state: {
      columnSizing: layout.widths,
      columnVisibility: Object.fromEntries(columnIds.map(id => [id, layout.visible.includes(id)])),
    },
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
      const value = id.startsWith("path:") ? pathValue(worker, id.slice(5))
        : id === "worker" ? worker.id
        : id === "status" ? (worker.status === "idle" ? "Idle" : "Busy")
          : id === "route" ? worker.route
            : id === "task" ? worker.task_id || "—"
              : freshness.delayed
                ? `${duration(freshness.age)} ago ${freshness.expired ? "Observation expired" : `Update delayed · Expires in ${duration(freshness.remaining)}`}`
                : `${duration(freshness.age)} ago`;
      width = Math.max(width, measure(value) + (id === "status" ? 38 : id === "route" ? 42 : 24));
    }
    const fitted = Math.min(10000, Math.max(60, Math.ceil(width)));
    setLayout(current => ({...current, widths: {...current.widths, [id]: fitted}}));
    notify(`${String(column.columnDef.header)} fitted to content · ${fitted}px`);
  };
  return <section className="workers-panel" aria-label="Workers">
    <div className="worker-stats">
      <button aria-pressed={!status} onClick={() => setStatus("")}><strong>{unavailable ? "—" : idle!+busy!}</strong> All</button>
      <button className="worker-idle-count" aria-pressed={status === "idle"} onClick={() => setStatus(status === "idle" ? "" : "idle")}><strong>{unavailable ? "—" : idle}</strong> Idle</button>
      <button className="worker-busy-count" aria-pressed={status === "busy"} onClick={() => setStatus(status === "busy" ? "" : "busy")}><strong>{unavailable ? "—" : busy}</strong> Busy</button>
    </div>
    <div className="toolbar worker-toolbar">
      <Select label="Worker status" value={status} onChange={setStatus} options={[{value: "", label: "All statuses"}, {value: "idle", label: "Idle"}, {value: "busy", label: "Busy"}]} />
      <FilterInput kind="worker" label="Worker advanced filter" value={draftFilter} onChange={setDraftFilter}
        onApply={() => setFilter(draftFilter)} onCommit={setFilter} />
      <WorkerColumnMenu layout={layout} setLayout={setLayout} />
      <button className="secondary compact" onClick={() => setFilter(draftFilter)}>Apply</button>
    </div>
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
                setLayout(current => ({...current, widths: {...current.widths, [header.column.id]: size}}));
              }} />}
          </th>)}
          <th className="table-filler" aria-hidden="true" />
        </tr>)}</thead>
        <tbody>{table.getRowModel().rows.map(row => <tr key={row.id} data-worker-id={row.original.id} tabIndex={0}
          onClick={() => openWorker(row.original.id)}
          onKeyDown={event => {if (event.currentTarget === event.target && (event.key === "Enter" || event.key === " ")) {event.preventDefault(); openWorker(row.original.id);}}}>
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

function WorkerColumnMenu({layout, setLayout}: {
  layout: WorkerLayout;
  setLayout: (layout: WorkerLayout | ((current: WorkerLayout) => WorkerLayout)) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("");
  const [pathError, setPathError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useAnchoredPanel(open, trigger, panel, 370, "right");
  const ids = [...workerColumns, ...layout.custom.map(path => `path:${path}`)];
  const ordered = [...layout.order.filter(id => ids.includes(id)), ...ids.filter(id => !layout.order.includes(id))];
  const label = (id: string) => id.startsWith("path:") ? id.slice(5) : workerLabels[id];
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const dismissFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismissFocus);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismissFocus);
    };
  }, [open]);
  const move = (id: string, offset: number) => {
    const next = [...ordered];
    const index = next.indexOf(id);
    if (index + offset < 0 || index + offset >= next.length) return;
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setLayout(current => ({...current, order: next}));
  };
  return <div className="column-menu worker-column-menu" ref={root}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault(); setOpen(false); trigger.current?.focus();
      }
    }}>
    <button ref={trigger} type="button" aria-label="Worker columns" aria-expanded={open} onClick={() => setOpen(value => !value)}>Columns</button>
    {open && <div ref={panel} aria-label="Worker columns menu">
      <div className="column-list">
        {ordered.map(column => <div className={`column-choice${dropColumn === column ? " drop-target" : ""}`} key={column}
          data-column-order-id={column}
          onDragOver={event => {if (dragColumn) {event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropColumn(column);}}}
          onDrop={event => {
            event.preventDefault();
            if (dragColumn && dragColumn !== column) {
              const next = [...ordered];
              const from = next.indexOf(dragColumn), to = next.indexOf(column);
              next.splice(from, 1); next.splice(to, 0, dragColumn);
              setLayout(current => ({...current, order: next}));
            }
            setDragColumn(null); setDropColumn(null);
          }}>
          <button type="button" className="column-drag-handle" draggable aria-label={`Reorder ${label(column)}`}
            data-tooltip="Drag to reorder · Arrow keys to move"
            onDragStart={event => {setDragColumn(column); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", column);}}
            onDragEnd={() => {setDragColumn(null); setDropColumn(null);}}
            onKeyDown={event => {if (["ArrowUp", "ArrowDown"].includes(event.key)) {event.preventDefault(); move(column, event.key === "ArrowUp" ? -1 : 1);}}}>⠿</button>
          <label><input type="checkbox" checked={layout.visible.includes(column)} onChange={() => setLayout(current => ({
            ...current,
            visible: current.visible.includes(column) ? current.visible.filter(id => id !== column) : [...current.visible, column],
          }))} /><span data-tooltip={label(column)}>{label(column)}</span></label>
          {column.startsWith("path:") && <button type="button" aria-label={`Remove ${label(column)}`} onClick={() => setLayout(current => ({
            ...current,
            custom: current.custom.filter(path => `path:${path}` !== column),
            visible: current.visible.filter(id => id !== column),
            order: current.order.filter(id => id !== column),
            widths: Object.fromEntries(Object.entries(current.widths).filter(([id]) => id !== column)),
          }))}>×</button>}
        </div>)}
      </div>
      <form className="custom-column-form" onSubmit={event => {
        event.preventDefault();
        const path = newPath.trim();
        if (!workerPath(path)) {setPathError("Use a metadata.* or telemetry.* path, e.g. telemetry.gpu.utilization."); return;}
        if (layout.custom.includes(path)) {setPathError("This column already exists."); return;}
        setLayout(current => ({...current, custom: [...current.custom, path], visible: [...current.visible, `path:${path}`]}));
        setNewPath(""); setPathError("");
      }}>
        <label htmlFor="worker-custom-column-path">Worker custom column · JSON path</label>
        <div><input id="worker-custom-column-path" value={newPath} placeholder="metadata.hostname" onChange={event => setNewPath(event.target.value)} />
          <button type="submit" aria-label="Add Worker column">Add</button></div>
        <small>Use metadata.* or telemetry.*. Missing values stay blank.</small>
        {pathError && <small role="alert">{pathError}</small>}
      </form>
    </div>}
  </div>;
}

function WorkerTime({value}: {value: string | null}) {
  if (!value) return <>—</>;
  return <time dateTime={value} data-tooltip={new Date(value).toISOString()}>{new Date(value).toLocaleString()}</time>;
}

export function WorkerDrawer({queue, server, workerId, close, openTask}: {
  queue: string; server: string; workerId: string;
  close: (replaceHistory?: boolean) => void; openTask: (id: string) => void;
}) {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem("labtasker:drawerWidth"));
    return Number.isFinite(stored) && stored >= 480 && stored <= 800 ? stored : 600;
  });
  const query = useQuery({
    queryKey: ["worker", server, queue, workerId],
    queryFn: async () => {
      const params = new URLSearchParams({filter: `id == ${JSON.stringify(workerId)}`});
      const page = await api<{items: Worker[]}>(`/api/webui/queues/${encodeURIComponent(queue)}/workers?${params}`);
      return page.items.find(worker => worker.id === workerId) || null;
    },
    refetchInterval: polling,
  });
  const worker = query.data;
  const resizeFrom = (startX: number, startWidth: number) => {
    const move = (event: PointerEvent) => setWidth(Math.min(800, Math.max(480, startWidth + startX - event.clientX)));
    const finish = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", finish);
      setWidth(current => {saveSetting("labtasker:drawerWidth", String(current)); return current;});
    };
    addEventListener("pointermove", move); addEventListener("pointerup", finish, {once: true});
  };
  return <Dialog.Root open modal={false} onOpenChange={open => !open && close()}>
    <Dialog.Portal><Dialog.Content asChild aria-describedby={undefined}
      onInteractOutside={event => {
        if (event.target instanceof Element && event.target.closest("[data-worker-id], [data-task-link], #corner-notifications, .observation-notice, .profile-save-error")) event.preventDefault();
        else {event.preventDefault(); close(true);}
      }}>
      <aside className="drawer" aria-label="Worker details" style={{width}}>
        <div className="drawer-resize" role="separator" aria-label="Resize Worker details" aria-orientation="vertical"
          aria-valuemin={480} aria-valuemax={800} aria-valuenow={width} tabIndex={0}
          onPointerDown={event => resizeFrom(event.clientX, width)}
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const next = Math.min(800, Math.max(480, width + (event.key === "ArrowLeft" ? 20 : -20)));
            setWidth(next); saveSetting("labtasker:drawerWidth", String(next));
          }} />
        <div className="drawer-head"><div><Dialog.Title asChild><h2>{workerId}</h2></Dialog.Title></div>
          <Dialog.Close asChild><button className="close" aria-label="Close" /></Dialog.Close>
        </div>
        {query.isLoading ? <div className="loading">Loading Worker…</div>
          : query.error ? <div className="error">{query.error.message}</div>
            : !worker ? <div className="drawer-body"><div className="empty"><h2>Worker observation expired</h2><p>This Worker is no longer present in the active observation list.</p></div></div>
              : <div className="drawer-body">
                <div className="task-summary"><span className={`badge worker-${worker.status}`}>{worker.status === "idle" ? "Idle" : "Busy"}</span><span className="worker-route"><span>{worker.route}</span></span></div>
                <section className="detail-section"><h3>Observation</h3><dl>
                  <dt>Queue</dt><dd>{worker.queue}</dd>
                  <dt>Route</dt><dd>{worker.route}</dd>
                  <dt>Current Task</dt><dd>{worker.task_id ? <button type="button" className="link" data-task-link={worker.task_id}
                    onClick={() => openTask(worker.task_id!)}>{worker.task_id}</button> : "—"}</dd>
                  <dt>Last seen</dt><dd><WorkerTime value={worker.last_seen_at} /></dd>
                  <dt>Expires</dt><dd><WorkerTime value={worker.expires_at} /></dd>
                </dl></section>
                <JsonBlock title="Metadata" value={worker.metadata} />
                <JsonBlock title="Telemetry" value={worker.telemetry} meta={worker.telemetry_updated_at ? <>Updated <WorkerTime value={worker.telemetry_updated_at} /></> : undefined} />
                <JsonBlock title="Raw Worker" value={worker} />
              </div>}
      </aside>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
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

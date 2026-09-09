import { ObservationNotices } from "./ObservationNotices";
import { workspacePreferences, saveWorkspacePreferences } from "./workspacePreferences";
import { api, ApiRequestError } from "./api";
import { QueueWorkerSummary, RouteSidebar, RouteChips, RouteCountsContext, WorkersPanel, useRouteCounts } from "./Observations";
import { effectiveTaskFilter } from "./countFilters";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { saveSetting } from "./profile";
import { pathParts, pathValue } from "./customColumns";
import { isPermanentRequestError } from "./queryPolicy";
import { FilterInput } from "./FilterInput";
import { readQueueLayout, saveQueueLayout } from "./queueLayout";
import { statusCountParams } from "./countFilters";
import { Views } from "./Views";
import { Select } from "./Select";
import { messages as m } from "./messages";
import { ServerVersionWarning } from "./ServerVersionWarning";

export function PriorityValue({ value }: { value: number }) {
  return (
    <span className="priority-value">
      {value}
      {value !== 0 && <span className={`priority-direction ${value > 0 ? "positive" : "negative"}`} aria-hidden="true">{value > 0 ? "↑" : "↓"}</span>}
    </span>
  );
}

function LiveExecutionDuration({ task }: { task: Task }) {
  const now = useExecutionClock(task.status === "running" && task.started_at !== null);
  return <ExecutionDuration task={task} now={now} />;
}

type Status = "pending" | "running" | "succeeded" | "failed" | "cancelled";
type Task = {
  id: string;
  queue: string;
  status: Status;
  name: string | null;
  args: Record<string, unknown>;
  metadata: Record<string, unknown>;
  priority: number;
  attempt: number;
  max_attempts: number;
  routes: string[];
  result: Record<string, unknown>;
  last_error: null | {
    type: string;
    message: string;
    traceback: string | null;
    occurred_at: string;
    attempt: number;
    run_id: string;
  };
  last_route: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};
type QueueSummary = {
  name: string;
  counts: Record<Status, number>;
  recent: Task | null;
};
type TaskPage = { items: Task[]; next_cursor: string | null };
type Selector = {
  status: string | null;
  name: string | null;
  filter: string | null;
};
type DeleteTarget = { task_ids: string[]; selector?: Selector };
type BatchOutcome = {
  task_id: string;
  status: "deleted" | "absent" | "failed" | "stopped";
  code: string | null;
  message: string | null;
};
type BatchOperation = {
  id: string;
  queue: string;
  total: number;
  completed: number;
  stopped: boolean;
  done: boolean;
  counts: Record<"deleted" | "absent" | "failed" | "stopped", number>;
  outcomes: BatchOutcome[];
};
type Filters = {
  route?: string;
  status: string;
  name: string;
  filter: string;
  order_by: string;
  descending: boolean;
};
function filtersFromUrl(): Filters {
  const url = new URLSearchParams(location.search);
  return {
    route: url.get("route") || "",
    status: url.get("status") || "",
    name: url.get("name") || "",
    filter: url.get("filter") || "",
    order_by: url.get("order_by") || "created_at",
    descending: url.get("descending") !== "false",
  };
}
function sameFilters(a: Filters, b: Filters) {
  return (["status", "name", "filter", "order_by", "descending"] as const).every(key => a[key] === b[key]) && (a.route || "") === (b.route || "");
}
function sameTaskRange(a: Filters, b: Filters) {
  return a.status === b.status && a.name === b.name && a.filter === b.filter &&
    (a.route || "") === (b.route || "");
}
const statuses: Status[] = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];
const taskColumns = [
  "status",
  "task",
  "attempt",
  "priority",
  "routes",
  "created",
  "updated",
  "duration",
] as const;
type TaskColumn = (typeof taskColumns)[number];
const EMPTY_TASKS: Task[] = [];
export const adaptivePolling =
  (base: number) => (query: { state: { fetchFailureCount: number } }) => {
    if (document.visibilityState === "hidden" || ("error" in query.state && isPermanentRequestError(query.state.error))) return false;
    return Math.min(
      base * 2 ** Math.min(query.state.fetchFailureCount, 4),
      60_000,
    );
  };

let toastTimeout: number | undefined;
function notify(message: string) {
  const element = document.getElementById("toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => element.classList.remove("visible"), 5000);
}
const fmt = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";
const compact = (value: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
export function TimeValue({
  value,
  short = false,
}: {
  value: string | null;
  short?: boolean;
}) {
  if (!value) return <>—</>;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const utc = new Date(value).toISOString();
  return (
    <time
      dateTime={value}
      data-tooltip={`${fmt(value)} · ${zone} · ${utc}`}
      aria-label={`${fmt(value)}; ${utc}; ${zone}`}
      tabIndex={0}
    >
      {short
        ? (() => {
            const d = new Date(value);
            const pad = (n: number) => String(n).padStart(2, "0");
            return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          })()
        : fmt(value)}
    </time>
  );
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return `${totalHours}h ${minutes}m`;
  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
}

function useExecutionClock(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ExecutionDuration({
  task,
  now = Date.now(),
}: {
  task: Pick<Task, "status" | "started_at" | "finished_at">;
  now?: number;
}) {
  if (!task.started_at || task.status === "pending") return <>—</>;
  const started = Date.parse(task.started_at);
  const approximate = task.status === "running";
  const finished = approximate
    ? now
    : task.finished_at
      ? Date.parse(task.finished_at)
      : Number.NaN;
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(finished) ||
    finished < started
  ) {
    return <>—</>;
  }
  const value = formatDuration(finished - started);
  const hint = approximate
    ? m.task.runningDurationHint
    : m.task.terminalDurationHint;
  return (
    <span
      className={`duration${approximate ? " running" : ""}`}
      data-tooltip={hint}
      aria-label={m.task.durationLabel(value, approximate)}
      tabIndex={0}
    >
      {approximate && <i aria-hidden="true" />}
      {approximate ? "~" : ""}
      {value}
    </span>
  );
}
export function StaleDataBanner({
  error,
  updatedAt,
  retry,
}: {
  error: Error | null;
  updatedAt: number;
  retry: () => void;
}) {
  if (!error) return null;
  return (
    <div className="stale" role="status">
      <div>
        <b>{updatedAt > 0 ? m.stale.title : m.stale.loadFailed}</b> {error.message}
        {updatedAt > 0 && (
          <span>
            {" "}
            {m.stale.lastSuccess(fmt(new Date(updatedAt).toISOString()))}
          </span>
        )}
      </div>
      {error instanceof ApiRequestError && (
        <button
          onClick={() =>
            void copyJson({
              code: error.code,
              status: error.status,
              message: error.message,
              details: error.details,
            })
          }
        >
          {m.stale.copyDiagnostics}
        </button>
      )}
      <button onClick={retry}>{m.common.retryNow}</button>
    </div>
  );
}
function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {m.status[status]}
    </span>
  );
}
function Spinner() {
  return <span className="spinner" aria-label={m.common.loading} />;
}
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">⌁</div>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

export function Connect({ onDone, onCancel, initialServer = "" }: { onDone: () => void; onCancel?: () => void; initialServer?: string }) {
  const [mode, setMode] = useState(initialServer.startsWith("local:") ? "local" : "http");
  const [directory, setDirectory] = useState(initialServer.startsWith("local:") ? initialServer.slice(6) : ".");
  const [serverUrl, setServerUrl] = useState(initialServer && !initialServer.startsWith("local:") ? initialServer : "http://127.0.0.1:8000");
  const [token, setToken] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api("/api/webui/connect", {
        method: "POST",
        body: JSON.stringify(mode === "local" ? {mode, directory} : { server_url: serverUrl, token: token || null }),
      }),
    onSuccess: onDone,
  });
  return (
    <main className="connect">
      <section className="connect-card">
        {onCancel && <button className="link" disabled={mutation.isPending} onClick={onCancel}>Back to workspace</button>}
        <Brand />
        <div className="connect-copy">
          <h1>{m.connect.title}</h1>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Select label="Connection type" value={mode} onChange={setMode} options={[{value: "http", label: "HTTP Server"}, {value: "local", label: "Local project"}]} />
          {mode === "local" ? <label>Project directory
            <input value={directory} onChange={e => setDirectory(e.target.value)} placeholder="/path/to/project" />
            <small>Connect to an existing instance. WebUI never starts it.</small>
          </label> : <><label>
            {m.connect.serverUrl}
            <input
              autoFocus
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://127.0.0.1:8000"
            />
          </label>
          <label>
            {m.connect.bearerToken} <span>{m.connect.optional}</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          </>}
          {mutation.error && (
            <div className="error">{mutation.error.message}</div>
          )}
          <button className="primary" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Spinner /> {m.common.connecting}
              </>
            ) : (
              m.common.connect
            )}
          </button>
        </form>
        <p className="privacy">{m.connect.privacy}</p>
      </section>
    </main>
  );
}
function ConnectionProblem({
  retry,
  message,
}: {
  retry: () => void;
  message?: string;
}) {
  return (
    <main className="connect">
      <section className="connect-card">
        <Brand />
        <div className="connect-copy">
          <h1>{m.connect.lockedTitle}</h1>
          <p>{m.connect.lockedDescription(message)}</p>
        </div>
        <button className="primary" onClick={retry}>
          {m.connect.retry}
        </button>
      </section>
    </main>
  );
}
function Brand() {
  return (
    <div className="brand">
      <img
        className="logo"
        src="/labtasker-icon.png"
        alt=""
        width={24}
        height={24}
      />
      <strong>Labtasker</strong>
    </div>
  );
}
function Shell({
  server,
  locked,
  allowDisconnect,
  onDisconnect,
  children,
}: {
  server: string;
  locked: boolean;
  allowDisconnect: boolean;
  onDisconnect: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="top">
        <Brand />
        <div className="server">
          <span className="live" />
          <span className="connection-mode">{server.startsWith("local:") ? "Local" : "HTTP"}</span>
          <span className="connection-address" data-tooltip={server.startsWith("local:") ? server.slice(6) : server}>{server.startsWith("local:") ? server.slice(6) : server.replace(/^https?:\/\//, "")}</span>{" "}
          {!locked && allowDisconnect && (
            <button className="link" onClick={onDisconnect}>
              {m.common.change}
            </button>
          )}
        </div>
      </header>
      {children}
    </>
  );
}

function Overview({
  server,
  openQueue,
}: {
  server: string;
  openQueue: (name: string, status?: string) => void;
}) {
  const query = useQuery<QueueSummary[]>({
    queryKey: ["queues"],
    queryFn: () => api("/api/webui/queues"),
    refetchInterval: adaptivePolling(15_000),
  });
  const total =
    query.data?.reduce(
      (sum, q) => sum + Object.values(q.counts).reduce((a, b) => a + b, 0),
      0,
    ) || 0;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{m.overview.title}</h1>
          {query.data && (
            <p>{m.overview.summary(query.data.length, compact(total))}</p>
          )}
        </div>
        <button className="secondary" onClick={() => query.refetch()}>
          {query.isFetching ? <Spinner /> : "↻"} {m.common.refresh}
        </button>
      </div>
      <StaleDataBanner
        error={query.error}
        updatedAt={query.dataUpdatedAt}
        retry={() => void query.refetch()}
      />
      {query.isLoading ? (
        <div className="loading">
          <Spinner /> {m.overview.loading}
        </div>
      ) : query.isError && !query.data ? null : !query.data?.length ? (
        <Empty title={m.overview.emptyTitle} body={m.overview.emptyBody} />
      ) : (
        <div className="queue-grid">
          {query.data.map((q) => {
            const n = Object.values(q.counts).reduce((a, b) => a + b, 0);
            const done = q.counts.succeeded + q.counts.failed + q.counts.cancelled;
            const completion = n ? Math.round(done / n * 100) : null;
            return (
              <article
                className="queue-card"
                key={q.name}
                onClick={() => openQueue(q.name)}
                tabIndex={0}
                onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && openQueue(q.name)}
              >
                <div className="queue-title">
                  <div>
                    <h2>{q.name}</h2>
                  </div>
                  <span className="queue-completion">{compact(n)} Tasks</span>
                </div>
                <div className="status-row">
                  {statuses.map((s) => (
                    <button
                      key={s}
                      className={s}
                      onClick={(e) => {
                        e.stopPropagation();
                        openQueue(q.name, s);
                      }}
                    >
                      <b>{q.counts[s]}</b>
                      <span>{m.status[s]}</span>
                    </button>
                  ))}
                </div>
                <div className="queue-distribution" role="img" aria-label={statuses.map(s => `${m.status[s]}: ${q.counts[s]}`).join(", ")}>
                  {statuses.filter(s => q.counts[s] > 0).map(s => (
                    <span key={s} className={s} style={{width: `${q.counts[s] / n * 100}%`}} data-tooltip={`${m.status[s]}: ${q.counts[s]}`} />
                  ))}
                </div>
                <div className="queue-progress-label"><span>{compact(done)} / {compact(n)} Tasks completed</span><strong>{completion === null ? "—" : `${completion}%`}</strong></div>
                <QueueWorkerSummary queue={q.name} server={server} />
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Workspace({
  queue,
  initialStatus,
  historyNavigation,
  server,
  back,
}: {
  queue: string;
  initialStatus: string;
  historyNavigation: boolean;
  server: string;
  back: () => void;
}) {
  const qc = useQueryClient();
  const scope = `${server}/${queue}`;
  const [preferences, setPreferences] = useState(() => workspacePreferences(scope));
  const [resizingRoutes, setResizingRoutes] = useState(false);
  const routeDrag = useRef<{x: number; width: number} | null>(null);
  const resizeRoutes = (width: number) => setPreferences(current => ({...current,
    width: Math.round(Math.max(160, Math.min(480, window.innerWidth * .4, width)))}));
  useEffect(() => {saveWorkspacePreferences(scope, preferences);}, [scope, preferences]);
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get("tab") === "workers" ? "workers" : "tasks");
  const [workerStatus, setWorkerStatus] = useState(() => new URLSearchParams(location.search).get("worker_status") || "");
  const routeCounts = useRouteCounts(queue, server, preferences.inactive);
  const navigatePanel = (nextTab: string, nextStatus = workerStatus) => {
    const url = new URL(location.href);
    if (nextTab === "workers") url.searchParams.set("tab", "workers"); else url.searchParams.delete("tab");
    if (nextStatus) url.searchParams.set("worker_status", nextStatus); else url.searchParams.delete("worker_status");
    url.searchParams.delete("task");
    if (url.href === location.href) return;
    history.pushState({}, "", url);
    setTab(nextTab); setWorkerStatus(nextStatus); setTaskId(null);
  };
  const [initialLayout] = useState(() => readQueueLayout(scope));
  const [filters, setFilters] = useState<Filters>(() => {
    const url = new URLSearchParams(location.search);
    if (!historyNavigation && !initialStatus && !["route", "status", "name", "filter", "order_by", "descending"].some((key) => url.has(key))) {
      try {
        const saved = JSON.parse(localStorage.getItem("labtasker:filters:v1") || "{}")[`${server}/${queue}`];
        if (saved && ["status", "name", "filter", "order_by"].every((key) => typeof saved[key] === "string") && typeof saved.descending === "boolean") return saved;
      } catch {}
    }
    return {
      route: url.get("route") || "",
      status: url.get("status") || initialStatus,
      name: url.get("name") || "",
      filter: url.get("filter") || "",
      order_by: url.get("order_by") || "created_at",
      descending: url.get("descending") !== "false",
    };
  });
  const columnMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const menu = columnMenuRef.current;
    const trigger = menu?.querySelector("summary");
    const panel = menu?.querySelector<HTMLDivElement>(":scope > div");
    if (!menu || !trigger || !panel) return;
    const position = () => {
      if (!menu.open) return;
      const margin = 12;
      const gap = 6;
      const anchor = trigger.getBoundingClientRect();
      const width = Math.min(370, window.innerWidth - margin * 2);
      const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin);
      const above = Math.max(0, anchor.top - gap - margin);
      const upwards = below < Math.min(panel.scrollHeight, 520) && above > below;
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin))}px`;
      panel.style.maxHeight = `${Math.min(520, upwards ? above : below)}px`;
      panel.style.top = `${upwards ? Math.max(margin, anchor.top - gap - panel.getBoundingClientRect().height) : Math.max(margin, anchor.bottom + gap)}px`;
    };
    menu.addEventListener("toggle", position);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    return () => {
      menu.removeEventListener("toggle", position);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const dismissOutside = (event: Event) => {
      const menu = columnMenuRef.current;
      if (
        menu?.open &&
        event.target instanceof Node &&
        !menu.contains(event.target)
      ) {
        menu.open = false;
      }
    };
    const dismissEscape = (event: KeyboardEvent) => {
      const menu = columnMenuRef.current;
      if (event.key === "Escape" && menu?.open) {
        event.preventDefault();
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, []);
  useEffect(() => {
    let stored: Record<string, Filters> = {};
    try { stored = JSON.parse(localStorage.getItem("labtasker:filters:v1") || "{}"); } catch {}
    saveSetting("labtasker:filters:v1", JSON.stringify({...stored, [`${server}/${queue}`]: filters}));
  }, [filters, server, queue]);
  const [draft, setDraft] = useState(filters);
  const taskListRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>(
    () => {
      try {
        const stored = initialLayout.widths || {};
        return Object.fromEntries(
          Object.entries(stored).filter(
            ([key, value]) =>
              (taskColumns.includes(key as TaskColumn) || (key.startsWith("path:") && !!pathParts(key.slice(5)))) &&
              typeof value === "number" &&
              value >= 60 &&
              value <= 10000,
          ),
        ) as Record<string, number>;
      } catch {
        return {};
      }
    },
  );
  useEffect(() => {
    const el = taskListRef.current;
    if (!el) return;
    const update = () =>
      setViewport({ top: el.scrollTop, height: el.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    try {
      const stored = initialLayout.visible;
      if (Array.isArray(stored))
        return new Set(stored.filter((item) => typeof item === "string"));
    } catch {}
    return new Set(taskColumns);
  });
  const [customPaths, setCustomPaths] = useState(() => (Array.isArray(initialLayout.custom) ? initialLayout.custom : []).filter((path) => typeof path === "string" && pathParts(path)));
  const [savedOrder, setSavedOrder] = useState(() => (Array.isArray(initialLayout.order) ? initialLayout.order : []).filter(id => typeof id === "string"));
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("");
  const [pathError, setPathError] = useState("");
  const columnIds = [...taskColumns, ...customPaths.map((path) => `path:${path}`)];
  const orderedColumns = [...savedOrder.filter((id) => columnIds.includes(id as TaskColumn)), ...columnIds.filter((id) => !savedOrder.includes(id))];
  const columnLabel = (id: string) => id.startsWith("path:") ? id.slice(5) : m.columns[id as TaskColumn];
  const moveColumn = (id: string, offset: number) => {
    const next = [...orderedColumns];
    const index = next.indexOf(id);
    if (index + offset < 0 || index + offset >= next.length) return;
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setSavedOrder(next);
  };
  useEffect(() => {
    saveQueueLayout(scope, {visible: [...visibleColumns], custom: customPaths, order: savedOrder, widths: columnSizing});
  }, [scope, visibleColumns, customPaths, savedOrder, columnSizing]);
  const originTaskId = useRef<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("task"),
  );
  const [confirm, setConfirm] = useState<DeleteTarget | null>(null);
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== "" && v !== undefined && k !== "descending" && k !== "route") params.set(k === "name" ? "name_fuzzy" : k, String(v));
  });
  const effectiveFilter = effectiveTaskFilter(filters);
  if (effectiveFilter) params.set("filter", effectiveFilter);
  params.set("descending", String(filters.descending));
  const tasks = useInfiniteQuery({
    queryKey: ["tasks", queue, filters],
    enabled: tab === "tasks",
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const pageParams = new URLSearchParams(params);
      if (pageParam) pageParams.set("cursor", pageParam);
      return api<TaskPage>(
        `/api/webui/queues/${encodeURIComponent(queue)}/tasks?${pageParams}`,
      );
    },
    getNextPageParam: (page, _pages, _lastParam, pageParams) =>
      page.next_cursor && !pageParams.includes(page.next_cursor)
        ? page.next_cursor
        : undefined,
    refetchInterval:
      tab !== "tasks" || viewport.top > 0 || taskId ? false : adaptivePolling(5_000),
    refetchOnWindowFocus: viewport.top === 0 && !taskId,
  });
  useEffect(() => {
    const root = taskListRef.current;
    const sentinel = loadMoreRef.current;
    if (
      !root ||
      !sentinel ||
      !tasks.hasNextPage ||
      tasks.isFetching ||
      tasks.isFetchNextPageError
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting)
          void tasks.fetchNextPage({ cancelRefetch: false });
      },
      { root, rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    tasks.hasNextPage,
    tasks.isFetching,
    tasks.isFetchNextPageError,
    tasks.fetchNextPage,
  ]);
  useEffect(() => {
    taskListRef.current?.scrollTo({ top: 0 });
  }, [queue, filters]);
  useEffect(() => {
    if (tasks.error instanceof ApiRequestError && tasks.error.status === 404) {
      notify(m.workspace.queueRemoved);
      back();
    }
  }, [tasks.error, back]);
  const queueCounts = useQuery<Record<Status, number>>({
    queryKey: ["queue-counts", queue, filters.name, filters.filter, filters.route],
    enabled: tab === "tasks",
    queryFn: async () => {
      const values = await Promise.all(
        statuses.map((status) => {
          const params = statusCountParams(filters, status);
          return api<{ count: number }>(
            `/api/webui/queues/${encodeURIComponent(queue)}/tasks/count?${params}`,
          );
        }),
      );
      return Object.fromEntries(
        statuses.map((status, index) => [status, values[index].count]),
      ) as Record<Status, number>;
    },
    refetchInterval: adaptivePolling(5_000),
  });
  const countParams = new URLSearchParams();
  if (filters.status) countParams.set("status", filters.status);
  if (filters.name) countParams.set("name_fuzzy", filters.name);
  if (effectiveFilter) countParams.set("filter", effectiveFilter);
  const matchingCount = useQuery<{ count: number }>({
    enabled: tab === "tasks",
    queryKey: [
      "matching-count",
      queue,
      filters.route,
      filters.status,
      filters.name,
      filters.filter,
    ],
    queryFn: () =>
      api(
        `/api/webui/queues/${encodeURIComponent(queue)}/tasks/count?${countParams}`,
      ),
    refetchInterval: adaptivePolling(5_000),
  });
  useEffect(() => {
    saveSetting("labtasker:lastQueue", queue);
  }, [queue]);
  const urlInitialized = useRef(false);
  useEffect(() => {
    const first = !urlInitialized.current;
    urlInitialized.current = true;
    if (!first && sameFilters(filters, filtersFromUrl())) return;
    const url = new URL(location.href);
    url.searchParams.set("queue", queue);
    for (const key of [
      "status",
      "name",
      "filter",
      "order_by",
      "descending",
      "cursor",
      "route",
    ]) {
      url.searchParams.delete(key);
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== "" && value !== undefined && !(key === "order_by" && value === "created_at")) {
        url.searchParams.set(key, String(value));
      }
    });
    if (first) history.replaceState(history.state, "", url);
    else history.pushState(history.state, "", url);
  }, [queue, filters]);
  useEffect(() => {
    const onBack = () => {
      const url = new URLSearchParams(location.search);
      if (url.get("queue") !== queue) return;
      setTab(url.get("tab") === "workers" ? "workers" : "tasks");
      setWorkerStatus(url.get("worker_status") || "");
      const restored = filtersFromUrl();
      if (!sameFilters(filters, restored)) {
        setFilters(restored);
        setDraft(restored);
        if (!sameTaskRange(filters, restored)) {
          setSelected(new Set());
        }
      }
      setTaskId(url.get("task"));
    };
    addEventListener("popstate", onBack);
    return () => removeEventListener("popstate", onBack);
  }, [queue, filters]);
  useEffect(() => {
    if (!taskId && originTaskId.current) {
      const selector = tab === "workers"
        ? `.worker-table [data-task-link="${CSS.escape(originTaskId.current)}"]`
        : `[data-task-id="${CSS.escape(originTaskId.current)}"]`;
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(selector)?.focus(),
      );
    }
  }, [taskId, tab]);
  const apply = () => {
    if (sameFilters(filters, draft)) return;
    setFilters(draft);
    if (!sameTaskRange(filters, draft)) setSelected(new Set());
  };
  const applyFields = (values: Partial<Filters>) => {
    setDraft(current => ({ ...current, ...values }));
    setFilters(current => {
      const next = { ...current, ...values };
      return sameFilters(current, next) ? current : next;
    });
    if (!sameTaskRange(filters, {...filters, ...values})) setSelected(new Set());
  };
  const all = useMemo(() => {
    if (!tasks.data) return EMPTY_TASKS;
    const seen = new Set<string>();
    return tasks.data.pages
      .flatMap((page) => page.items)
      .filter((task) => {
        if (seen.has(task.id)) return false;
        seen.add(task.id);
        return true;
      });
  }, [tasks.data]);
  const allChecked = all.length > 0 && all.every((t) => selected.has(t.id));
  const partiallyChecked = !allChecked && all.some(task => selected.has(task.id));
  const toggle = (id: string) =>
    setSelected((old) => {
      const n = new Set(old);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleColumn = (column: string) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      next.has(column) ? next.delete(column) : next.add(column);
      if (next.size === 0) next.add("task");
      return next;
    });
  };
  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: "select",
        size: 40,
        minSize: 40,
        enableResizing: false,
        header: () => (
          <input
            aria-label={m.workspace.selectPage}
            type="checkbox"
            checked={allChecked}
            aria-checked={partiallyChecked ? "mixed" : allChecked}
            ref={element => { if (element) element.indeterminate = partiallyChecked; }}
            onChange={() =>
              setSelected((old) => {
                const next = new Set(old);
                all.forEach((task) =>
                  allChecked ? next.delete(task.id) : next.add(task.id),
                );
                return next;
              })
            }
          />
        ),
        cell: ({ row }) => (
          <input
            aria-label={m.workspace.selectTask(row.original.id)}
            type="checkbox"
            checked={selected.has(row.original.id)}
            onClick={(event) => event.stopPropagation()}
            onChange={() => toggle(row.original.id)}
          />
        ),
      },
      {
        id: "status",
        header: m.columns.status,
        cell: ({ row }) => <Badge status={row.original.status} />,
      },
      {
        id: "task",
        size: 400,
        header: m.columns.task,
        cell: ({ row }) => (
          <>
            <b
              className="task-name"
              data-tooltip={row.original.name || m.workspace.unnamedTask}
            >
              {row.original.name || m.workspace.unnamedTask}
            </b>
            <code data-tooltip={row.original.id}>{row.original.id}</code>
          </>
        ),
      },
      {
        id: "attempt",
        header: m.columns.attempt,
        cell: ({ row }) =>
          `${row.original.attempt} / ${row.original.max_attempts}`,
      },
      {
        id: "priority",
        header: m.columns.priority,
        accessorKey: "priority",
        cell: ({ row }) => <PriorityValue value={row.original.priority} />,
      },
      {
        id: "routes",
        size: 180,
        header: m.columns.routes,
        cell: ({ row }) => (
<RouteChips routes={row.original.routes} />
        ),
      },
      {
        id: "created",
        header: m.columns.created,
        cell: ({ row }) => <TimeValue value={row.original.created_at} short />,
      },
      {
        id: "updated",
        header: m.columns.updated,
        cell: ({ row }) => <TimeValue value={row.original.updated_at} short />,
      },
      {
        id: "duration",
        header: m.columns.duration,
        cell: ({ row }) => (
          <LiveExecutionDuration task={row.original} />
        ),
      },
      ...customPaths.map((path): ColumnDef<Task> => ({
        id: `path:${path}`, header: path, size: 180,
        cell: ({ row }) => {
          const value = pathValue(row.original, path);
          return <span data-tooltip={value || undefined}>{value}</span>;
        },
      })),
    ],
    [all, allChecked, partiallyChecked, selected, customPaths],
  );
  const table = useReactTable({
    data: all,
    columns,
    columnResizeMode: "onChange",
    onColumnSizingChange: setColumnSizing,
    defaultColumn: { minSize: 60, maxSize: 10000, size: 120 },
    getRowId: (task) => task.id,
    state: {
      columnSizing,
      columnOrder: ["select", ...orderedColumns],
      columnVisibility: Object.fromEntries(
        columnIds.map((column) => [column, visibleColumns.has(column)]),
      ),
    },
    getCoreRowModel: getCoreRowModel(),
  });
  const fitColumn = (id: string) => {
    const column = table.getColumn(id);
    const header = taskListRef.current?.querySelector<HTMLElement>(`th[data-column-id="${id}"]`);
    if (!column?.getCanResize() || !header) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    const sample = taskListRef.current?.querySelector<HTMLElement>(`td[data-column-id="${id}"]`);
    const measure = (text: string, element: Element = sample || header) => {
      const style = getComputedStyle(element);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return context.measureText(text).width;
    };
    let width = measure(String(column.columnDef.header), header) + 36;
    for (const task of all) {
      let content = 0;
      if (id.startsWith("path:")) content = measure(pathValue(task, id.slice(5)));
      else if (id === "task") {
        content = Math.max(
          measure(task.name || m.workspace.unnamedTask, sample?.querySelector("b") || header),
          measure(task.id, sample?.querySelector("code") || header),
        );
      } else if (id === "routes") {
        content = task.routes.reduce((sum, route) => sum + measure(route) + 18, 0);
      } else if (id === "status") content = measure(m.status[task.status]) + 26;
      else if (id === "priority") content = measure(`${task.priority}${task.priority ? " ↑" : ""}`);
      else if (id === "attempt") content = measure(`${task.attempt} / ${task.max_attempts}`);
      else if (id === "created" || id === "updated") content = measure("00-00 00:00");
      else if (id === "duration") {
        const start = task.started_at && Date.parse(task.started_at);
        const end = task.finished_at ? Date.parse(task.finished_at) : Date.now();
        content = measure(start ? `${task.status === "running" ? "~" : ""}${formatDuration(Math.max(0, end - start))}` : "—");
      }
      width = Math.max(width, content + 24);
    }
    const fitted = Math.min(10000, Math.max(60, Math.ceil(width)));
    setColumnSizing((current) => ({ ...current, [id]: fitted }));
    notify(`${columnLabel(id)} fitted to content · ${fitted}px`);
  };
  const rows = table.getRowModel().rows;
  const rowHeight = 42;
  const virtualStart = Math.max(
    0,
    Math.floor(Math.max(0, viewport.top - 34) / rowHeight) - 8,
  );
  const virtualEnd = Math.min(
    rows.length,
    Math.ceil((viewport.top + viewport.height) / rowHeight) + 8,
  );
  const refreshList = () => {
    taskListRef.current?.scrollTo({ top: 0 });
    void tasks.refetch();
    void queueCounts.refetch();
    void matchingCount.refetch();
  };
  const openTask = (id: string) => {
    originTaskId.current = id;
    const url = new URL(location.href);
    url.searchParams.set("task", id);
    if (taskId) {
      history.replaceState(history.state, "", url);
    } else {
      history.pushState({ labtaskerDrawer: true }, "", url);
    }
    setTaskId(id);
  };
  const closeTask = (replaceHistory = false) => {
    if (replaceHistory) originTaskId.current = null;
    if (!replaceHistory && history.state?.labtaskerDrawer) {
      history.back();
    } else {
      const url = new URL(location.href);
      url.searchParams.delete("task");
      history.replaceState({}, "", url);
      setTaskId(null);
    }
  };
  return (
    <main className="workspace">
      <div className="queue-navigation">
      <div className="queue-location">
      <button className="routes-toggle" aria-label={preferences.collapsed ? "Show Routes" : "Collapse Routes"}
        aria-expanded={!preferences.collapsed} aria-controls="queue-routes" data-tooltip={preferences.collapsed ? "Show Routes" : "Collapse Routes"}
        onClick={() => setPreferences(current => ({...current, collapsed: !current.collapsed}))}>
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" fill="none" stroke="currentColor"/><path d="M7 3v14" fill="none" stroke="currentColor"/>{!preferences.collapsed && <path d="M3 4h3v12H3z" fill="currentColor" opacity=".2"/>}</svg>
        Routes
      </button>
      <nav className="crumb" aria-label="Breadcrumb">
        <button onClick={back}>{m.workspace.allQueues}</button>
        <span aria-hidden="true">/</span>
        <b aria-current="page">{queue}</b>
      </nav>
      </div>
      <div className="queue-navigation-actions">
        <Views key={`${server}/${queue}`} scope={`${server}/${queue}`}
          current={{filters, visible: [...visibleColumns], custom: customPaths, order: savedOrder, widths: columnSizing}}
          apply={view => {
            setFilters({...view.filters, route: view.filters.route || ""}); setDraft({...view.filters, route: view.filters.route || ""}); setVisibleColumns(new Set(view.visible));
            setCustomPaths(view.custom.filter(path => pathParts(path))); setSavedOrder(view.order); setColumnSizing(view.widths);
            if (!sameTaskRange(filters, view.filters)) setSelected(new Set());
            setTaskId(null);
          }} />
        <button className="secondary" onClick={() => {refreshList(); void routeCounts.tasks.refetch(); void routeCounts.workers.refetch(); void qc.invalidateQueries({queryKey: ["workers", server, queue]});}}>
          {tasks.isFetching && <Spinner />} {m.common.refresh}
        </button>
      </div>
      </div>
      <ObservationNotices key={`${server}/${queue}`} server={server} queue={queue} />
      <RouteCountsContext.Provider value={routeCounts}><div className={`queue-workspace${preferences.collapsed ? " routes-collapsed" : ""}${resizingRoutes ? " resizing-routes" : ""}`} style={{"--route-preferred-width": `${preferences.width}px`} as CSSProperties}>
        <div id="queue-routes" className="route-rail" aria-hidden={preferences.collapsed} inert={preferences.collapsed}><RouteSidebar counts={routeCounts} route={filters.route || ""}
          choose={route => {applyFields({route}); setTaskId(null);}}
          inactive={preferences.inactive} setInactive={inactive => setPreferences(current => ({...current, inactive}))} />
          <div className="route-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical"
            aria-valuemin={160} aria-valuemax={480} aria-valuenow={preferences.width} tabIndex={preferences.collapsed ? -1 : 0}
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault();
              routeDrag.current = {x: event.clientX, width: event.currentTarget.parentElement!.getBoundingClientRect().width};
              event.currentTarget.setPointerCapture(event.pointerId); setResizingRoutes(true);
            }}
            onPointerMove={event => {if (routeDrag.current) resizeRoutes(routeDrag.current.width + event.clientX - routeDrag.current.x);}}
            onPointerUp={event => {routeDrag.current = null; setResizingRoutes(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}
            onPointerCancel={() => {routeDrag.current = null; setResizingRoutes(false);}}
            onLostPointerCapture={() => {routeDrag.current = null; setResizingRoutes(false);}}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault(); resizeRoutes(event.key === "Home" ? 160 : event.key === "End" ? 480 : preferences.width + (event.key === "ArrowRight" ? 10 : -10));
            }} />
        </div>
        <div className="workspace-content">
          <div className="workspace-tabs">
            <button aria-pressed={tab === "tasks"} onClick={() => navigatePanel("tasks")}>Tasks</button>
            <button aria-pressed={tab === "workers"} onClick={() => navigatePanel("workers")}>Workers</button>
            {filters.route && <span className="active-route" data-tooltip={filters.route}>{filters.route}</span>}
          </div>
          {tab === "workers" && <WorkersPanel queue={queue} server={server} route={filters.route || ""} counts={routeCounts}
            status={workerStatus} setStatus={value => navigatePanel("workers", value)} openTask={openTask} />}
          <div className="task-workspace" hidden={tab !== "tasks"}>
      <div className="stats" aria-label="Task status counts">
        <button className={`all${!filters.status ? " active" : ""}`} aria-pressed={!filters.status}
          data-tooltip="Show Tasks in all statuses" onClick={() => applyFields({status: ""})}>
          <strong>{queueCounts.data && !queueCounts.isError ? statuses.reduce((sum, status) => sum + queueCounts.data[status], 0) : "—"}</strong><span>All</span>
        </button>
        {statuses.map((s) => (
          <button
            className={`${s}${filters.status === s ? " active" : ""}`}
            aria-pressed={filters.status === s}
            data-tooltip={`Filter ${m.status[s]} Tasks`}
            key={s}
            onClick={() => {
              const f = { ...filters, status: filters.status === s ? "" : s };
              setFilters(f);
              setDraft(current => ({ ...current, status: f.status }));
              setSelected(new Set());
            }}
          >
            <strong>{queueCounts.isError ? "—" : queueCounts.data?.[s] ?? "—"}</strong>
            <span>{m.status[s]}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <Select label={m.workspace.allStatuses} value={draft.status}
          onChange={(status) => applyFields({ status })}
          options={[{value: "", label: m.workspace.allStatuses}, ...statuses.map((s) => ({value: s, label: m.status[s]}))]} />
        <input
          className="task-name-filter"
          aria-label={m.workspace.taskName}
          onBlur={event => applyFields({ name: event.currentTarget.value })}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault(); apply();
            }
          }}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          title='Case-insensitive subsequence search; every word must match. For an exact name, use name == "..." in Advanced filter.'
          placeholder="Task name · fuzzy search"
        />
        <FilterInput label={m.workspace.advancedFilter} value={draft.filter} onApply={apply} onCommit={filter => applyFields({ filter })}
          onChange={(filter) => setDraft({ ...draft, filter })} />
        <Select label={m.workspace.sortField} value={draft.order_by}
          onChange={(order_by) => applyFields({ order_by })}
          options={[
            {value: "created_at", label: m.columns.created}, {value: "updated_at", label: m.columns.updated},
            {value: "name", label: m.columns.name}, {value: "status", label: m.columns.status},
            {value: "priority", label: m.columns.priority}, {value: "attempt", label: m.columns.attempt},
          ]} />
        <Select label={m.workspace.sortDirection} value={draft.descending ? "desc" : "asc"}
          onChange={(direction) => applyFields({ descending: direction === "desc" })}
          options={[{value: "desc", label: m.workspace.descending}, {value: "asc", label: m.workspace.ascending}]} />
        <details className="column-menu" ref={columnMenuRef}>
          <summary>{m.common.columns}</summary>
          <div>
            <div className="column-list">
            {orderedColumns.map((column) => (
              <div className={`column-choice${dropColumn === column ? " drop-target" : ""}`} key={column}
                data-column-order-id={column}
                onDragOver={(event) => { if (dragColumn) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropColumn(column); } }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragColumn && dragColumn !== column) {
                    const next = [...orderedColumns];
                    const from = next.indexOf(dragColumn), to = next.indexOf(column);
                    next.splice(from, 1); next.splice(to, 0, dragColumn); setSavedOrder(next);
                  }
                  setDragColumn(null); setDropColumn(null);
                }}>
                <button type="button" className="column-drag-handle" draggable
                  aria-label={`Reorder ${columnLabel(column)}`} data-tooltip="Drag to reorder · Arrow keys to move"
                  onDragStart={(event) => { setDragColumn(column); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", column); }}
                  onDragEnd={() => { setDragColumn(null); setDropColumn(null); }}
                  onKeyDown={(event) => { if (["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); moveColumn(column, event.key === "ArrowUp" ? -1 : 1); } }}
                >⠿</button>
                <label><input type="checkbox" checked={visibleColumns.has(column)} onChange={() => toggleColumn(column)} />
                  <span data-tooltip={columnLabel(column)}>{columnLabel(column)}</span>
                </label>
                {column.startsWith("path:") && <button type="button" aria-label={`Remove ${columnLabel(column)}`} onClick={() => {
                  setCustomPaths((paths) => paths.filter((path) => `path:${path}` !== column));
                  setSavedOrder((order) => order.filter((id) => id !== column));
                }}>×</button>}
              </div>
            ))}
            </div>
            <form className="custom-column-form" onSubmit={(event) => {
              event.preventDefault();
              const path = newPath.trim();
              if (!pathParts(path)) { setPathError("Use a field path, e.g. args.foo.bar or result.items[0].score."); return; }
              if (customPaths.includes(path)) { setPathError("This column already exists."); return; }
              setCustomPaths((paths) => [...paths, path]);
              setVisibleColumns((current) => {
                const next = new Set([...current, `path:${path}`]);
                          return next;
              });
              setNewPath(""); setPathError("");
            }}>
              <label htmlFor="custom-column-path">Custom column · JSON path</label>
              <div><input id="custom-column-path" value={newPath} placeholder="args.foo.bar" onChange={(event) => setNewPath(event.target.value)} /><button type="submit">Add</button></div>
              <small>Missing values stay blank. Drag the handle to reorder columns.</small>
              {pathError && <small role="alert">{pathError}</small>}
            </form>
          </div>
        </details>
        <button className="secondary compact" onClick={apply}>
          {m.common.apply}
        </button>
      </div>
      {tasks.error instanceof ApiRequestError && tasks.error.status === 422 && (
        <div className="field-error" role="alert">
          {tasks.error.message}
        </div>
      )}
      {selected.size > 0 && (
        <div className="selection">
          {m.workspace.selected(selected.size)}{" "}
          <button
            className="danger-link"
            onClick={() => setConfirm({ task_ids: [...selected] })}
          >
            {m.workspace.deleteSelected}
          </button>
          <button className="link" onClick={() => setSelected(new Set())}>
            {m.common.clear}
          </button>
        </div>
      )}
      <StaleDataBanner
        error={
          tasks.error instanceof ApiRequestError && tasks.error.status === 422
            ? null
            : tasks.isFetchNextPageError
              ? null
              : tasks.error
        }
        updatedAt={tasks.dataUpdatedAt}
        retry={() => void tasks.refetch()}
      />
      <div
        className="table-wrap"
        ref={taskListRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          if (viewport.top === 0 && el.scrollTop > 0)
            void qc.cancelQueries({
              queryKey: ["tasks", queue, filters],
              exact: true,
            });
          setViewport({ top: el.scrollTop, height: el.clientHeight });
        }}
      >
        <table
          className="virtual-table"
          style={{ width: table.getTotalSize(), minWidth: "100%" }}
          aria-rowcount={all.length + 1}
        >
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
            <col className="table-filler" />
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    data-column-id={header.column.id}
                    onDoubleClick={() => fitColumn(header.column.id)}
                    data-tooltip={
                      typeof header.column.columnDef.header === "string"
                        ? `${header.column.columnDef.header} · Double-click to fit content`
                        : undefined
                    }
                    aria-label={
                      typeof header.column.columnDef.header === "string"
                        ? header.column.columnDef.header
                        : undefined
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                    {header.column.getCanResize() && (
                      <span
                        className="column-resizer"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${header.column.columnDef.header}`}
                        aria-valuenow={header.column.getSize()}
                        aria-valuemin={60}
                        aria-valuemax={10000}
                        tabIndex={0}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={(event) => { event.stopPropagation(); fitColumn(header.column.id); }}
                        onKeyDown={(event) => {
                          if (
                            event.key === "ArrowLeft" ||
                            event.key === "ArrowRight"
                          ) {
                            event.preventDefault();
                            const size = Math.min(
                              10000,
                              Math.max(
                                60,
                                header.column.getSize() +
                                  (event.key === "ArrowRight" ? 16 : -16),
                              ),
                            );
                            setColumnSizing((current) => ({
                              ...current,
                              [header.column.id]: size,
                            }));
                          }
                        }}
                      />
                    )}
                  </th>
                ))}
                <th className="table-filler" aria-hidden="true" />
              </tr>
            ))}
          </thead>
          <tbody>
            {virtualStart > 0 && (
              <tr aria-hidden="true" className="virtual-spacer">
                <td
                  colSpan={table.getVisibleLeafColumns().length + 1}
                  style={{ height: virtualStart * rowHeight }}
                />
              </tr>
            )}
            {rows.slice(virtualStart, virtualEnd).map((row, index) => (
              <tr
                key={row.id}
                data-task-id={row.original.id}
                aria-rowindex={virtualStart + index + 2}
                tabIndex={0}
                className={taskId === row.original.id ? "chosen" : ""}
                onClick={() => openTask(row.original.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openTask(row.original.id);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    data-column-id={cell.column.id}
                    data-tooltip={
                      cell.column.id === "select"
                        ? undefined
                        : cell.column.id === "task"
                          ? `${row.original.name || m.workspace.unnamedTask}\n${row.original.id}`
                          : cell.column.id === "routes"
                            ? row.original.routes.join("\n")
                            : cell.column.id === "attempt"
                              ? `${row.original.attempt} / ${row.original.max_attempts}`
                              : cell.column.id === "priority"
                                ? String(row.original.priority)
                                : cell.column.id === "status"
                                  ? row.original.status
                                  : undefined
                    }
                    onClick={
                      cell.column.id === "select"
                        ? (event) => event.stopPropagation()
                        : undefined
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                <td className="table-filler" aria-hidden="true" />
              </tr>
            ))}
            {virtualEnd < rows.length && (
              <tr aria-hidden="true" className="virtual-spacer">
                <td
                  colSpan={table.getVisibleLeafColumns().length + 1}
                  style={{ height: (rows.length - virtualEnd) * rowHeight }}
                />
              </tr>
            )}
          </tbody>
        </table>
        {tasks.isLoading && (
          <div className="loading">
            <Spinner /> {m.workspace.loadingTasks}
          </div>
        )}
        {!tasks.isLoading && !all.length && !tasks.error && (
          <Empty title={m.workspace.emptyTitle} body={m.workspace.emptyBody} />
        )}
        <div ref={loadMoreRef} className="load-more" role="status">
          {tasks.isFetchingNextPage && (
            <>
              <Spinner /> {m.workspace.loadingMore}
            </>
          )}
          {tasks.isFetchNextPageError && (
            <>
              <span>{m.workspace.loadMoreFailed}</span>
              <button
                className="link"
                onClick={() => void tasks.fetchNextPage()}
              >
                {m.common.retryNow}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="list-summary" role="status">
        {m.workspace.loadedSummary(
          all.length,
          matchingCount.data?.count ?? "—",
        )}
      </div>
          </div>
        </div>
      </div>
      </RouteCountsContext.Provider>
      {taskId && (
        <TaskDrawer
          queue={queue}
          taskId={taskId}
          close={closeTask}
          changed={() => {
            tasks.refetch();
            qc.invalidateQueries({ queryKey: ["queues"] });
            qc.invalidateQueries({ queryKey: ["queue-counts", queue] });
            qc.invalidateQueries({ queryKey: ["matching-count", queue] });
          }}
          requestDelete={(id) => setConfirm({ task_ids: [id] })}
        />
      )}{" "}
      {confirm && (
        <DeleteDialog
          queue={queue}
          server={server}
          target={confirm}
          close={() => setConfirm(null)}
          done={() => {
            setConfirm(null);
            setSelected(new Set());
            tasks.refetch();
            qc.invalidateQueries({ queryKey: ["queues"] });
            qc.invalidateQueries({ queryKey: ["queue-counts", queue] });
            qc.invalidateQueries({ queryKey: ["matching-count", queue] });
          }}
        />
      )}
    </main>
  );
}

function copyJson(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return navigator.clipboard.writeText(text);
}

export function JsonNode({
  label,
  value,
  depth = 0,
}: {
  label?: string;
  value: unknown;
  depth?: number;
}) {
  const prefix =
    label === undefined ? null : <span className="json-key">{label}</span>;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const kind = Array.isArray(value) ? m.json.array : m.json.object;
    return (
      <details className="json-node" open={depth < 2}>
        <summary>
          {prefix}{" "}
          <span className="json-kind">
            {kind} · {entries.length}
          </span>
        </summary>
        <button
          className="json-copy"
          aria-label={m.json.copyValue(label)}
          onClick={() => void copyJson(value)}
        >
          {m.common.copy}
        </button>
        <div className="json-children">
          {entries.length ? (
            entries.map(([key, child]) => (
              <JsonNode key={key} label={key} value={child} depth={depth + 1} />
            ))
          ) : (
            <span className="json-empty">{m.common.empty}</span>
          )}
        </div>
      </details>
    );
  }
  let rendered: ReactNode;
  if (typeof value === "string" && /^https?:\/\/[^\s]+$/i.test(value)) {
    rendered = (
      <a href={value} target="_blank" rel="noopener noreferrer">
        {value}
      </a>
    );
  } else if (typeof value === "string") {
    rendered = <span className="json-string">{JSON.stringify(value)}</span>;
  } else if (value === null) {
    rendered = <span className="json-null">null</span>;
  } else {
    rendered = <span className="json-scalar">{String(value)}</span>;
  }
  return (
    <div className="json-leaf">
      {prefix} {rendered}
      <button
        aria-label={m.json.copyValue(label)}
        onClick={() => void copyJson(value)}
      >
        {m.common.copy}
      </button>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const [raw, setRaw] = useState(false);
  return (
    <section className="detail-section">
      <div className="section-title">
        <h3>{title}</h3>
        <button className="link" onClick={() => setRaw(!raw)}>
          {raw ? m.json.tree : m.json.raw}
        </button>
        <button className="link" onClick={() => void copyJson(value)}>
          {m.common.copy}
        </button>
      </div>
      {raw ? (
        <pre>{JSON.stringify(value, null, 2)}</pre>
      ) : (
        <div className="json-tree">
          <JsonNode value={value} />
        </div>
      )}
    </section>
  );
}
export function TaskDrawer({
  queue,
  taskId,
  close,
  changed,
  requestDelete,
}: {
  queue: string;
  taskId: string;
  close: (replaceHistory?: boolean) => void;
  changed: () => void;
  requestDelete: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem("labtasker:drawerWidth"));
    return Number.isFinite(stored) && stored >= 480 && stored <= 800
      ? stored
      : 600;
  });
  const query = useQuery<Task>({
    queryKey: ["task", queue, taskId],
    queryFn: () =>
      api(
        `/api/webui/queues/${encodeURIComponent(queue)}/tasks/${encodeURIComponent(taskId)}`,
      ),
    refetchInterval: adaptivePolling(5_000),
  });
  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 404) {
      notify(m.task.removed);
      close();
    }
  }, [query.error, close]);
  const actionKey = ["task-action", queue, taskId];
  const actionPending = useIsMutating({mutationKey: actionKey}) > 0;
  const mutation = useMutation({
    mutationKey: actionKey,
    mutationFn: ({id, action}: {id: string; action: string}) =>
      api(
        `/api/webui/queues/${encodeURIComponent(queue)}/tasks/${encodeURIComponent(id)}/${action}`,
        { method: "POST" },
      ),
    onSuccess: (_result, {id}) => {
      void qc.invalidateQueries({queryKey: ["task", queue, id]});
      changed();
    },
    onError: (error, {id}) => {
      if (error instanceof ApiRequestError && error.status === 409) {
        void qc.invalidateQueries({queryKey: ["task", queue, id]});
        changed();
      }
    },
  });
  const resetAction = mutation.reset;
  useEffect(() => { resetAction(); }, [queue, taskId, resetAction]);
  const t = query.data;
  const durationNow = useExecutionClock(t?.status === "running");
  const action = (a: string) => {
    if (!actionPending) mutation.mutate({id: taskId, action: a});
  };
  const resizeFrom = (startX: number, startWidth: number) => {
    const move = (event: PointerEvent) => {
      setWidth(
        Math.min(800, Math.max(480, startWidth + startX - event.clientX)),
      );
    };
    const finish = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", finish);
      setWidth((current) => {
        saveSetting("labtasker:drawerWidth", String(current));
        return current;
      });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", finish, { once: true });
  };
  return (
    <Dialog.Root open modal={false} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Content asChild aria-describedby={undefined}
          onEscapeKeyDown={event => {
            if (event.target instanceof Element && event.target.closest(".observation-notice")) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            // Task links switch the inspector; notification actions leave it open.
            if (event.target instanceof Element && event.target.closest("tr[data-task-id], [data-task-link], #corner-notifications, .observation-notice, .profile-save-error")) {
              event.preventDefault();
            } else {
              // The outside control may push history in the same interaction.
              event.preventDefault();
              close(true);
            }
          }}
        >
          <aside
            className="drawer"
            aria-label={m.task.details}
            style={{ width }}
          >
            <div
              className="drawer-resize"
              role="separator"
              aria-label={m.task.resize}
              aria-orientation="vertical"
              aria-valuemin={480}
              aria-valuemax={800}
              aria-valuenow={width}
              tabIndex={0}
              onPointerDown={(event) => resizeFrom(event.clientX, width)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const next = Math.min(
                    800,
                    Math.max(
                      480,
                      width + (event.key === "ArrowLeft" ? 20 : -20),
                    ),
                  );
                  setWidth(next);
                  saveSetting("labtasker:drawerWidth", String(next));
                }
              }}
            />
            <div className="drawer-head">
              <div>
                <Dialog.Title asChild>
                  <h2>{t?.name || taskId}</h2>
                </Dialog.Title>
                <code data-tooltip={taskId}>{taskId}</code>
              </div>
              <Dialog.Close asChild>
                <button className="close" aria-label={m.common.close}>
                  ×
                </button>
              </Dialog.Close>
            </div>
            {query.isLoading ? (
              <div className="loading">
                <Spinner /> {m.task.loading}
              </div>
            ) : query.error ? (
              <div className="error">{query.error.message}</div>
            ) : (
              t && (
                <div className="drawer-body">
                  <div className="task-summary">
                    <Badge status={t.status} />
                    <div className="actions">
                      {["pending", "running"].includes(t.status) && (
                        <button
                          disabled={actionPending}
                          onClick={() => action("cancel")}
                        >
                          {mutation.isPending && mutation.variables?.action === "cancel"
                            ? m.task.cancelling
                            : m.task.cancel}
                        </button>
                      )}
                      {["pending", "failed", "cancelled"].includes(
                        t.status,
                      ) && (
                        <button
                          disabled={actionPending}
                          onClick={() => action("requeue")}
                        >
                          {mutation.isPending &&
                          mutation.variables?.action === "requeue"
                            ? m.task.requeuing
                            : m.task.requeue}
                        </button>
                      )}
                      {t.status !== "running" && (
                        <button
                          className="danger-link"
                          disabled={actionPending}
                          onClick={() => requestDelete(t.id)}
                        >
                          {m.task.delete}
                        </button>
                      )}
                    </div>
                  </div>
                  {mutation.error && (
                    <div className="error">
                      {mutation.error instanceof ApiRequestError &&
                      mutation.error.status === 409
                        ? m.errors.taskStateChanged(mutation.error.message)
                        : mutation.error.message}
                    </div>
                  )}
                  <section className="detail-section">
                    <h3>{m.task.execution}</h3>
                    <dl>
                      <dt>{m.task.queue}</dt>
                      <dd>{t.queue}</dd>
                      <dt>{m.task.attempt}</dt>
                      <dd>
                        {t.attempt} / {t.max_attempts}
                      </dd>
                      <dt>{m.task.priority}</dt>
                      <dd><PriorityValue value={t.priority} /></dd>
                      <dt>{m.task.routes}</dt>
                      <dd>{t.routes.join(", ")}</dd>
                      <dt>{m.task.lastRoute}</dt>
                      <dd>{t.last_route || "—"}</dd>
                      <dt>{m.task.duration}</dt>
                      <dd>
                        <ExecutionDuration task={t} now={durationNow} />
                      </dd>
                    </dl>
                  </section>
                  <section className="detail-section">
                    <h3>{m.task.timeline}</h3>
                    <dl>
                      <dt>{m.task.created}</dt>
                      <dd>
                        <TimeValue value={t.created_at} />
                      </dd>
                      <dt>{m.task.updated}</dt>
                      <dd>
                        <TimeValue value={t.updated_at} />
                      </dd>
                      <dt>{m.task.started}</dt>
                      <dd>
                        <TimeValue value={t.started_at} />
                      </dd>
                      <dt>{m.task.finished}</dt>
                      <dd>
                        <TimeValue value={t.finished_at} />
                      </dd>
                    </dl>
                  </section>
                  {t.last_error && (
                    <section className="detail-section failure">
                      <h3>{t.last_error.type}</h3>
                      <p>{t.last_error.message}</p>
                      <dl>
                        <dt>{m.task.occurred}</dt>
                        <dd>
                          <TimeValue value={t.last_error.occurred_at} />
                        </dd>
                        <dt>{m.task.attempt}</dt>
                        <dd>{t.last_error.attempt}</dd>
                        <dt>{m.task.runId}</dt>
                        <dd>
                          <code>{t.last_error.run_id}</code>
                        </dd>
                      </dl>
                      {t.last_error.traceback && (
                        <pre>{t.last_error.traceback}</pre>
                      )}
                    </section>
                  )}
                  <JsonBlock title={m.task.arguments} value={t.args} />
                  <JsonBlock title={m.task.metadata} value={t.metadata} />
                  <JsonBlock title={m.task.result} value={t.result} />
                  <JsonBlock title={m.task.rawTask} value={t} />
                </div>
              )
            )}
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteDialog({
  queue,
  server,
  target,
  close,
  done,
}: {
  queue: string;
  server: string;
  target: DeleteTarget;
  close: () => void;
  done: () => void;
}) {
  const [operation, setOperation] = useState<BatchOperation | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const active = useRef(true);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [monitorError, setMonitorError] = useState(false);

  const poll = async (operationId: string, retry = false) => {
    if (!active.current) return;
    clearTimeout(timer.current);
    if (retry) { setError(""); setMonitorError(false); }
    try {
      const next = await api<BatchOperation>(
        `/api/webui/delete-operations/${operationId}`,
      );
      if (!active.current) return;
      setOperation(next);
      setMonitorError(false);
      if (!next.done) {
        timer.current = window.setTimeout(() => void poll(operationId), 350);
      }
    } catch (reason) {
      if (!active.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setMonitorError(true);
    }
  };
  const start = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    setError("");
    try {
      const op = await api<BatchOperation>(
        `/api/webui/queues/${encodeURIComponent(queue)}/delete-operations`,
        {
          method: "POST",
          body: JSON.stringify({ task_ids: target.task_ids }),
        },
      );
      setOperation(op);
      void poll(op.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false; setBusy(false);
    }
  };
  const retryFailed = async () => {
    if (!operation || submitting.current) return;
    submitting.current = true; setBusy(true);
    setError("");
    try {
      const retry = await api<BatchOperation>(
        `/api/webui/delete-operations/${operation.id}/retry`,
        { method: "POST" },
      );
      setOperation(retry);
      void poll(retry.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false; setBusy(false);
    }
  };
  const stop = async () => {
    if (!operation || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const next = await api<BatchOperation>(`/api/webui/delete-operations/${operation.id}/stop`, {method: "POST"});
      setOperation(next);
      void poll(next.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false; setBusy(false);
    }
  };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; clearTimeout(timer.current); };
  }, []);
  const selector = target.selector
    ? Object.entries(target.selector)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${value}`)
        .join(" · ")
    : m.deletion.explicitSelection;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !operation && !submitting.current) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-back" />
        <Dialog.Content
          className="modal batch-modal"
          aria-describedby="delete-description"
        >
          <span className="danger-mark">!</span>
          <Dialog.Title asChild>
            <h2>{m.deletion.title(target.task_ids.length)}</h2>
          </Dialog.Title>
          <dl className="delete-scope">
            <dt>{m.deletion.server}</dt>
            <dd>{server}</dd>
            <dt>{m.deletion.queue}</dt>
            <dd>{queue}</dd>
            <dt>{m.deletion.scope}</dt>
            <dd>{selector}</dd>
            <dt>{m.deletion.snapshot}</dt>
            <dd>{m.deletion.immutableIds(target.task_ids.length)}</dd>
            <dt>{m.deletion.limit}</dt>
            <dd>{m.deletion.limitValue}</dd>
          </dl>
          <Dialog.Description asChild>
            <p id="delete-description">{m.deletion.warning}</p>
          </Dialog.Description>
          {error && <div className="error" role="alert">{error}</div>}
          {monitorError && operation && <p>Progress could not be refreshed. Deletion may still be running. Retry status or close and refresh the Task list.</p>}
          {operation ? (
            <>
              <div className="operation">
                <div>
                  <b>
                    {operation.completed} / {operation.total}
                  </b>
                  <span>{m.deletion.processed}</span>
                </div>
                <div className="progress">
                  <span
                    style={{
                      width: `${(operation.completed / operation.total) * 100}%`,
                    }}
                  />
                </div>
                <div className="operation-counts">
                  <span>
                    <b>{operation.counts.deleted}</b> {m.deletion.deleted}
                  </span>
                  <span>
                    <b>{operation.counts.absent}</b> {m.deletion.alreadyAbsent}
                  </span>
                  <span>
                    <b>{operation.counts.failed}</b> {m.deletion.failed}
                  </span>
                  <span>
                    <b>{operation.counts.stopped}</b> {m.deletion.notStarted}
                  </span>
                </div>
              </div>
              {operation.outcomes.filter((item) => item.status === "failed")
                .length > 0 && (
                <div className="failure-list">
                  {operation.outcomes
                    .filter((item) => item.status === "failed")
                    .map((item) => (
                      <div className="error" key={item.task_id}>
                        <code>{item.task_id}</code>
                        <span>
                          {item.code}: {item.message}
                        </span>
                      </div>
                    ))}
                </div>
              )}
              <div className="modal-actions">
                <button onClick={() => void copyJson(operation)}>
                  {m.deletion.copyReport}
                </button>
                {!operation.done && (
                  <button
                    disabled={busy || operation.stopped}
                    onClick={stop}
                  >
                    {m.deletion.stopRemaining}
                  </button>
                )}
                {operation.done && operation.counts.failed > 0 && (
                  <button disabled={busy} onClick={retryFailed}>
                    {m.deletion.retryFailed}
                  </button>
                )}
                {monitorError && <button disabled={busy} onClick={() => void poll(operation.id, true)}>Retry status</button>}
                <button
                  className="primary"
                  disabled={busy || (!operation.done && !monitorError)}
                  onClick={done}
                >
                  {operation.done ? m.common.done : "Close"}
                </button>
              </div>
            </>
          ) : (
            <div className="modal-actions">
              <button disabled={busy} onClick={close}>{m.common.cancel}</button>
              <button className="danger" disabled={busy} onClick={start}>
                {m.deletion.permanently}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function App() {
  const qc = useQueryClient();
  const status = useQuery<{
    connected: boolean;
    locked: boolean;
    server_url: string | null;
    connection_error: { code: string; message: string } | null;
  }>({
    queryKey: ["status"],
    queryFn: () => api("/api/webui/status"),
    retry: false,
  });
  const [queue, setQueue] = useState<string | null>(
    () =>
      new URLSearchParams(location.search).get("queue") ||
      localStorage.getItem("labtasker:lastQueue"),
  );
  const [initialStatus, setInitialStatus] = useState(
    () => new URLSearchParams(location.search).get("status") || "",
  );
  const [historyNavigation, setHistoryNavigation] = useState(false);
  useEffect(() => {
    const restoreLocation = () => {
      const url = new URLSearchParams(location.search);
      setHistoryNavigation(true);
      setQueue(url.get("queue"));
      setInitialStatus(url.get("status") || "");
    };
    addEventListener("popstate", restoreLocation);
    return () => removeEventListener("popstate", restoreLocation);
  }, []);
  const [changingConnection, setChangingConnection] = useState(false);
  const [authorizationLost, setAuthorizationLost] = useState(false);
  useEffect(() => {
    const onUnauthorized = () => setAuthorizationLost(true);
    addEventListener("labtasker:unauthorized", onUnauthorized);
    return () => removeEventListener("labtasker:unauthorized", onUnauthorized);
  }, []);
  const connected = () => {
    // A new session may belong to another Server or credential identity.
    // Recreate the workspace only after reading the new connection status.
    qc.clear();
    location.reload();
  };
  if (status.isLoading)
    return (
      <div className="splash">
        <Brand />
        <Spinner />
      </div>
    );
  if (status.data?.locked && !status.data.connected)
    return (
      <ConnectionProblem
        message={status.data.connection_error?.message}
        retry={() => void status.refetch()}
      />
    );
  if (!status.data?.connected)
    return (
      <Connect onDone={connected} />
    );
  if (authorizationLost) {
    if (status.data.locked) {
      return (
        <ConnectionProblem
          message={status.data.connection_error?.message}
          retry={() => {
            setAuthorizationLost(false);
            void qc.invalidateQueries();
          }}
        />
      );
    }
    return (
      <Connect onDone={connected} />
    );
  }
  return (
    <>
    {changingConnection && <Connect onDone={connected} onCancel={() => setChangingConnection(false)} initialServer={status.data.server_url || ""} />}
    <div hidden={changingConnection}>
    <Shell
      server={status.data.server_url || ""}
      locked={status.data.locked}
      allowDisconnect={true}
      onDisconnect={() => setChangingConnection(true)}
    >
      <ServerVersionWarning />
      {queue ? (
        <Workspace
          key={`${status.data.server_url}/${queue}`}
          queue={queue}
          initialStatus={initialStatus}
          historyNavigation={historyNavigation}
          server={status.data.server_url || ""}
          back={() => {
            history.pushState({}, "", location.pathname);
            setQueue(null);
            setInitialStatus("");
          }}
        />
      ) : (
        <Overview
          server={status.data.server_url || ""}
          openQueue={(name, s = "") => {
            const url = new URL(location.href);
            url.search = "";
            url.searchParams.set("queue", name);
            if (s) url.searchParams.set("status", s);
            history.pushState({}, "", url);
            setHistoryNavigation(false);
            setInitialStatus(s);
            setQueue(name);
          }}
        />
      )}
    </Shell>
    </div>
    </>
  );
}

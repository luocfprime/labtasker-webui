import { api } from "./api";

export type Worker = {
  id: string; queue: string; route: string; status: "idle" | "busy";
  task_id: string | null; metadata: Record<string, unknown>;
  telemetry: Record<string, unknown> | null; telemetry_updated_at: string | null;
  last_seen_at: string; expires_at: string;
};
export type Group = {key: Record<string, string>; count: number};
type GroupPage = {group_by: string[]; count: number; items: Group[]; next_cursor: string | null};
export type RouteCount = {name: string; pending: number; running: number; terminal: number; idle: number; busy: number};
export async function readGroups(url: string): Promise<Group[]> {
  const items: Group[] = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  do {
    const next = new URL(url, location.origin);
    if (cursor) next.searchParams.set("cursor", cursor);
    const page: GroupPage = await api(next.pathname + next.search);
    items.push(...page.items);
    cursor = page.next_cursor;
    if (cursor) {
      if (visited.has(cursor)) throw new Error("Server returned a repeated group cursor.");
      visited.add(cursor);
    }
  } while (cursor);
  return items;
}
export function combineRoutes(tasks: Group[], workers: Group[]): RouteCount[] {
  const rows = new Map<string, RouteCount>();
  const get = (name: string) => {
    if (!rows.has(name)) rows.set(name, {name, pending: 0, running: 0, terminal: 0, idle: 0, busy: 0});
    return rows.get(name)!;
  };
  for (const group of tasks) {
    const row = get(group.key.routes);
    if (group.key.status === "pending") row.pending += group.count;
    else if (group.key.status === "running") row.running += group.count;
    else row.terminal += group.count;
  }
  for (const group of workers) {
    const row = get(group.key.route);
    if (group.key.status === "idle") row.idle += group.count;
    if (group.key.status === "busy") row.busy += group.count;
  }
  return [...rows.values()].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
export function workerFreshness(worker: Worker, now: number) {
  const age = Math.max(0, now - Date.parse(worker.last_seen_at));
  const remaining = Math.max(0, Date.parse(worker.expires_at) - now);
  return {age, remaining, delayed: age > 120_000, expired: remaining === 0};
}
export function workerFilter(route: string, status: string, filter = "") {
  return [
    route && `route == ${JSON.stringify(route)}`,
    status && `status == ${JSON.stringify(status)}`,
    filter.trim() && `(${filter.trim()})`,
  ].filter(Boolean).join(" and ");
}

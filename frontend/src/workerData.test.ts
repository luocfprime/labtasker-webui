import { expect, test } from "vitest";
import { combineRoutes, workerFreshness, workerFilter, type Worker } from "./workerData";
import { effectiveTaskFilter } from "./countFilters";

test("expiry attention starts only after two report cycles, using Server expiry", () => {
  const worker = {last_seen_at: "2026-09-09T00:00:00Z", expires_at: "2026-09-09T00:05:00Z"} as Worker;
  expect(workerFreshness(worker, Date.parse("2026-09-09T00:02:00Z")).delayed).toBe(false);
  expect(workerFreshness(worker, Date.parse("2026-09-09T00:02:01Z"))).toMatchObject({delayed: true, remaining: 179000, expired: false});
  expect(workerFreshness(worker, Date.parse("2026-09-09T00:05:00Z")).expired).toBe(true);
});
test("route union includes waiting Tasks without Workers and idle Workers without Tasks", () => {
  expect(combineRoutes([{key: {routes: "waiting", status: "pending"}, count: 2}], [{key: {route: "idle-only", status: "idle"}, count: 3}])).toMatchObject([
    {name: "idle-only", idle: 3, pending: 0}, {name: "waiting", pending: 2, idle: 0, busy: 0},
  ]);
});
test("selected routes intersect expressions with safely quoted case-sensitive values", () => {
  expect(effectiveTaskFilter({filter: "priority > 0 or priority < -1", route: 'GPU"A'})).toBe('(priority > 0 or priority < -1) and ("GPU\\"A" in routes)');
  expect(workerFilter('GPU"A', 'idle')).toBe('route == "GPU\\"A" and status == "idle"');
});

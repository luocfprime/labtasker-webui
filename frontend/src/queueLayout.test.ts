import { afterEach, expect, it } from "vitest";
import { readQueueLayout, saveQueueLayout } from "./queueLayout";
afterEach(() => localStorage.clear());
it("isolates layout by server and queue, including widths and custom columns", () => {
  const a = {visible: ["task", "path:args.foo"], custom: ["args.foo"], order: ["path:args.foo", "task"], widths: {task: 700}};
  const b = {visible: ["priority"], custom: [], order: ["priority"], widths: {priority: 90}};
  saveQueueLayout("server/default", a);
  saveQueueLayout("server/other", b);
  expect(readQueueLayout("server/default")).toEqual(a);
  expect(readQueueLayout("server/other")).toEqual(b);
  expect(readQueueLayout("another-server/default")).toEqual({});
});
it("recovers only the current queue's active view and ignores global legacy state", () => {
  localStorage.setItem("labtasker:columns:v3", '["priority"]');
  localStorage.setItem("labtasker:views:v1", JSON.stringify({"server/default": {active: "v1", views: [{id: "v1", state: {visible: ["task"]}}]}}));
  expect(readQueueLayout("server/default")).toEqual({visible: ["task"]});
  expect(readQueueLayout("server/other")).toEqual({});
});

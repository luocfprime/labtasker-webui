import { afterEach, expect, it, vi } from "vitest";
import { loadProfile, saveSetting } from "./profile";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });
it("restores disk settings and persists subsequent changes", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValueOnce({ok: true, json: async () => ({enabled: true, ui: {"labtasker:columnOrder:v1": '["task","status"]'}})}).mockResolvedValue({ok: true});
  vi.stubGlobal("fetch", fetchMock);
  await loadProfile();
  expect(localStorage.getItem("labtasker:columnOrder:v1")).toBe('["task","status"]');
  saveSetting("labtasker:columnOrder:v1", '["status","task"]');
  await vi.advanceTimersByTimeAsync(300);
  expect(fetchMock).toHaveBeenLastCalledWith("/api/webui/profile", expect.objectContaining({method: "PATCH", body: JSON.stringify({"labtasker:columnOrder:v1": '["status","task"]'})}));
});
it("keeps browser settings usable when profiles are disabled", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ok: true, json: async () => ({enabled: false, ui: {}})});
  vi.stubGlobal("fetch", fetchMock);
  await loadProfile();
  saveSetting("labtasker:drawerWidth", "600");
  expect(localStorage.getItem("labtasker:drawerWidth")).toBe("600");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

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
it("shows save failures and retries the latest settings", async () => {
  vi.useFakeTimers();
  const {getProfileSaveError, retryProfileSave} = await import("./profile");
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ok:true, json:async () => ({enabled:true, ui:{}})})
    .mockResolvedValueOnce({ok:false})
    .mockResolvedValue({ok:true});
  vi.stubGlobal("fetch", fetchMock);
  await loadProfile();
  saveSetting("labtasker:drawerWidth", "600");
  await vi.advanceTimersByTimeAsync(300);
  expect(getProfileSaveError()).toBe(true);
  expect(localStorage.getItem("labtasker:drawerWidth")).toBe("600");
  saveSetting("labtasker:drawerWidth", "720");
  await retryProfileSave();
  expect(fetchMock).toHaveBeenLastCalledWith("/api/webui/profile", expect.objectContaining({body: JSON.stringify({"labtasker:drawerWidth":"720"})}));
  expect(getProfileSaveError()).toBe(false);
});
it("preserves unsaved browser settings across profile reload and clears them after retry", async () => {
  vi.useFakeTimers();
  const {retryProfileSave} = await import("./profile");
  const disk = {ok:true, json:async () => ({enabled:true, ui:{"labtasker:drawerWidth":"500"}})};
  const fetchMock = vi.fn().mockResolvedValueOnce(disk).mockResolvedValueOnce({ok:false}).mockResolvedValueOnce(disk).mockResolvedValue({ok:true});
  vi.stubGlobal("fetch", fetchMock);
  await loadProfile();
  saveSetting("labtasker:drawerWidth", "720");
  await vi.advanceTimersByTimeAsync(300);
  expect(localStorage.getItem("labtasker:profilePending:v1")).toContain("720");
  await loadProfile();
  expect(localStorage.getItem("labtasker:drawerWidth")).toBe("720");
  await retryProfileSave();
  expect(localStorage.getItem("labtasker:profilePending:v1")).toBeNull();
});
it("saves large UTF-8 profiles without the browser keepalive body limit", async () => {
  vi.useFakeTimers();
  const {retryProfileSave, getProfileSaveError} = await import("./profile");
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "PATCH") return {ok:true,json:async () => ({enabled:true,ui:{}})};
    if (init.keepalive && new TextEncoder().encode(String(init.body)).length > 65536) throw new TypeError("Keepalive body too large");
    return {ok:true};
  });
  vi.stubGlobal("fetch", fetchMock);
  await loadProfile();
  const value = "é".repeat(40000);
  saveSetting("labtasker:views:v1", value);
  await retryProfileSave();
  expect(getProfileSaveError()).toBe(false);
  expect(localStorage.getItem("labtasker:profilePending:v1")).toBeNull();
});
it("times out a stalled save and lets retry persist the latest change", async () => {
  vi.useFakeTimers();
  const {retryProfileSave, getProfileSaveError} = await import("./profile");
  const fetchMock = vi.fn().mockResolvedValueOnce({ok:true,json:async () => ({enabled:true,ui:{}})})
    .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
    })).mockResolvedValue({ok:true});
  vi.stubGlobal("fetch", fetchMock);
  await loadProfile();
  saveSetting("labtasker:drawerWidth", "600");
  const first = retryProfileSave();
  await vi.advanceTimersByTimeAsync(10000);
  expect(getProfileSaveError()).toBe(true);
  await first;
  saveSetting("labtasker:drawerWidth", "720");
  await retryProfileSave();
  expect(getProfileSaveError()).toBe(false);
  expect(fetchMock).toHaveBeenLastCalledWith("/api/webui/profile", expect.objectContaining({body:JSON.stringify({"labtasker:drawerWidth":"720"})}));
});

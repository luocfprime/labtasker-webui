import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDrawer } from "./App";

afterEach(cleanup);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "t_one",
        queue: "robotwin",
        status: "pending",
        name: "evaluate",
        args: {},
        metadata: {},
        priority: 1,
        attempt: 0,
        max_attempts: 3,
        routes: ["gpu"],
        result: {},
        last_error: null,
        last_route: null,
        created_at: "2026-09-08T00:00:00Z",
        updated_at: "2026-09-08T00:00:00Z",
        started_at: null,
        finished_at: null,
      }),
    }),
  );
});

function renderDrawer(close = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TaskDrawer
        queue="robotwin"
        taskId="t_one"
        close={close}
        changed={() => undefined}
        requestDelete={() => undefined}
      />
    </QueryClientProvider>,
  );
  return close;
}

describe("TaskDrawer keyboard behavior", () => {
  it("resizes with arrow keys and remembers the width", () => {
    renderDrawer();
    const resize = screen.getByRole("separator", {
      name: "Resize Task details",
    });
    expect(resize).toHaveAttribute("aria-valuenow", "600");
    fireEvent.keyDown(resize, { key: "ArrowLeft" });
    expect(resize).toHaveAttribute("aria-valuenow", "620");
    expect(localStorage.getItem("labtasker:drawerWidth")).toBe("620");
  });

  it("closes on Escape", () => {
    const close = renderDrawer();
    fireEvent.keyDown(screen.getByLabelText("Task details"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});

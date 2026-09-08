import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DeleteDialog,
  PriorityValue,
  ExecutionDuration,
  JsonNode,
  StaleDataBanner,
  TimeValue,
  adaptivePolling,
  formatDuration,
} from "./App";

describe("TimeValue", () => {
  it("renders local time with exact UTC and zone in the tooltip", () => {
    render(<TimeValue value="2026-09-08T00:00:00Z" />);
    const time = screen.getByText(/2026|Sep|9\/8/);
    expect(time).toHaveAttribute("datetime", "2026-09-08T00:00:00Z");
    expect(time.getAttribute("data-tooltip")).toContain("2026-09-08T00:00:00.000Z");
    expect(time.getAttribute("data-tooltip")).toContain(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});

describe("ExecutionDuration", () => {
  it("formats a terminal duration from Server timestamps", () => {
    render(
      <ExecutionDuration
        task={{
          status: "succeeded",
          started_at: "2026-09-08T00:00:00Z",
          finished_at: "2026-09-08T01:02:03Z",
        }}
      />,
    );
    expect(screen.getByText("1h 2m")).toHaveAccessibleName(
      "Execution duration 1h 2m",
    );
  });

  it("marks a running duration as approximate", () => {
    render(
      <ExecutionDuration
        now={Date.parse("2026-09-08T00:12:34Z")}
        task={{
          status: "running",
          started_at: "2026-09-08T00:00:00Z",
          finished_at: null,
        }}
      />,
    );
    expect(screen.getByText("~12m 34s")).toHaveAccessibleName(
      "Execution duration approximately 12m 34s",
    );
  });

  it("does not expose stale execution timestamps for a pending Task", () => {
    const { container } = render(
      <ExecutionDuration
        task={{
          status: "pending",
          started_at: "2026-09-08T00:00:00Z",
          finished_at: "2026-09-08T00:01:00Z",
        }}
      />,
    );
    expect(container).toHaveTextContent("—");
  });

  it("uses compact duration units", () => {
    expect(formatDuration(42_900)).toBe("42s");
    expect(formatDuration(3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000)).toBe(
      "3d 4h",
    );
  });
});

describe("JsonNode", () => {
  it("renders nested objects and safe HTTP links without linking file paths", () => {
    render(
      <JsonNode
        value={{
          nested: {
            url: "https://example.test/result",
            path: "/tmp/result.json",
          },
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "https://example.test/result" }),
    ).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText('"/tmp/result.json"')).not.toHaveRole("link");
    expect(screen.getByText(/Object · 1/)).toBeVisible();
  });

  it("copies a selected subtree", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<JsonNode label="payload" value={{ answer: 42 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy payload" }));
    expect(writeText).toHaveBeenCalledWith('{\n  "answer": 42\n}');
  });
});

describe("polling and recovery", () => {
  it("backs off after failures and pauses in a hidden tab", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    expect(adaptivePolling(5000)({ state: { fetchFailureCount: 0 } })).toBe(
      5000,
    );
    expect(adaptivePolling(5000)({ state: { fetchFailureCount: 3 } })).toBe(
      40000,
    );
    expect(adaptivePolling(5000)({ state: { fetchFailureCount: 20 } })).toBe(
      60000,
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    expect(adaptivePolling(5000)({ state: { fetchFailureCount: 0 } })).toBe(
      false,
    );
  });

  it("distinguishes an initial load failure from stale cached data", () => {
    const { unmount } = render(
      <StaleDataBanner
        error={new Error("offline")}
        updatedAt={0}
        retry={() => undefined}
      />,
    );
    expect(screen.getByText("Unable to load data.")).toBeVisible();
    expect(screen.queryByText("Data may be stale.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Last successful refresh/)).not.toBeInTheDocument();
    unmount();
  });

  it("keeps last-success context and exposes an immediate retry", () => {
    const retry = vi.fn();
    render(
      <StaleDataBanner
        error={new Error("offline")}
        updatedAt={Date.now()}
        retry={retry}
      />,
    );
    expect(screen.getByText(/Last successful refresh/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("DeleteDialog", () => {
  it("shows the complete immutable destructive scope before starting", () => {
    render(
      <DeleteDialog
        queue="robotwin"
        server="https://tasks.example"
        target={{
          task_ids: ["t_one", "t_two"],
          selector: { status: "failed", name: null, filter: "priority > 3" },
        }}
        close={() => undefined}
        done={() => undefined}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete 2 Tasks?" });
    expect(dialog).toHaveTextContent("https://tasks.example");
    expect(dialog).toHaveTextContent("status=failed · filter=priority > 3");
    expect(dialog).toHaveTextContent("2 immutable Task IDs");
  });
});


describe("PriorityValue", () => {
  it.each([[-100, "↓"], [-1, "↓"], [0, ""], [1, "↑"], [100, "↑"]])(
    "preserves signed priority %s with its direction",
    (value, arrow) => {
      const { container } = render(<PriorityValue value={Number(value)} />);
      expect(container.textContent).toBe(`${value}${arrow}`);
      expect(container.querySelectorAll(".priority-direction")).toHaveLength(arrow ? 1 : 0);
    },
  );
});

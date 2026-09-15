import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeleteDialog,
  PriorityValue,
  TaskProgressCell,
  ExecutionDuration,
  JsonNode,
  StaleDataBanner,
  TimeValue,
  adaptivePolling,
  formatDuration,
  formatEstimatedDuration,
  progressEta,
  progressPercentage,
} from "./App";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TaskProgressCell", () => {
  it("accepts finite numeric completion and floors the percentage", () => {
    expect(progressPercentage({ completed: 42.9, total: 100 })).toBe(42);
    expect(progressPercentage({ completed: 0.2, total: 1 })).toBe(20);
    for (const completed of [29, 57, 58]) {
      expect(progressPercentage({ completed, total: 100 })).toBe(completed);
    }
    expect(progressPercentage({ completed: 0.29, total: 1 })).toBe(29);
    expect(progressPercentage({ completed: 28.999999, total: 100 })).toBe(28);
    expect(progressPercentage({ completed: 1 - Number.EPSILON, total: 1 })).toBe(99);
    expect(progressPercentage({ completed: Number.MAX_VALUE, total: Number.MAX_VALUE })).toBe(100);
    expect(progressPercentage({ completed: 101, total: 100 })).toBeNull();
    expect(progressPercentage({ completed: -1, total: 100 })).toBeNull();
    expect(progressPercentage({ completed: 1, total: 0 })).toBeNull();
    expect(progressPercentage({ completed: true, total: 1 })).toBeNull();
    expect(progressPercentage({ metrics: { loss: 0.5 } })).toBeNull();
  });

  it("renders only the running determinate ring or fallback dash", () => {
    const { container, rerender } = render(
      <TaskProgressCell
        task={{
          status: "running",
          attempt: 2,
          started_at: "2026-09-08T00:00:00Z",
          progress: { completed: 3, total: 4 },
          progress_attempt: 2,
          progress_updated_at: "2026-09-08T00:00:00Z",
        }}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "Task progress: 75%" })).not.toHaveTextContent(
      "75",
    );
    const trigger = screen.getByRole("button", { name: "Show Task progress: 75%" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Task progress details" })).toBeVisible();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Task progress details" })).toBeNull();

    rerender(
      <TaskProgressCell
        task={{
          status: "running",
          attempt: 2,
          started_at: "2026-09-08T00:00:00Z",
          progress: { completed: 5, total: 4 },
          progress_attempt: 2,
          progress_updated_at: "2026-09-08T00:00:00Z",
        }}
      />,
    );
    expect(container).toHaveTextContent("—");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    rerender(
      <TaskProgressCell
        task={{
          status: "succeeded",
          attempt: 2,
          started_at: "2026-09-08T00:00:00Z",
          progress: { completed: 4, total: 4 },
          progress_attempt: 2,
          progress_updated_at: "2026-09-08T00:00:00Z",
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("anchors a derived ETA to the latest progress report", () => {
    expect(
      progressEta(
        {
          status: "running",
          attempt: 1,
          started_at: "2026-09-08T00:00:00Z",
          progress: { completed: 25, total: 100 },
          progress_attempt: 1,
          progress_updated_at: "2026-09-08T00:10:00Z",
        },
        Date.parse("2026-09-08T00:12:00Z"),
      ),
    ).toEqual({ kind: "remaining", milliseconds: 28 * 60_000, reported: false });
  });

  it("prefers a reported ETA and renders a compact progress JSON tree", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-08T00:12:00Z");
    render(
      <TaskProgressCell
        task={{
          status: "running",
          attempt: 1,
          started_at: "2026-09-08T00:00:00Z",
          progress: {
            completed: 25,
            total: 100,
            eta: 600,
            metrics: { validation_loss: 0.82 },
          },
          progress_attempt: 1,
          progress_updated_at: "2026-09-08T00:10:00Z",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show Task progress: 25%" }));
    const popover = screen.getByRole("dialog", { name: "Task progress details" });
    expect(popover).toHaveTextContent("Duration");
    expect(popover).toHaveTextContent("~12m 0s");
    expect(popover).toHaveTextContent("8m remaining");
    expect(popover.querySelector(".progress-json-tree .json-node")).not.toBeNull();
    expect(popover.querySelector("pre")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy reported progress data" }),
    ).toBeVisible();
  });

  it("keeps minutes in hour- and day-scale ETA values", () => {
    expect(formatEstimatedDuration((3 * 60 + 20) * 60_000)).toBe("3h 20m");
    expect(formatEstimatedDuration((24 * 60 + 3 * 60 + 20) * 60_000)).toBe(
      "1d 3h 20m",
    );
  });
});

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

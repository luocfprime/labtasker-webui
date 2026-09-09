import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { observeVersionHeaders, ServerVersionWarning } from "./ServerVersionWarning";

function observe(server: string, older = true) {
  act(() => observeVersionHeaders(new Headers({
    "Labtasker-Client-Version": "2.10.0",
    "Labtasker-Server-Version": server,
    "Labtasker-Server-Upgrade-Recommended": String(older),
  })));
}
beforeEach(() => observe("", false));

it("shows a dismissible warning and keeps it dismissed across polling", () => {
  render(<ServerVersionWarning />);
  observe("2.1.0");
  expect(screen.getByRole("status")).toHaveTextContent("Server 2.1.0 is older than Client 2.10.0");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss Server version warning" }));
  observe("2.1.0");
  expect(screen.queryByRole("status")).toBeNull();
  observe("2.2.0");
  expect(screen.getByRole("status")).toHaveTextContent("Server 2.2.0");
});

it("clears a warning after upgrade or an unknown version, but not on unrelated responses", () => {
  render(<ServerVersionWarning />);
  observe("2.1.0");
  act(() => observeVersionHeaders(new Headers()));
  expect(screen.getByRole("status")).toBeVisible();
  observe("2.10.0", false);
  expect(screen.queryByRole("status")).toBeNull();
  observe("2.1.0");
  observe("", false);
  expect(screen.queryByRole("status")).toBeNull();
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FilterInput } from "./FilterInput";
afterEach(cleanup);

it("fills an example without applying it and returns focus to the input", () => {
  const change = vi.fn();
  render(<FilterInput label="Advanced filter expression" value="" onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Filter syntax and examples" }));
  expect(screen.getByText(/then click Apply/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Negative priority/ }));
  expect(change).toHaveBeenCalledWith("priority < 0");
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

it("dismisses help with Escape or an outside click", () => {
  render(<FilterInput label="Advanced filter expression" value="" onChange={() => {}} />);
  const trigger = screen.getByRole("button", { name: "Filter syntax and examples" });
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("saves and restores a named filter", () => {
  localStorage.clear();
  const change = vi.fn();
  const view = render(<FilterInput label="Advanced filter expression" value="priority > 10" onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Filter syntax and examples" }));
  fireEvent.change(screen.getByLabelText("Preset name"), {target: {value: "Urgent"}});
  fireEvent.click(screen.getByRole("button", {name: "Save current"}));
  view.unmount();
  render(<FilterInput label="Advanced filter expression" value="" onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Filter syntax and examples" }));
  fireEvent.click(screen.getByRole("button", {name: /Urgent priority/}));
  expect(change).toHaveBeenCalledWith("priority > 10");
});

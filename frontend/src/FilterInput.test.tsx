import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FilterInput } from "./FilterInput";
afterEach(cleanup);

it("applies an example immediately and returns focus to the input", () => {
  const change = vi.fn();
  const commit = vi.fn();
  render(<FilterInput label="Advanced filter expression" value="" onChange={change} onCommit={commit} />);
  fireEvent.click(screen.getByRole("button", { name: "Filter syntax and examples" }));
  expect(screen.getByText(/apply it immediately/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Includes route/ }));
  expect(change).toHaveBeenCalledWith('"gpu-a100" in routes');
  expect(commit).toHaveBeenCalledWith('"gpu-a100" in routes');
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

it("applies on Enter but not while composing text", () => {
  const apply = vi.fn();
  render(<FilterInput label="Filter" value="priority > 0" onChange={() => {}} onApply={apply} />);
  const input = screen.getByRole("textbox");
  fireEvent.keyDown(input, {key: "Enter", isComposing: true});
  fireEvent.keyDown(input, {key: "Enter", keyCode: 229});
  expect(apply).not.toHaveBeenCalled();
  fireEvent.keyDown(input, {key: "Enter"});
  expect(apply).toHaveBeenCalledTimes(1);
});

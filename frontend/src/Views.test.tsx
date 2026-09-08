import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Views, type ViewState } from "./Views";
const state: ViewState = {filters: {status: "failed", name: "", filter: "priority > 0", order_by: "created_at", descending: true}, visible: ["task", "path:args.foo"], custom: ["args.foo"], order: ["task", "path:args.foo"], widths: {task: 400}};
afterEach(() => {cleanup(); localStorage.clear();});
function action(name: string) {
  fireEvent.click(screen.getByRole("button", {name: "View actions"}));
  fireEvent.click(screen.getByRole("menuitem", {name}));
}
function create() {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("button", {name: "+ Create view"}));
  fireEvent.change(screen.getByLabelText("View name"), {target: {value: "Failures"}});
  fireEvent.click(screen.getByRole("button", {name: "Create view"}));
}
it("creates, restores, saves, renames and confirms deletion of scoped views", () => {
  const apply = vi.fn();
  const view = render(<Views scope="server/default" current={state} apply={apply} />);
  create();
  expect(screen.getByRole("combobox")).toHaveTextContent("Failures");
  expect(screen.queryByRole("button", {name: "Save"})).toBeNull();
  view.unmount();
  const changed = {...state, widths: {task: 500}};
  const next = render(<Views scope="server/default" current={changed} apply={apply} />);
  expect(screen.getByLabelText("Unsaved changes")).toBeVisible();
  fireEvent.click(screen.getByRole("button", {name: "Save"}));
  expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
  action("Rename");
  fireEvent.change(screen.getByLabelText("View name"), {target: {value: "Urgent failures"}});
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Rename"}));
  expect(screen.getByRole("combobox")).toHaveTextContent("Urgent failures");
  next.unmount();
  const isolated = render(<Views scope="server/another" current={state} apply={apply} />);
  expect(screen.getByRole("combobox")).toHaveTextContent("Unsaved view");
  isolated.unmount();
  render(<Views scope="server/default" current={changed} apply={apply} />);
  action("Delete");
  expect(screen.getByRole("dialog")).toHaveAccessibleName('Delete “Urgent failures”?');
  fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
  expect(screen.getByRole("combobox")).toHaveTextContent("Urgent failures");
  action("Delete");
  fireEvent.click(screen.getByRole("button", {name: "Delete view"}));
  expect(screen.getByRole("combobox")).toHaveTextContent("Unsaved view");
  expect(JSON.parse(localStorage.getItem("labtasker:views:v1")!)["server/default"].views).toEqual([]);
});
it("resets changes and saves a copy without overwriting the original", () => {
  const apply = vi.fn();
  const view = render(<Views scope="server/default" current={state} apply={apply} />);
  create();
  const changed = {...state, widths: {task: 600}};
  view.rerender(<Views scope="server/default" current={changed} apply={apply} />);
  action("Reset changes");
  expect(apply).toHaveBeenLastCalledWith(state);
  action("Save as…");
  fireEvent.change(screen.getByLabelText("View name"), {target: {value: "Failures"}});
  expect(within(screen.getByRole("dialog")).getByRole("button", {name: "Save"})).toBeDisabled();
  fireEvent.change(screen.getByLabelText("View name"), {target: {value: "Wide failures"}});
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Save"}));
  const saved = JSON.parse(localStorage.getItem("labtasker:views:v1")!)["server/default"].views;
  expect(saved.map((v: {state: ViewState}) => v.state.widths.task)).toEqual([400, 600]);
});

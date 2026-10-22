import { expect, it } from "vitest";
import { statusCountParams } from "./countFilters";

it("counts each status within the applied expression and name", () => {
  const filters = {
    status: "running",
    name: "a&b",
    filter: 'status in ["pending", "running"]',
  };
  const params = statusCountParams(filters, "succeeded");
  expect(params.get("status")).toBe("succeeded");
  expect(params.get("filter")).toBe(filters.filter);
  expect(params.get("name_fuzzy")).toBe("a&b");
});

it("ignores the selected list status when counting other statuses", () => {
  const filters = { status: "pending", name: "", filter: "" };
  expect(statusCountParams(filters, "running").toString()).toBe("status=running");
  expect(statusCountParams(filters, "pending").toString()).toBe("status=pending");
});

it("uses the same archive range as the Task list", () => {
  const filters = {name: "", filter: "archived == True", include_archived: true};
  const params = statusCountParams(filters, "cancelled");
  expect(params.get("include_archived")).toBe("true");
  expect(params.get("filter")).toBe("archived == True");
});

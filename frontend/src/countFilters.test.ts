import { expect, it } from "vitest";
import { statusCountParams } from "./countFilters";
it("counts each status within the applied expression and name", () => {
  const filters = {status: "", name: "a&b", filter: 'status in ["pending", "running"]'};
  const params = statusCountParams(filters, "succeeded")!;
  expect(params.get("status")).toBe("succeeded");
  expect(params.get("filter")).toBe(filters.filter);
  expect(params.get("name")).toBe("a&b");
});
it("keeps the explicit status selector as part of the intersection", () => {
  expect(statusCountParams({status: "pending", name: "", filter: ""}, "running")).toBeNull();
  expect(statusCountParams({status: "pending", name: "", filter: ""}, "pending")!.toString()).toBe("status=pending");
});

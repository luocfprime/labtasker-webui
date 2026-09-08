import { expect, it } from "vitest";
import { pathParts, pathValue } from "./customColumns";
it("reads nested fields, arrays and falsy values without inventing missing data", () => {
  const task = {args: {foo: {bar: 0}, items: [{ok: false}]}, summary: {success_rate: .75}, result: {a: 1}};
  expect(pathValue(task, "args.foo.bar")).toBe("0");
  expect(pathValue(task, "$.args.items[0].ok")).toBe("false");
  expect(pathValue(task, "summary.success_rate")).toBe("0.75");
  expect(pathValue(task, "result")).toBe('{"a":1}');
  expect(pathValue(task, "args.missing.field")).toBe("");
  expect(pathValue({args: null}, "args.foo")).toBe("");
  expect(pathValue(task, "constructor.name")).toBe("");
  expect(pathParts("args..foo")).toBeNull();
});

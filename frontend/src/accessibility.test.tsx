import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { Connect, DeleteDialog, JsonNode } from "./App";

afterEach(cleanup);

const provider = (node: React.ReactNode) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
};

async function expectNoViolations(container: HTMLElement) {
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.length })),
  ).toEqual([]);
}

describe("automated accessibility", () => {
  it("has no detectable violations on the connection page", async () => {
    const { container } = provider(<Connect onDone={() => undefined} />);
    await expectNoViolations(container);
  });

  it("has no detectable violations in the destructive dialog", async () => {
    const { container } = render(
      <DeleteDialog
        queue="robotwin"
        server="https://tasks.example"
        target={{ task_ids: ["t_one"] }}
        close={() => undefined}
        done={() => undefined}
      />,
    );
    await expectNoViolations(container.ownerDocument.body);
  });

  it("has no detectable violations in the structured JSON viewer", async () => {
    const { container } = render(
      <JsonNode
        value={{ output: { score: 0.98, artifact: "https://example.test" } }}
      />,
    );
    await expectNoViolations(container);
  });
});

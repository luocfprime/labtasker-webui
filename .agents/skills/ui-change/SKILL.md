---
name: ui-change
description: Reproduce and fix a Labtasker WebUI interaction, state, or layout defect; use for UI behavior changes and browser regressions.
---

# Change Labtasker WebUI behavior

Read root `AGENTS.md`, `docs/reference/specification.md`, and the relevant section of
`.agents/sops/qa.md`. Preserve real workloads; use the synthetic fixture. Inspect the current
diff and do not include unrelated changes.

1. Reproduce using the current frontend build. Record viewport, browser, trigger and
   expected result. For focus/menu behavior include WebKit.
2. Trace the responsible state and event/request order. Distinguish draft versus applied
   filters, local versus persisted settings, and connection/Queue/view scopes.
3. Add a regression for the failure, then fix the owning component. Prefer existing
   anchored-panel, Select, tooltip and persistence helpers over parallel implementations.
4. Build assets before browser tests. Run one Playwright invocation at a time. Exercise
   the affected cases from the QA matrix; inspect screenshots/traces for visual failures.
5. Update the contract/docs when behavior changes. Run proportional final checks from
   `.agents/sops/development.md`; report results and limitations without claiming zero defects.

Do not add confirmation prompts to routine view switching, mutate lingbot queues,
reintroduce forced Apply for dropdowns, or weaken tests to accept a broken interaction.

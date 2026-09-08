# Labtasker WebUI agent guide

## Project context and boundaries

- Read this file and [CONTRIBUTING.md](CONTRIBUTING.md) before changing the project.
- Keep source comments, UI copy, documentation, and project metadata in English. There is no i18n layer yet. Preserve user-provided data and JSON-path casing.
- This is a WebUI/BFF for an existing Labtasker v2 instance. Do not add Task submission/editing, a scheduler, database access, or automatic Labtasker lifecycle management without a product request.
- Local mode attaches to an already-running project's Unix socket. It must not start, stop, restart, or open the database of that instance.
- Never modify `lingbot` queues or other real workloads during testing. Use the isolated fixture by default. Live dummy mutations require explicit authorization and must stay within `default` and clearly identified test Task IDs.
- Never print tokens, source a user's whole shell configuration, commit profiles, or upload authenticated browser traces. Credentials belong only on the backend and in `.labtasker/webui-token` with mode `0600`.
- Preserve existing uncommitted work. Do not reset/stash it, restart unrelated processes, or publish releases merely to complete a check.

## Sources of truth

- `docs/reference/specification.md` records the maintained WebUI contract and state ownership. Follow the Labtasker v2 specification for upstream Task, Queue, Client and Server semantics.
- `README.md` and `docs/` explain the product. Update them when observable behavior changes.
- Keep internal development, QA and release SOPs in `.agents/sops/`, with focused agent workflows in `.agents/skills/`. Do not put internal operating procedures in product documentation.
- Tests are executable invariants, not a substitute for the contract. Change implementation, tests and affected guidance together.
- Follow the Labtasker series' terminology, uv/Ruff workflow and small product boundary. Do not recreate parallel planning/comparison documents or import unrelated Server/Worker responsibilities.

## Working agreements

- Use `uv sync --group dev --frozen` and `uv run` from the repository root for Python. Use the existing npm lockfile for the frontend; do not introduce another package manager or environment.
- Keep public concepts capitalized as Task, Queue, Worker, Client and Server. Keep generated assets, lockfile records and local `.labtasker/` data owned by their tools.
- Use `.agents/skills/ui-change` for interface regressions and `.agents/skills/release` for release readiness/publication. These are focused WebUI adaptations of the Labtasker repository workflows.
- Do not commit, tag, push, create a release or publish unless the user explicitly authorizes that action.

## Project map

- `frontend/src/`: React UI; `App.tsx` contains the queue workspace and Task drawer.
- `frontend/src/useAnchoredPanel.ts`: viewport-aware dropdown/help positioning.
- `frontend/src/queueLayout.ts`, `Views.tsx`, `profile.ts`: layout, named views, persistence.
- `src/labtasker_webui/`: FastAPI BFF, upstream transport, sessions, local attachment, profile persistence.
- `tests/fixture_server.py`: synthetic upstream for browser/package tests.
- `frontend/e2e/`: Playwright interaction regressions; `tests/`: backend contracts.
- `.github/workflows/`: CI and gated PyPI publishing.

## Interaction contracts

- Preserve breadcrumbs and the compact, information-dense layout. Do not reintroduce a duplicate queue heading or large decorative spacing.
- Queue layout and named views are scoped by connection identity **and** queue. Never reintroduce a global columns fallback.
- Dropdowns and presets apply immediately. Text filters apply on Enter or leaving the input group; Apply is a fallback. Respect IME composition.
- Counts describe the same applied selectors as the list. Sorting preserves selection; changing the filter range clears it.
- Browser history restores queue, applied filters and drawer consistently. Partial selection uses the native checkbox `indeterminate` property.
- Resizing changes only the chosen column. Double-click fits content. Reordering preserves paths and uses a drop line, not a shaded target row.
- Every popup must fit the viewport, support scrolling and Escape/outside dismissal, and remain usable with keyboard navigation. Check Safari/WebKit focus behavior, not only Chromium.
- Missing custom JSON-path values stay blank. Negative priorities remain valid; positive/negative arrows use red/blue.
- Saved-view switching does not interrupt the user with an unsaved-changes prompt. Saving a view is explicit; normal profile saves stay quiet, failures offer recovery.

## Validation and delivery

- Run the ordinary gate in `.agents/sops/development.md`: frozen uv sync, version checks, Ruff format/lint, mypy, pytest, frontend tests/build, three-browser tests and artifact smoke verification. Run browser suites serially: fixtures and artifacts are shared.
- For UI behavior fixes, reproduce the failure, add or update a behavior-level regression, and test the actual built UI. Do not use sleeps or weaken assertions to hide a failure.
- Prefer existing components and tests over new dependencies. Do not mass-format unrelated files.
- Complete that gate before release preparation or broad infrastructure changes. `uv run python scripts/check_package.py` verifies an sdist-built wheel in a clean environment without Node.js.
- Follow [development](.agents/sops/development.md), [QA](.agents/sops/qa.md), and [release](.agents/sops/releasing.md) SOPs. Update affected docs when behavior changes.
- Report actual checks, failures/skips, and remaining limits. A local green run does not prove that GitHub Actions ran or that a package was published.

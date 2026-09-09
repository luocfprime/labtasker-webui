# QA SOP

## Data and environment

Browser tests use `tests/fixture_server.py` and an isolated `--no-profile` WebUI.
They must not inherit real endpoint/token configuration or mutate real workloads.
For live manual testing, use read-only access by default. Explicitly authorized dummy
Task changes are limited to `default`, using recognizable names/routes and exact IDs.
Never mutate any `lingbot` queue. Do not delete a whole queue to clean up test data.

## Commands

```sh
uv run pytest -m 'not integration'
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:e2e
```

Always rebuild the served assets before running browser tests. Do not rebuild while
backend or browser tests are running: Vite replaces the assets used by the editable
Python installation. For a focused run:

```sh
npm --prefix frontend run build
npm --prefix frontend run test:e2e -- --grep 'audit:' --project webkit
```

The standard suite covers Chromium, Firefox and WebKit. Keep fixtures and suites serial;
opening parallel Playwright runs can corrupt both data and diagnostic artifacts.
A read-only real-server contract test is opt-in:

```sh
LABTASKER_REAL_SERVER_URL=http://127.0.0.1:8000 uv run pytest -m integration tests/test_real_server.py
```

Set `LABTASKER_REAL_SERVER_TOKEN` through an existing secure mechanism if needed; never
paste it into committed scripts or captured shell output.

To check a sibling Labtasker source checkout, run the isolated BFF contract test:

```sh
uv run --with ../labtasker/packages/labtasker-server pytest -q -s -m integration tests/test_upstream_source.py
uv run --with-editable ../labtasker/packages/labtasker-server --with-editable ../labtasker/packages/labtasker-client pytest -q -s -m integration tests/test_upstream_source.py
```

These commands use temporary dependency overlays without changing the lockfile. The
first checks the locked Client against the source Server; the second uses both source
packages in editable mode. The test creates only a temporary database and synthetic Tasks/Workers,
using in-process ASGI transport without connecting to a running instance. It covers
pagination, filters, counts, observations, error forwarding and Task actions. The
normal suite excludes it; without an installed Server it skips.

## Interaction review matrix

| Area | Cases to verify |
| --- | --- |
| Layout | 1440×900 desktop, 900×600 short window, 390×700 narrow window; no document-level horizontal overflow |
| Popups | Every edge; resize while open; many options; long names; internal scrolling; Escape, outside click and Tab |
| Keyboard | Arrow keys/Home/End follow visible active option; Enter applies; IME Enter does not submit prematurely |
| Filters | Dropdowns/presets immediate; text blur/Enter; clear; invalid input and correction; status cards respect applied name/expression but ignore the Status selector; list totals include Status |
| Navigation | Queue → filter → drawer → back/forward; URL and visible state agree |
| Selection | Empty/partial/all checkbox; sorting retains selection; filtering clears selection; append keeps existing selection |
| Columns | Independent resize; double-click fit; drag order; missing JSON paths blank; path casing preserved; reload restoration |
| Views | Create/save/rename/copy/reset/delete; no Task deletion on view deletion; queue and connection isolation |
| Lists | Empty, one row, many rows; long names/routes; mixed statuses; signed priorities; virtualized scroll and retry |
| Drawer | Switch directly between rows, including during a pending or failed action; no cross-Task errors or disabled controls; close/focus restoration; keyboard access; narrow-screen sizing |
| Persistence | Restart/reload; failed save/retry; unsaved browser changes survive profile reload; large UTF-8 payloads; stalled saves time out; credentials never in UI responses |
| Batch deletion | Slow submission cannot duplicate; status-read failure can retry or close; failed stop stays visible; capacity never evicts active operations |
| Failures | Upstream timeout, invalid filter, authorization loss and slow reconnection without stale cached Tasks, failed append; useful recovery without false success |

For each reported defect, record trigger, expected behavior, actual behavior, and a
regression test. Do not replace a failing assertion with a wait unless there is an
observable asynchronous condition to wait for. Update stale selectors when the product
has intentionally changed, preserving the original behavior being tested.

## Evidence and completion

Failed browser tests retain traces/screenshots in `frontend/test-results/`; CI uploads
these as artifacts. Open a fixture trace from `frontend/` with:

```sh
npx playwright show-trace test-results/PATH/trace.zip
```

Never upload traces from authenticated real workloads without reviewing/redacting them.
A passing test suite only covers the listed scenarios. Report skipped integration tests,
untested platforms, and unresolved issues explicitly; do not claim the entire product
is defect-free. Distinguish a local verification from an actual GitHub Actions run.

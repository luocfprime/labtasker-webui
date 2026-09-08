# Development and debugging SOP

## Setup

Use Python 3.11+ and Node.js 22 (`.nvmrc`). From the repository root:

```sh
npm ci --prefix frontend
npm --prefix frontend run build
uv sync --group dev --frozen
uv run pre-commit install
cd frontend
npx playwright install chromium firefox webkit
cd ..
```

Install Playwright's OS dependencies on Linux with `npx playwright install --with-deps`
from `frontend/`. Do not reinstall or upgrade dependencies merely to fix a CSS rule
when the existing environment already works.

## Run and rebuild

```sh
uv run labtasker-webui --host 127.0.0.1 --port 8080
```

The CLI serves built `frontend/dist` assets. After frontend edits, run
`npm --prefix frontend run build` and refresh the browser. Python changes require a
WebUI restart. Confirm the working directory, command, PID and listening port before
stopping a process; restart only that WebUI process, never the connected Labtasker.
If a process is owned by another task or supervisor, use its normal restart mechanism.

For an isolated manual session, use another port and `--no-profile`. The default CLI
loads `.labtasker/` relative to its working directory, not the connected project's path.
The connection page controls HTTP/local mode. Keep the CLI limited to host, port and
profile persistence. Local attachment requires the Labtasker instance to be running.

## Change loop

1. Reproduce the issue with the current built UI or a focused backend test.
2. Identify state ownership, request parameters and event order before editing.
3. Add a regression for the user-visible failure. Use synthetic data for mutations.
4. Make the smallest coherent change and run the relevant checks below.
5. For broad changes, run the full ordinary gate; update docs and report actual results.

Do not run multiple Playwright commands concurrently: port ownership, mutable fixture
state and trace output are shared. Playwright intentionally fails on occupied test
ports rather than silently using an unknown server. Ports are 18765 (fixture upstream)
and 18766 (isolated WebUI). Diagnose their owner; do not use `pkill` or blanket cleanup.

## Troubleshooting

| Symptom | Inspect first | Recovery |
| --- | --- | --- |
| UI still looks unchanged | Build success, loaded asset filename, served working directory | Rebuild assets and reload |
| Backend change has no effect | Running WebUI command and process | Restart that WebUI only |
| Connection fails | HTTP scheme, upstream health, server logs, local socket availability | Correct the connection; do not expose the token |
| Invalid filter | Inline error and API response | Correct the expression; invalid requests must not retry endlessly |
| Profile cannot save | Directory permissions, disk capacity, `Retry` notification | Restore write access and retry; pending browser changes must survive reload |
| Browser test fails before starting | Occupied fixture ports or missing browsers | Resolve the owner/install browsers, then rerun one suite |
| Popup is clipped | Viewport size, fixed positioning, scroll container, focus events | Reproduce with the boundary/keyboard QA matrix |

Never dump `.zshrc`, all environment variables, `.labtasker/`, cookies or request
headers into logs. Inspect only the specific configuration needed and redact credentials.

## Dependency changes

Commit npm manifest and lockfile together; use `npm ci` elsewhere. Use `uv lock` to
regenerate the Python lockfile and `uv sync --group dev --frozen` for ordinary installs.
Do not edit lockfile records manually. CI uses the same lock across its Python matrix.
Keep Actions pinned to commit SHAs and let Dependabot propose uv/npm/Action updates.
Review migration notes and rerun affected checks.

## Ordinary validation gate

Run from the repository root. The project is a single distribution, so unlike the
Labtasker workspace it does not need `--all-packages`.

```sh
uv sync --group dev --frozen
uv run python scripts/check_versions.py
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run mypy
uv run pytest -m 'not integration'
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:e2e
uv run python scripts/check_package.py
```

The last command runs `uv build --sdist`, builds its wheel from that archive, validates
metadata and smoke-tests a clean installation. It does not publish. For routine docs-only
changes, validate local links and applicable examples rather than rerunning unrelated
runtime tests. The local pre-commit hooks check whitespace/YAML/large files and run Ruff,
matching the Labtasker series. CI remains the authoritative full gate.

## Agent workflows

Start with root `AGENTS.md`. Focused instructions live in `.agents/skills/ui-change/`
and `.agents/skills/release/`; use them only for relevant work. Keep lasting product
decisions in `docs/reference/specification.md`, not in throwaway plans.

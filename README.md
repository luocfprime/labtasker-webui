# Labtasker WebUI

A light, observation-first WebUI for an existing Labtasker v2 Server. It shows
Queue progress, supports server-side Task filtering and scroll-to-load browsing, and
provides a complete Task inspection drawer. It never submits or edits Tasks.

The Task list fetches the next cursor batch as you approach the bottom, keeps
loaded rows and selections, and shows a retry action if loading more fails.
Only visible rows are rendered. Drag a column boundary to resize it; widths are
remembered in this browser, and double-click restores a default width. List dates
use local `MM-DD HH:mm` with full timestamps in tooltips and the Task drawer.
While reading older rows, background refresh does not reorder the list. Returning to the top resumes live
refresh; the Refresh button can also update the list explicitly.

Allowed controls are deliberately limited to cancel, requeue, and permanent
deletion. Filtered deletion first resolves an immutable snapshot of at most
1,000 Task IDs and then reports each non-atomic result.

## Run

The published package is designed to run without Node.js:

```bash
uvx labtasker-webui
```

Then open <http://127.0.0.1:8080> and enter the Labtasker Server URL and optional
Bearer token. Local launches remember the connection and UI settings in
`.labtasker/webui-profile.json` (see Project profiles below). Credentials remain
on the backend; the browser uses an opaque `HttpOnly`, `SameSite=Strict` cookie.
With `--no-profile`, interactive sessions expire after 12 hours of inactivity
or a process restart.

Choose **HTTP Server** or **Local project** on the connection page. Addresses,
project directories and tokens are configured in the WebUI, not CLI arguments.

## Configuration

| CLI | Environment | Default |
| --- | --- | --- |
| `--host` | `LABTASKER_WEBUI_HOST` | `127.0.0.1` |
| `--port` | `LABTASKER_WEBUI_PORT` | `8080` |
| `--no-profile` | — | persistence enabled on loopback |

Non-loopback deployments require the comma-separated
`LABTASKER_WEBUI_ALLOWED_SERVER_ORIGINS` environment variable. For example:

```bash
LABTASKER_WEBUI_ALLOWED_SERVER_ORIGINS=https://tasks.example labtasker-webui --host 0.0.0.0
```

Changing `--host` expands the trust boundary. Labtasker WebUI has no user,
role, or authorization system of its own. For laboratory-network deployment,
restrict network access and put authentication/TLS at a trusted reverse proxy.
The BFF revalidates upstream origins and every redirect, uses HTTPX's default
environment proxy settings, and never returns the configured token to the browser.

## Development

```bash
npm --prefix frontend install
npm --prefix frontend run build
python -m venv .venv
.venv/bin/pip install -e '.[test,dev,release]'
.venv/bin/labtasker-webui
```

Checks:

```bash
npm --prefix frontend test
npm --prefix frontend run build
.venv/bin/pytest
.venv/bin/python -m build
.venv/bin/python -m twine check --strict dist/*
.venv/bin/python tests/packaging_smoke.py dist/labtasker_webui-*.whl
```

Browser workflow coverage uses Playwright and its three desktop engines:

```bash
npx --prefix frontend playwright install chromium firefox webkit
npm --prefix frontend run test:e2e
```

An opt-in, read-only contract smoke test can target a separately running real
Labtasker v2 Server:

```bash
LABTASKER_REAL_SERVER_URL=http://127.0.0.1:8000 \
  .venv/bin/pytest -m integration tests/test_real_server.py
```

Set `LABTASKER_REAL_SERVER_TOKEN` as well when that Server requires a Bearer
token. The default test suite skips this external integration test.

The Vite build is bundled into the Python wheel. Node.js is only a development
and package-build dependency. The project does not publish a Docker image.


## CI and dependency updates

GitHub Actions runs frontend tests and builds, Ruff and mypy, Python tests on
3.11–3.14, and Playwright on Chromium, Firefox, and WebKit for pushes and pull
requests. CI builds both the source distribution and wheel, checks their metadata,
and installs the wheel into a clean environment for a startup smoke test without
Node.js. Failed browser tests retain screenshots and traces as artifacts.

Dependabot checks npm, Python, and GitHub Actions dependencies weekly. Compatible
npm/Python updates are grouped; updates require review and passing CI.

## PyPI releases

The `Publish to PyPI` workflow runs when a GitHub Release is published. Its tag
must match the version in `pyproject.toml` (for example, `v0.1.0`). It runs the full
CI workflow and publishes the verified wheel and source distribution only after
all checks pass.

Before the first release:

1. Create the GitHub repository environment named `pypi`.
2. Configure a [PyPI Trusted Publisher](https://docs.pypi.org/trusted-publishers/adding-a-publisher/)
   for `labtasker-webui` with your GitHub owner and repository, workflow filename
   `release.yml`, and environment `pypi`. For a new package, use a pending publisher.
3. Update the package version, push the corresponding `vVERSION` tag, and publish
   its GitHub Release.

Authentication uses GitHub OIDC; no PyPI API token is stored in GitHub secrets.
Running CI manually builds downloadable distributions without publishing them.

## Project profiles and saved filters

When bound to localhost, the CLI automatically uses
`.labtasker/webui-profile.json` in its working directory. A successful connection
saves the Server URL and writes the token separately to `.labtasker/webui-token`;
restarting WebUI restores the connection automatically.
The profile also saves visible/custom columns, column order and widths, drawer
width, last Queue, per-Queue applied filters/sort settings, and named filter
presets. Open the filter help menu to select a common preset or save your current
expression under a name. Selecting a preset fills the input; Apply runs it.

The profile is separate from Labtasker's `.labtasker/config.toml`, is ignored by
Git, and is atomically written with owner-only file permissions (`0600`). The separate token file also uses `0600` permissions. Tokens
are stored in plaintext in that protected local file and are never returned by
the profile API or stored in browser storage. Disconnect removes the remembered
connection while keeping UI preferences. `--no-profile` disables persistence; profiles are
disabled for non-loopback binds. Browser-local settings are used as a fallback
when persistence is disabled, and are imported on the first profile-enabled run.

### Attach to a local instance

Run `labtasker-webui`, select **Local project** on the connection page, and enter
the project directory (`.` means the WebUI process working directory).

The instance must already be running. WebUI only resolves the canonical project
path and attaches to its Unix socket; it never starts, stops, or restarts Labtasker,
and never opens the database. Local attachment requires POSIX and a loopback bind.
It uses no token. The selected connection and data views are remembered in the
WebUI working directory's `.labtasker/`, independently of the connected project's
own Labtasker configuration. The socket discovery adapter uses Labtasker Client
2.x; the regular API v2 compatibility check still applies.

### Named data views

The view selector beside the breadcrumbs manages reusable data views separately
from connection credentials. Each view captures applied filters, sorting, visible
columns, custom JSON paths, column order, and widths. Views are scoped to a Server
(or local project) and Queue. The selector ends with **+ Create view**. A small dot
marks unsaved changes and a **Save** button updates the selected view. The actions
menu contains **Save as…**, **Rename**, **Reset changes**, and **Delete**. Naming
opens a focused dialog; deleting asks for confirmation and never deletes Tasks.
Changing the working layout never silently overwrites a saved view.
Deleting a view leaves Tasks and the current working layout intact. Named views
are persisted in `webui-profile.json`; credentials remain separate from view data.
The connection header explicitly labels HTTP or Local and shows the corresponding
Server address or canonical project directory, with the full value on hover.

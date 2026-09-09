# Labtasker WebUI

Labtasker WebUI connects to an existing [Labtasker](https://github.com/luocfprime/labtasker)
v2 Server or local project.
It brings Queue progress, Task details, and structured results into one compact
workspace, with reusable views for different experiments.

[![Labtasker WebUI showing Queue progress, filters, and custom Task columns](https://raw.githubusercontent.com/luocfprime/labtasker-webui/main/assets/screenshot.png)](https://raw.githubusercontent.com/luocfprime/labtasker-webui/main/assets/screenshot.png)

The key features are:

- **Queue progress at a glance:** Track pending, running, succeeded, failed, and
  cancelled Tasks. Status counts follow the applied Task name and advanced filter, across all statuses; the Status selector narrows only the Task list and its total.
- **Routes and Workers:** Collapse route navigation when you need more table space.
  Inspect Idle/Busy Worker counts and last-seen reports; include inactive routes when
  reviewing historical work. These features require Server 2.2 or later; Worker
  reports require Workers that support observations.
- **Flexible result exploration:** Filter Task fields and nested values, or add
  custom columns such as `args.test_num` and `result.succ_rate`. Resize, reorder,
  and double-click columns to fit their contents.
- **Reusable data views:** Save filters, sorting, and column layouts for each
  connection and Queue. Switch views without rebuilding the table each time.
- **Complete Task inspection:** Open a Task to inspect its arguments, metadata,
  execution timeline, errors, and results. Cancel, requeue, or delete selected
  Tasks through explicit controls.
- **Easy local use:** Launch from Python without Node.js. Remember connections
  and UI preferences in the WebUI working directory's `.labtasker/` folder.

## Installation

Labtasker WebUI requires Python 3.11 or newer. Run it with `uv`:

```bash
uvx labtasker-webui
```

Or install and run it with pip:

```bash
python -m pip install labtasker-webui
labtasker-webui
```

Open <http://127.0.0.1:8080> to connect. The Python package includes the built
frontend; Node.js is only needed for development and building the package.

## Example

Choose a connection type on the connection page:

- **HTTP Server:** Enter a Server URL starting with `http://` or `https://`, plus
  a Bearer token if the Server requires one.
- **Local project:** Enter the directory of an already-running Labtasker project.
  `.` refers to the WebUI process's working directory. Local attachment uses the
  project's Unix socket and requires POSIX and a loopback bind.

If a business response reports a Server older than the installed Labtasker Client,
WebUI displays a dismissible upgrade warning. It adds no version-check request
and does not block browsing or actions. Servers that omit their version do not
trigger the warning. Reloading or reconnecting resets dismissal.

Open a Queue, then filter its Tasks:

```python
status in ["pending", "running"]
```

Add a custom column through **Columns**, using a JSON path:

```text
args.test_num
result.succ_rate
```

Missing values stay blank. Dropdowns and filter presets apply immediately;
text filters apply on Enter or when leaving the input group. **Apply** remains
available as a fallback.

Use **+ Create view** beside the breadcrumbs to save the current filters,
sorting, and columns. A dot marks changes to the selected view; **Save** updates
it. The actions menu provides **Save as…**, **Rename**, **Reset changes**, and
**Delete**. Deleting a view leaves Tasks and the current layout intact.

The list loads more Tasks as you scroll and preserves existing selections.
While reading older rows, background refresh does not reorder the list.
Returning to the top resumes live refresh; **Refresh** updates it explicitly.
Click a Task to open its details. Dates use local time, with full timestamps
available on hover.

## Project profiles

On loopback binds, the WebUI remembers settings in its working directory:

| File | Contents |
| --- | --- |
| `.labtasker/webui-profile.json` | Connection, columns, views, filters, and UI preferences |
| `.labtasker/webui-token` | Bearer token, stored separately with owner-only permissions |

Both files use `0600` permissions. The token is plaintext in its protected local
file; it is never returned by the profile API or stored in browser storage.
The browser uses an opaque `HttpOnly`, `SameSite=Strict` session cookie.

Profiles are separate from Labtasker's `.labtasker/config.toml`. Named views and
column layouts are scoped to the connection and Queue. Disconnecting removes
the remembered connection while retaining UI preferences.

Use `--no-profile` to disable disk persistence. Browser-local settings remain
available; interactive connections then expire after 12 hours of inactivity or
a WebUI restart. Profiles are disabled for non-loopback binds.

## Configuration

Connection addresses, project directories, and tokens are configured in the UI.
The CLI only controls how the WebUI itself runs:

| CLI | Environment | Default |
| --- | --- | --- |
| `--host` | `LABTASKER_WEBUI_HOST` | `127.0.0.1` |
| `--port` | `LABTASKER_WEBUI_PORT` | `8080` |
| `--no-profile` | — | Persistence enabled on loopback |

Non-loopback deployments require an explicit allowlist of upstream origins:

```bash
LABTASKER_WEBUI_ALLOWED_SERVER_ORIGINS=https://tasks.example labtasker-webui --host 0.0.0.0
```

Separate multiple origins with commas. The WebUI has no user or role system;
restrict network access and use authentication/TLS at a trusted reverse proxy
for shared deployments. The backend validates upstream origins and redirects,
uses HTTPX's environment proxy settings, and keeps credentials out of browser
responses.

## Scope

Labtasker WebUI inspects existing workloads and supports cancellation, requeue,
and permanent deletion of explicitly selected Task IDs. Batch deletion reports
each result; it is not an atomic operation.

Use the Labtasker Client, CLI, or Workers to submit and execute Tasks. The WebUI
does not submit or edit Tasks, schedule work, allocate resources, or manage the
Labtasker process. Local mode only attaches to an existing instance and never
opens its database.

## Documentation

- [Specification](https://github.com/luocfprime/labtasker-webui/blob/main/docs/reference/specification.md): product behavior and state ownership.
- [Contributing](https://github.com/luocfprime/labtasker-webui/blob/main/CONTRIBUTING.md): setup and development conventions.
- [Agent guide](https://github.com/luocfprime/labtasker-webui/blob/main/AGENTS.md): project boundaries and internal workflow entry points.
- [Labtasker documentation](https://luocfprime.github.io/labtasker/): Tasks,
  Queues, Workers, and the upstream API.

## Development

```bash
npm ci --prefix frontend
npm --prefix frontend run build
uv sync --group dev --frozen
uv run labtasker-webui
```

See [Contributing](https://github.com/luocfprime/labtasker-webui/blob/main/CONTRIBUTING.md) for the validation gate and development, QA,
and release SOPs. CI covers Python checks, frontend tests, three browser engines,
and installation of the built package without Node.js.

## License

[Apache-2.0](https://github.com/luocfprime/labtasker-webui/blob/main/LICENSE), matching Labtasker.

### Search Task names

The Task name input supports case-insensitive subsequence search: `tr ev` or
`ev tr` finds `train_model_eval`. Every whitespace-separated word must match.
Press Enter or leave the input to apply; clearing it removes the name restriction.
For a strict name match, use `name == "train_model_eval"` in Advanced filter.
The Server applies the same search to the Task list and counts across the Queue,
with the existing sorting preserved. This requires a Server supporting
`name_fuzzy`; saved Task name inputs also use fuzzy matching.

# WebUI specification

```text
Browser (React, Query, Table)
  -> same-origin /api/webui/* (FastAPI BFF)
     -> HTTP Labtasker v2 Server, or existing project's Unix socket
```

The BFF owns upstream credentials, session cookies, origin validation and destructive
operation snapshots. The UI observes Tasks and supports cancel, requeue and selected-ID
deletion; it does not submit/edit Tasks. Local attachment discovers and uses the existing
socket without managing the Labtasker process or opening its database.

## Server version warnings

The BFF observes `Labtasker-Server-Version` on ordinary upstream `/api/`
responses, including errors and empty successes, for both HTTP and local
connections. Existing connection verification stays unchanged; version warnings
add no upstream requests. Health/schema responses are not version observations.

On a BFF response that observed an upstream business response, it sends
`Labtasker-Client-Version` (the installed `labtasker-client` version),
`Labtasker-Server-Version` (normalized PEP 440 version, or an empty value when
unknown), and `Labtasker-Server-Upgrade-Recommended` (`true` or `false`). Missing,
invalid, or longer-than-128-character upstream versions are unknown. Comparison
uses PEP 440 ordering, including patch and prerelease differences; the WebUI's
independent package version is not compared to the Server. Version observations
are request-local and must not leak across sessions or credentials. No tokens
are added to these headers; upstream payloads and errors remain unchanged.

The browser displays a compact, nonblocking, dismissible warning above the
workspace when the Server is older. It recommends upgrading to the Client version
or later without claiming that a particular operation is incompatible. Repeated
responses for a dismissed version pair do not redisplay it. A different older
version pair can warn again; an equal, newer, or unknown observation clears the
visible warning. Responses without an upstream observation leave it unchanged.
Observations and dismissal are memory-only and reset on reload/reconnection.
Neither credentials nor version observations are written to the profile.

## State

| State | Owner and persistence |
| --- | --- |
| Connection URL/local project | Backend profile in WebUI working directory |
| Bearer token | Backend only; separate owner-only `webui-token` file |
| Queue, applied selectors, drawer Task ID | URL/history plus React state |
| Current working column layout | Connection + queue scope; browser and profile |
| Named data view | Explicit snapshot scoped to connection + queue |
| Task selection | Current workspace memory; exact Task IDs |
| Pending profile write | Browser recovery record until the backend acknowledges saving |
| Task data and counts | Query cache keyed by connection lifecycle, queue and applied selectors |

A profile contains a map of UI settings; it is not itself a named data view. Views capture
filters, sort order, visible/custom columns, order and widths. Layout edits do not mutate
a named view until Save. The backend UI-key allowlist must remain consistent with frontend
persistence keys; internal browser recovery keys must never enter profile API payloads.

Backend profile writes use atomic replacement and restrictive permissions. Failed writes
must not be reported as persisted by a subsequent API read. Browser pending writes are
retained across reload and merged before restoring older disk settings. Successful writes
acknowledge only values actually sent, preserving newer edits queued during the request.
Saves time out after 10 seconds and remain recoverable. Payloads above 60 KiB use normal
fetch instead of the browser-limited keepalive transport; interrupted writes stay in the
browser recovery record.

Successful login clears query caches and reloads connection status before rebuilding
the workspace. A new session must never expose the previous connection's cached Tasks,
including when reauthenticating with another Server or token.

## Rendering and interaction

The table uses cursor loading plus row virtualization. Status card counts cover all Tasks
matching the applied Task name and advanced filter, ignoring the Status selector.
Explicit status conditions inside the advanced filter remain effective. Selecting a
Status changes the highlighted card, Task list and list total without narrowing the
other cards. List totals include all applied selectors, not just loaded rows.
Scrolling older rows pauses list polling to avoid reordering
what the user is reading. Refresh explicitly returns to the top and refreshes data/counts.
Resizing uses per-column widths and a filler for remaining space. JSON paths are read-only
lookups; missing fields are blank.

The Task name input uses the upstream `name_fuzzy` selector: case-insensitive
Unicode subsequences, split on whitespace, with every word required and word
order unrestricted. Empty or whitespace-only searches add no restriction.
Punctuation is literal; no fzf extended operators or relevance sorting are added.
Text applies on Enter or blur, respecting IME composition. Exact lookup remains
available as `name == "..."` in Advanced filter. The URL and saved-view `name`
field store this input; previously saved name inputs now use fuzzy matching.

The BFF forwards `name_fuzzy` on list, count, and deletion-snapshot requests to
the Server. It does not filter loaded Tasks in the browser. Status cards ignore
the Status dropdown but retain name search and advanced filter; list totals use
all applied selectors. The existing selected-ID deletion UI is unchanged.
The snapshot endpoint requires at least one effective selector; whitespace-only
fuzzy input alone is insufficient. The upstream Server must support `name_fuzzy`;
there is no browser-only matching fallback.

Advanced filter help provides ten built-in examples covering routes, status, priority,
attempts, errors and custom fields. Route examples use exact-name array membership
(`"gpu-a100" in routes` and `"gpu-a100" not in routes`); combine checks with
`or` for any route or `and` for all. Selecting an example applies it immediately
alongside the status and Task name selectors.

Shared popup positioning clamps to the viewport and chooses above/below placement.
Keep focus inside menus during internal interactions; Safari can emit a blur with no
related target before a pointer click completes. Permanent request errors such as invalid
filters should appear immediately; only transient failures should retry.
Task action errors and pending indicators belong to the selected Task. Switching Tasks
resets those indicators without cancelling the previous action; its eventual response
invalidates the original Task cache, not the newly selected Task. Pending actions remain
tracked per Task across switching away and back, so returning cannot submit a duplicate.

## Build boundary

Vite produces `frontend/dist`. Hatch includes those assets in the wheel and sdist; the
installed wheel serves them without Node.js. A successful TypeScript build alone does not
prove packaging works. See [release verification](../../.agents/sops/releasing.md) for the separate artifact test.

## Batch deletion recovery

Starting, retrying failed Tasks and stopping a batch each disable conflicting actions
while their request is pending. A failed progress read offers Retry status without
submitting another deletion, and allows returning to the list with an explicit notice
that the operation may still run. Stop failures remain visible. Closing the dialog
stops its polling; it does not cancel an operation already accepted by the backend.

The bounded operation store evicts completed records only. When all slots are active,
new operations receive a retryable capacity error; running operations remain queryable
and stoppable until completion.

## Routes and Worker observations

Each Queue has Tasks and Workers tabs and a collapsible Routes sidebar. The sidebar
combines grouped pending/running Task routes with active Worker routes. Routes with
only terminal Tasks and no active Workers appear when Include inactive routes is on.
All group pages must load before absence is treated as zero. Unsupported or failed
observation requests remain explicit; they never imply that there are zero Workers.
Existing Task browsing remains available on Servers without grouped counts.

Selecting a route intersects the Task filter with membership in `routes`, including
status counts, and filters Workers by `route`. Route and tab navigation use browser
history; named views include the selected route. Sidebar preferences belong to the
connection and Queue. Task summary controls use colored numbers followed by status
words on one line; they retain their status-filter toggle behavior.

Worker state counts use grouped observations, independently of the paginated Worker
list. Observations describe reports, not Task ownership or execution guarantees.
Normal rows show last seen. Only after more than two 60-second reporting cycles
without a report does the row show delayed-update and expiry information. Expiry
uses the Server's `expires_at`; UI polling does not define the reporting interval.
Failed list refreshes suppress expiry warnings and expose update/retry information.
Worker IDs, routes and times retain full-value hover tooltips; associated Tasks open
the existing detail drawer.

Change opens connection settings without discarding the current workspace. Back to
workspace restores it; a successful connection change clears the query cache.

The compact Task summary begins with All, the sum across the five mutually exclusive
statuses under the applied name, expression and route filters. Selecting All clears
only the Status selector. Task and Worker summary controls use a quiet rounded
selection fill. Worker Idle counts are green and Busy counts are blue. Worker status
selection uses the same styled, keyboard-accessible control as Task filters.

The workspace uses a white surface, medium-weight linked Task names, colored status
labels and row separators, without nested toolbar/table frames. Route collapse has
an explicit button and a 140 ms layout transition, disabled for reduced motion.
Route dots in the sidebar and Task/Worker tables describe current route observations:
blue for Busy Workers, green for Idle Workers, amber for pending/running Tasks without
active Workers, gray for inactive routes, and a hollow gray dot when counts are unknown.
Busy takes precedence over Idle when both are present. A route dot does not describe
the individual Task's status; each Task keeps its own separate status label.

The Routes divider supports pointer dragging and Left/Right keyboard adjustments.
Width is stored per connection and Queue, including across collapse and reload.
The sidebar is bounded to 160–480 px and at most 40% of the viewport. Dragging has
no layout animation; collapse keeps its short transition. On narrow screens the
Routes section stacks above content and its horizontal resize handle is hidden.

Task-name search has a 240 px preferred width and expands to its grid cell on narrow
screens. The Routes toggle stays beside the breadcrumb in both sidebar states. The sidebar
starts directly with All routes, aligned with the 36 px Task/Worker tab row; there
is no separate sidebar title or collapse button in the tab row. Selected status
summaries use a pale version of their status color with matching label text; All uses
neutral charcoal and a pale gray background. Typography uses 13 px controls, 12 px summary labels and 24 px count numerals.

Queue overview cards use a compact layout capped at 460 px, with the Queue name,
total Task count, colored status counts, and a thin proportional status distribution
bar. Status controls retain navigation to the selected status and wrap on narrow
screens. They have padded hover targets and offset keyboard focus outlines. The
cards show completed/total Tasks and completion percentage below the bar, and compact
Worker and Route summaries in the footer. Status numbers use five aligned columns.
Route counts are distinct routes, classified Busy before Idle before Waiting; Waiting
means pending/running Task demand without active Workers. Inactive routes are omitted. Worker counts come from paginated Worker
groups, refreshed every 15 seconds; loading or unavailable observations never display
as zero. Completion includes succeeded, failed and cancelled Tasks. Failure rate and
recent Task details are omitted; individual Tasks remain available inside the Queue.

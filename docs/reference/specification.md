# WebUI specification

```text
Browser (React, Query, Table)
  -> same-origin /api/webui/* (FastAPI BFF)
     -> HTTP Labtasker v2 Server, or existing project's Unix socket
```

The BFF owns upstream credentials, session cookies, origin validation and destructive
operation snapshots. The UI observes Tasks and supports cancel, requeue, selected-ID
deletion and selected-ID priority updates; it does not submit Tasks or edit other Task
fields. Local attachment discovers and uses the existing
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
| Current Task column layout and Worker column widths | Connection + queue scope; browser and profile |
| Named data view | Explicit snapshot scoped to connection + queue |
| Task selection | Current workspace memory; exact Task IDs |
| Pending profile write | Browser recovery record until the backend acknowledges saving |
| Task data and counts | Query cache keyed by connection lifecycle, queue and applied selectors |

A profile contains a map of UI settings; it is not itself a named data view. Views capture
filters, sort order, visible/custom columns, order and widths. Layout edits do not mutate
a named view until Save. The backend UI-key allowlist must remain consistent with frontend
persistence keys; internal browser recovery keys must never enter profile API payloads.
Saved-view change detection compares setting values rather than object key order.
Older views without a route field are equivalent to an empty route selection, so
applying or resetting them does not falsely report unsaved changes.

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
Task selection survives sorting, including browser Back/Forward through sort changes.
Applying or resetting a saved view also preserves selection when only sorting or
column layout changes.
Changing the filter range clears selection, including through browser history.
The selection column remains pinned while the Task table scrolls horizontally.
An explicit Task selection exposes Cancel Tasks, Requeue Tasks, Delete Tasks and Set
priority actions. Clear selection only removes the current checkmarks. Each lifecycle
action is enabled only when every selected Task has a compatible status, using the same
rules as the Task drawer: Cancel accepts pending/running, Requeue accepts
pending/failed/cancelled, while Delete and priority updates reject running. Priority
accepts any JavaScript-safe integer, including zero and negative values. Disabled actions
explain the required and incompatible statuses on hover or keyboard focus. Batch Cancel,
Requeue and priority updates retain failed Task IDs for retry while clearing successful
IDs from the selection.
Resizing uses per-column widths and a filler for remaining space. JSON paths are read-only
lookups; missing fields are blank.

Default Task column widths are Status 117 px, Progress 88 px, Attempt 83 px,
Priority 79 px, Created and Updated 103 px, and Duration 86 px. Saved widths
continue to override these defaults within their connection and Queue scope.
Progress can be resized down to 56 px, and this minimum width survives reload.

The built-in Progress column is 88 px wide by default and centered. It retains
the table's column-resizing behavior. Non-running Task rows leave it blank. A
running Task shows a 14 px circular progress indicator only
when its `progress` object contains finite numeric `completed` and `total`
values with `0 <= completed <= total` and `total > 0`. The accessible value and
popover show the floor of `completed / total * 100`, correcting floating-point
roundoff at integer boundaries (29 of 100 shows 29%). Incomplete progress never
shows 100%. The compact ring has no
center text, follows the primary UI color and transitions over 250 ms. Other
running Tasks show `—`, including Tasks without progress, incomplete display fields
and values above the declared total. The column is not sortable. It follows the
existing Task-list polling and pause rules rather than creating another refresh
loop. The Status column has a 104 px minimum so every status badge remains fully
visible, including when an older saved layout requested a narrower width.

Hovering or focusing the ring opens a viewport-contained summary with the exact
completed and total values, current execution Duration, ETA, progress attempt,
Server report time and a compact JSON tree of the reported object. The tree
reuses the Task drawer's nested rendering, expands its first two levels, omits
raw and per-node copy controls, provides one visible whole-object Copy action,
keeps the root disclosure inset from both edges, and scrolls within a bounded height. Clicking pins
the summary as a non-modal dialog so its tree can be operated until an outside
interaction or Escape. Clicking inside the summary does not open the Task
drawer. Escape works from the summary's contents and returns focus to the ring.

ETA is summary-only derived UI state: it adds no column, Task field, JSON value,
filter, sort key, custom path, profile setting or saved-view state. A finite
nonnegative numeric `progress.eta` is interpreted as seconds remaining at
`progress_updated_at`; an ISO timestamp string is interpreted as the estimated
finish time. Either valid reported form takes precedence and remains ordinary
Worker-reported JSON, so `progress.eta` stays visible in the tree and available
to upstream `progress.*` filtering. An invalid or absent reported ETA falls back
to linear extrapolation only when the current attempt has valid timestamps and
`0 < completed < total`: the average rate uses
`progress_updated_at - started_at`, never the current browser time. The resulting
finish time is anchored at `progress_updated_at`; the browser clock only counts
down from that fixed estimate while the summary is open. Derived values are
coarsened to minute-scale display and marked approximate. Zero completion shows
Calculating, completed equal to total shows Finishing, a passed estimate shows
Overdue, and invalid inputs show an em dash.

Task row keyboard navigation only handles keys on the row itself; Space on its
checkbox toggles selection without opening details. Apart from the display
conventions for `completed`, `total` and `eta`, the UI assigns no meaning to other
progress keys. Task details show a
Progress JSON section immediately before Result whenever progress is non-null,
including for terminal Tasks whose last snapshot was retained. Its heading
shows the Server-owned attempt and report time. Null progress adds no details
section.

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

View actions closes when keyboard focus leaves the view controls or moves to the
Data view picker, so its menu cannot remain open behind that picker. Shift+Tab from
the first menu item closes the menu and returns focus to the View actions trigger.
Shared popup positioning clamps to the viewport and chooses above/below placement.
Escape dismisses a selector from both its trigger and its optional action button,
returning focus to the trigger. Tab and Shift+Tab move between the trigger and its
action; Tab from the action leaves and dismisses the menu.
Selector letter navigation ignores Ctrl, Meta and Alt combinations so browser
shortcuts keep their normal behavior.
Keep focus inside menus during internal interactions; Safari can emit a blur with no
related target before a pointer click completes. Permanent request errors such as invalid
filters should appear immediately; only transient failures should retry.
Task action errors and pending indicators belong to the selected Task. Switching Tasks
resets those indicators without cancelling the previous action; its eventual response
invalidates the original Task cache, not the newly selected Task. Pending actions remain
tracked per Task across switching away and back, so returning cannot submit a duplicate.
Outside interactions dismiss the drawer by synchronously removing its Task from the
current history entry, allowing a clicked filter or navigation control to update history
without racing a Back operation. Focus stays with the outside control. The close button
and Escape retain normal drawer history navigation and restore the originating Task focus.

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

Observation request failures appear as bottom-right notifications, outside the Routes
layout. Identical messages share one notification listing the affected observations;
Retry retries all affected active requests. Dismiss (or Escape while focused) keeps
that message quiet for the current Queue workspace, including refreshes and tab
switches. Successful requests clear their notification. Unavailable counts and Worker
observations remain marked in place after dismissal; Refresh remains available.
Corner notifications share a vertical stack with settings-save failures and transient
feedback, so recovery controls do not overlap. Notification actions leave the Task
drawer and its URL open. Modal dialogs remain above the notification stack.
Each new transient operation message receives a fresh five-second display duration;
an older timer cannot hide it early. Long column paths wrap within the viewport.
A notification stays visible while its Retry is pending. Pending retries belong to
active request identities: changing the Worker filter or tab hides inactive requests
and cannot disable a new filter's Retry, even when the error text matches. Escape
from a focused notification dismisses that notification without closing the Task
drawer; Escape from the drawer still closes the drawer. Worker append failures use
only the list's Retry loading control, which retries the failed cursor instead of
refreshing already-loaded pages.

Each Queue has Tasks and Workers tabs and a collapsible Routes sidebar. The sidebar
combines grouped pending/running Task routes with active Worker routes. Routes with
only terminal Tasks and no active Workers appear when Include inactive routes is on.
All group pages must load before absence is treated as zero. Unsupported or failed
observation requests remain explicit; they never imply that there are zero Workers.
A route is labeled Inactive only when both Task and Worker observations are available.
If Task observations fail, a known absence of Workers is labeled No active Workers
without inferring current Task demand from stale counts.
Existing Task browsing remains available on Servers without grouped counts.

Selecting a route intersects the Task filter with membership in `routes`, including
status counts, and filters Workers by `route`. Route and tab navigation use browser
history; named views include the selected route. Sidebar preferences belong to the
connection and Queue. Task summary controls use colored numbers followed by status
words on one line; they retain their status-filter toggle behavior.
Selecting the current tab or Worker status does not add a duplicate history entry
when the resulting URL is unchanged.

Worker state counts use grouped observations, independently of the paginated Worker
list. Observations describe reports, not Task ownership or execution guarantees.
Normal rows show last seen. Only after more than two 60-second reporting cycles
without a report does the row show delayed-update and expiry information. Expiry
uses the Server's `expires_at`; UI polling does not define the reporting interval.
Delayed-update and expiry messages wrap within their cell so narrow columns do not
hide the remaining time.
Failed list refreshes suppress expiry warnings and expose update/retry information.
Worker IDs, routes and times retain full-value hover tooltips; associated Tasks open
the existing detail drawer.
Switching between associated Task links keeps the drawer open. Explicitly closing it
restores focus to the most recently opened Worker Task link.
Worker, Status, Route, Task and Last seen columns have independent resize handles. Their
default widths are 240, 100, 200, 240 and 210 px respectively. Pointer dragging and
Left/Right keyboard adjustment change only the chosen column; double-click fits that
column to loaded content. Widths persist per connection and Queue.

Change opens connection settings without discarding the current workspace. Back to
workspace restores it; a successful connection change clears the query cache.
Back to workspace is disabled while a connection change is pending. If the change
fails, returning to the previous workspace becomes available again.

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

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

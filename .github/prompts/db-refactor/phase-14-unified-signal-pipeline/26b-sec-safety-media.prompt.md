---
description: "Phase-14 — Rewire security + safety + media endpoints → signal_log"
---
# Prompt 26b — Security + Safety + Media Endpoints → signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-26b-sec-safety-media.log` |
| Allowed files to change | `internal/api/security_handler.go`, `internal/api/safety_handler.go`, `internal/api/media_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (SnapshotAt), 23 (SignalTracePivot)

## Exactly 3 handlers, 6 endpoints

### 1. Security Handler

| Endpoint | Old | New |
|---|---|---|
| `GET /security` (history) | `FROM security_snapshots` | `SignalTracePivotFlat` |
| `GET /security/latest` | Latest snapshot row | `SnapshotAt(now)` |

Signal mappings:
```go
var securityMappings = []database.SignalMapping{
    {Signal: "Locked", Field: "locked"},
    {Signal: "SentryMode", Field: "sentry_mode"},
    {Signal: "DoorState", Field: "doors"},       // compound → value_jsonb
    {Signal: "WindowState", Field: "windows"},    // compound → value_jsonb
}
```

### 2. Safety Handler

| Endpoint | Old | New |
|---|---|---|
| `GET /safety` (history) | `FROM safety_snapshots` | `SignalTracePivotFlat` |
| `GET /safety/latest` | Latest snapshot row | `SnapshotAt(now)` |

Signal mappings:
```go
var safetyMappings = []database.SignalMapping{
    {Signal: "AbsState", Field: "abs_state"},
    {Signal: "StabilityControl", Field: "stability_control"},
    {Signal: "AirbagStatus", Field: "airbag_status"},
}
```

### 3. Media Handler

| Endpoint | Old | New |
|---|---|---|
| `GET /media` (history) | `FROM media_snapshots` (if exists) | `SignalTracePivotFlat` |
| `GET /media/latest` | Latest snapshot row | `SnapshotAt(now)` |

Signal mappings:
```go
var mediaMappings = []database.SignalMapping{
    {Signal: "MediaPlaybackStatus", Field: "playback_status"},
    {Signal: "MediaArtist", Field: "artist"},
    {Signal: "MediaTitle", Field: "title"},
    {Signal: "MediaAlbum", Field: "album"},
    {Signal: "MediaSource", Field: "source"},
}
```

### Constraints

- Survey each handler first to confirm exact table/column names used
- DoorState/WindowState are compound signals → check if they're in `value_jsonb` or `value_str`
- API response shape must match frontend expectations
- If a signal name is uncertain, query: `SELECT DISTINCT signal FROM signal_log WHERE signal ILIKE '%door%'`

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -rn "security_snapshot\|safety_snapshot\|media_snapshot" --include="*.go" internal/api/security_handler.go internal/api/safety_handler.go internal/api/media_handler.go
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero snapshot refs in these 3 files.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/26b-sec-safety-media: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/26b-sec-safety-media` as the commit message prefix.


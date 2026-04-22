---
description: "Phase 5 — Delete every eliminated jsonb-backed field from all model and repo references"
---

# 🟢 Models 02 — Delete Eliminated Fields

> **Severity:** Standard (cleanup) | **Priority:** High | **Prompt #:** 2 of 6

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `internal/models/`, `internal/database/`, `internal/api/`, `internal/tesla/`, `cmd/` |
| Depends on | `01-regenerate-models` |
| Blocks | `03-rewrite-signal-repos`, `04-rewrite-automation-repos`, `05-rewrite-snapshot-repos` |
| ADR refs | ADR-001, ADR-005 |
| Estimated effort | small (~2-3 hours) |

## Single Goal

Remove every reference to the eliminated jsonb-backed fields across the entire backend. After this prompt, `grep -r 'RawJSON\|signals.*map\[string\]any\|TriggerConfig\|trigger_config' internal/ cmd/` returns zero hits (modulo the `command_params` carve-out and any test fixtures we keep).

## What's Being Established

The new structs from prompt 01 don't have these fields, but old code still references them via the legacy structs that prompt 01 didn't delete (the repos still reference fields that no longer exist on the new structs). This prompt does the demolition pass.

## Eliminated fields (full list)

| Field | Old struct | Reason |
|-------|------------|--------|
| `RawJSON json.RawMessage` | every `tesla_*` model | ADR-005 — no raw_json |
| `Signals map[string]any` | `Position`, `ChargingTelemetry`, `ClimateSnapshot`, `MotorSnapshot`, `SecurityEvent`, `VehicleMetaSnapshot` | ADR-002 — hot/cold split, signals routed to typed cols or `signal_observations` |
| `TriggerConfig json.RawMessage` | `Automation` | ADR-004 — CTI replaces |
| `Conditions json.RawMessage` | `Automation` | ADR-004 |
| `Actions json.RawMessage` | `Automation` | ADR-004 |
| `RawState pgtype.JSONB` | `Vehicle`, `VehicleState` | replaced by typed columns on `vehicle_live_state` |
| `Config map[string]any` | various | covered by `vehicle_meta_snapshots` typed cols |

## Recommendation

### Sweep order

1. **Models — confirm clean** (already from prompt 01 but double-check):
   ```powershell
   Select-String -Path internal\models\*.go -Pattern 'RawJSON|TriggerConfig|json\.RawMessage|map\[string\]any'
   ```

2. **Repos — fix every Scan / Insert / Select that references a deleted column**:
   - Each affected repo file (~10 files) needs SQL queries updated to not select/insert the dropped columns
   - Each Scan() call needs the matching argument removed
   - Use compiler errors as the worklist: `go build ./internal/database/...` will fail until clean

3. **Handlers — fix every place that read/wrote a deleted field**:
   - `internal/api/telemetry_handler.go` — heavy refactor here is **Phase 6**, but field-removal cleanup is here
   - `internal/api/automation_handler.go` — TriggerConfig/Conditions/Actions removal
   - `internal/api/vehicle_handler.go` — RawState removal
   - `internal/tesla/client.go` — RawJSON removal from response parsing

4. **Run grep across full repo to confirm nothing remains:**
   ```powershell
   Select-String -Path internal,cmd -Recurse -Pattern 'RawJSON|TriggerConfig|json\.RawMessage|pgtype\.JSONB' |
     Where-Object { $_.Line -notmatch 'CommandParams|//.*kept' }
   # Expected: 0 hits
   ```

## Suggested Fix

1. Run the broad grep to enumerate the worklist
2. Fix top-down: models → repos → handlers → workers
3. Use `go build ./...` repeatedly as a checklist (it'll complain about each lingering reference)
4. For TriggerConfig / Conditions / Actions: don't try to keep old behavior — those are now `automation_steps` rows, populated separately (prompt 04)
5. Commit

## Acceptance Criteria

- [ ] `grep RawJSON internal/ cmd/` returns 0 hits
- [ ] `grep 'json\.RawMessage' internal/ cmd/` returns 0 hits except `CommandParams`
- [ ] `grep 'pgtype\.JSONB' internal/ cmd/` returns 0 hits
- [ ] `grep 'map\[string\]any' internal/database/ internal/api/` returns 0 hits in struct field positions
- [ ] `grep 'TriggerConfig\|trigger_config' internal/` returns 0 hits
- [ ] `go build ./...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
$hits = Select-String -Path internal,cmd -Recurse -Pattern 'RawJSON|json\.RawMessage|pgtype\.JSONB' |
  Where-Object { $_.Line -notmatch 'CommandParams' -and $_.Path -notmatch '_test\.go$' }
$hits.Count
# Expected: 0

go build ./...
# Expected: exit 0
```

## Out of Scope

- Don't refactor the telemetry write-path here — that's Phase 6 (full hot/cold rewrite)
- Don't add new functionality — pure deletion + compile-fix
- Don't touch test fixtures yet (they may legitimately contain jsonb-style payloads as test inputs); scope to production code

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/ cmd/
git commit -m "refactor(db-refactor): delete eliminated jsonb-backed fields

Removes RawJSON, Signals map, TriggerConfig, Conditions, Actions,
RawState fields from all production code. Builds clean. Prepares
for Phase 5 prompts 03-05 (repo rewrites) and Phase 6 (telemetry
write-path rewrite). Sole carve-out retained:
AutomationStepActionCommand.CommandParams.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-001, ADR-005
- `phase-5-go-models/01-regenerate-models.prompt.md`

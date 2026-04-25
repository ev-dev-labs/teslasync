---
description: "Phase-15 — Fix stale AlertRule fields in rule_engine_test.go"
---
# Prompt 05 — rule_engine_test: Fix Stale Model Fields (go vet)
> **Severity:** Test | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-15-05-rule-engine-test.log` |
| Allowed files to change | `internal/api/rule_engine_test.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

`go vet` fails on `rule_engine_test.go`:
```
unknown field Conditions in struct literal of type models.AlertRule
```

The `AlertRule` model was refactored — old fields (`Conditions json.RawMessage`,
`MsgTemplate string`) were replaced with flat columns (`SignalName`, `Op`,
`ValueNum`, `ValueText`, `ValueBool`, `ValueMin`, `ValueMax`, `Severity`).

## Task

### 1. Survey the current `AlertRule` model

Check `internal/models/alert.go` for the current struct fields.

### 2. Update ALL test `AlertRule` struct literals

Replace old field usage:

```go
// OLD:
rule := &models.AlertRule{
    ID: 1, Name: "test",
    Conditions: json.RawMessage(`{"signal":"Gear","compare":"changed_to","value":"D"}`),
    MsgTemplate: "Gear changed to {{Gear}}",
}

// NEW:
rule := &models.AlertRule{
    ID: 1, Name: "test",
    SignalName: "Gear",
    Op: "changed",
    ValueText: strPtr("D"),
    Severity: "info",
    CooldownMin: 15,
}
```

### 3. Fix ALL occurrences in the file

Search for every `models.AlertRule{` literal and `Conditions:` reference.
Update each to use the new flat fields.

### 4. Add `strPtr` helper if not present

```go
func strPtr(s string) *string { return &s }
```

### 5. Remove unused `json` import if `json.RawMessage` is no longer used

## Gate

```powershell
cd D:\repos\teslasync
go vet ./...
# Should pass with exit code 0 (no "unknown field" errors)
```

## Commit

```powershell
git add -A
git commit -m "phase-15/05-rule-engine-test: fix stale AlertRule fields for go vet

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-15/05-rule-engine-test` as the commit message prefix.

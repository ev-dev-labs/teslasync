---
description: "Phase 5 - typed enum constants for automation trigger kinds"
---

# 🟢 Enums 25 - Define enum constants - automation trigger kinds

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 25 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/models/enum_automation_triggers.go` |
| Depends on | `phase-5-go-models/01-23` (model files exist) |
| Blocks | `phase-5-go-models/30-66` (repos use these enums) |
| ADR refs | ADR-001, ADR-002, ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Define typed Go constants for automation trigger kinds so callers cannot pass arbitrary strings. Each value must match the corresponding Postgres enum/CHECK constraint.

## What's Being Established

A new file `internal/models/enum_automation_triggers.go` exporting a string-based type plus exhaustive `const` block. A `Valid()` method returns true only for known values.

## Recommendation

```go
package models

type AutomationTriggerKind string

const (
    TriggerSchedule    AutomationTriggerKind = "schedule"
    TriggerSignalEvent AutomationTriggerKind = "signal_event"
    TriggerStateEnter  AutomationTriggerKind = "state_enter"
    TriggerWebhook     AutomationTriggerKind = "webhook"
)

func (k AutomationTriggerKind) Valid() bool {
    switch k {
    case TriggerSchedule, TriggerSignalEvent, TriggerStateEnter, TriggerWebhook:
        return true
    }
    return false
}
```

## Suggested Fix

1. Create `internal/models/enum_automation_triggers.go`.
2. Paste the typed constants above.
3. Add a `Valid() bool` method on the type.
4. Update model fields that previously held a plain `string` to use the new type (where applicable).

## Acceptance Criteria

- File compiles.
- All enum values match Phase 3 schema CHECK / enum.
- A `Valid()` method exists and is exhaustive.
- No string-typed field for these values remains in models.

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/models/...
Select-String -Path internal/models/enum_automation_triggers.go -Pattern 'func .* Valid'
```

## Out of Scope

Repository wiring (later prompts). Migration changes.

## Commit When Done

```powershell
git add internal/models/enum_automation_triggers.go
git commit -m "phase-5(enums): add typed enum constants for automation trigger kinds`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`

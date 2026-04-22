---
description: "Phase 5 — Regenerate Go model structs to match Phase 3 typed schema"
---

# 🔵 Models 01 — Regenerate Go Structs

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 1 of 6

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output files | `internal/models/*.go` (split per domain) |
| Depends on | Phase 4 migration applies cleanly |
| Blocks | All other Phase 5 prompts |
| ADR refs | ADR-001, ADR-004 |
| Estimated effort | medium (~half day) |

## Single Goal

Define one Go struct per Phase 3 table in `internal/models/`, with snake_case `json` tags, `db` tags, pointer types for nullable columns, and typed enum aliases for every CHECK-constrained text column.

## What's Being Established

Models are the contract between DB schema, Go runtime, and frontend types. Drift here breaks both repos (runtime panics on Scan) and frontend (compile failures or `any` leaking through). One struct per table — no "convenient" shared structs across CTI children.

## Recommendation

### File layout (split for searchability)

```
internal/models/
  vehicles.go          // Vehicle, VehicleLiveState
  drives.go            // Drive
  charging.go          // ChargingSession
  trips.go             // Trip, TripDrive
  positions.go         // Position
  climate.go           // ClimateSnapshot
  motor.go             // MotorSnapshot
  security.go          // SecurityEvent
  signals.go           // SignalObservation, SignalCatalogEntry
  vehicle_meta.go      // VehicleMetaSnapshot
  charging_telemetry.go // ChargingTelemetry
  automations.go       // Automation, AutomationStep, AutomationFull, all 12 step children
  alerts.go            // AlertRule
  notifications.go     // NotificationChannel, NotificationChannel<Discord|Slack|...>, Notification
  tesla.go             // TeslaToken, ApiCallLog
  system.go            // Setting, PollingConfig, Place, Geofence, ElectricityCost,
                       //  GasPrice, AuditLog, CommandExecution, FsmTransition, Embedding
  enums.go             // typed aliases + const blocks
```

### Struct template

```go
package models

import "time"

type Vehicle struct {
    ID             int64     `json:"id"               db:"id"`
    VIN            string    `json:"vin"              db:"vin"`
    DisplayName    string    `json:"display_name"     db:"display_name"`
    State          string    `json:"state"            db:"state"`
    IsGearCapable  bool      `json:"is_gear_capable"  db:"is_gear_capable"`
    OwnerEmail     *string   `json:"owner_email"      db:"owner_email"`     // nullable
    LastSeenAt     *time.Time `json:"last_seen_at"    db:"last_seen_at"`    // nullable
    CreatedAt      time.Time `json:"created_at"       db:"created_at"`
    UpdatedAt      time.Time `json:"updated_at"       db:"updated_at"`
}
```

### Enum template (one per CHECK-constrained column)

```go
// internal/models/enums.go
package models

type AutomationStepKind string

const (
    StepKindTriggerSignal       AutomationStepKind = "trigger_signal"
    StepKindTriggerGeofence     AutomationStepKind = "trigger_geofence"
    StepKindTriggerSchedule     AutomationStepKind = "trigger_schedule"
    StepKindTriggerEvent        AutomationStepKind = "trigger_event"
    StepKindConditionSignal     AutomationStepKind = "condition_signal"
    StepKindConditionTimeWindow AutomationStepKind = "condition_time_window"
    StepKindConditionGeofence   AutomationStepKind = "condition_geofence"
    StepKindConditionOther      AutomationStepKind = "condition_other_automation"
    StepKindActionCommand       AutomationStepKind = "action_command"
    StepKindActionNotify        AutomationStepKind = "action_notify"
    StepKindActionSetSetting    AutomationStepKind = "action_set_setting"
    StepKindActionCallAuto      AutomationStepKind = "action_call_automation"
)

type ChannelKind   string
const (
    ChannelDiscord  ChannelKind = "discord"
    ChannelSlack    ChannelKind = "slack"
    ChannelTelegram ChannelKind = "telegram"
    ChannelEmail    ChannelKind = "email"
    ChannelWebhook  ChannelKind = "webhook"
    ChannelNtfy     ChannelKind = "ntfy"
    ChannelPushover ChannelKind = "pushover"
)

type SignalSource string
const (
    SignalSourceFleetTelemetry SignalSource = "fleet_telemetry"
    SignalSourceFleetAPI       SignalSource = "fleet_api"
    SignalSourceComputed       SignalSource = "computed"
)
```

### CTI composite read-shape

```go
// internal/models/automations.go
type Automation struct {
    ID          int64     `json:"id"            db:"id"`
    Name        string    `json:"name"          db:"name"`
    Description *string   `json:"description"   db:"description"`
    Enabled     bool      `json:"enabled"       db:"enabled"`
    OwnerUserID *int64    `json:"owner_user_id" db:"owner_user_id"`
    CreatedAt   time.Time `json:"created_at"    db:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"    db:"updated_at"`
}

type AutomationStep struct {
    ID           int64              `json:"id"            db:"id"`
    AutomationID int64              `json:"automation_id" db:"automation_id"`
    Position     int                `json:"position"      db:"position"`
    Kind         AutomationStepKind `json:"kind"          db:"kind"`
    // typed details loaded from the matching child table — pointers, exactly one is non-nil
    TriggerSignal       *AutoStepTriggerSignal      `json:"trigger_signal,omitempty"`
    TriggerGeofence     *AutoStepTriggerGeofence    `json:"trigger_geofence,omitempty"`
    // ... the other 10 ...
}

// Composite returned by the repo
type AutomationFull struct {
    Automation
    Steps []AutomationStep `json:"steps"`
    Tags  []string         `json:"tags"`
}
```

## Suggested Fix

1. Create `internal/models/enums.go` first
2. Create one file per domain
3. For each Phase 3 table, write the matching struct (refer to `migrations/_baseline_source/*.sql` column-by-column)
4. `go build ./internal/models/...` — must compile clean
5. Don't yet wire to repos (that's prompt 03-05)
6. Commit

## Acceptance Criteria

- [ ] One Go struct per Phase 3 table (count matches: vehicles + 7 hypertables + 4 drives/sessions/trips + automations parent+steps+12 children + tags + alert_rules + channels parent+7 children + notifications + tesla_tokens + api_call_logs + 10 system tables = ~40 structs)
- [ ] Every nullable column → pointer type
- [ ] Every CHECK-constrained text column → typed alias in `enums.go`
- [ ] All `json` tags snake_case matching column names
- [ ] All `db` tags = column names
- [ ] No `interface{}` / `any` fields
- [ ] No `json.RawMessage` / `[]byte` / `pgtype.JSONB` fields anywhere except `AutomationStepActionCommand.CommandParams` (sole jsonb carve-out)
- [ ] `go build ./internal/models/...` exits 0
- [ ] `go vet ./internal/models/...` clean
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/models/...
go vet  ./internal/models/...

# No raw bytes / interface anywhere except the sole carve-out
Select-String -Path internal\models\*.go -Pattern 'json\.RawMessage|pgtype\.JSONB|interface\{\}' |
  Where-Object { $_.Line -notmatch 'CommandParams' }
# Expected: no output

# Snake_case json tag check (sample)
Select-String -Path internal\models\vehicles.go -Pattern 'json:"[a-z_]+"' |
  Measure-Object | Select-Object -ExpandProperty Count
# Expected: > 0
```

## Out of Scope

- Don't write repos here (prompt 03-05)
- Don't update HTTP handlers here (Phase 6 + incidental Phase 7 sweeps)
- Don't write JSON marshalers / unmarshalers — default tags are sufficient
- Don't add validation tags (e.g. `validate:"..."`); validation is in handler layer

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/models/
git commit -m "models(db-refactor): regenerate model structs for typed schema

One struct per Phase 3 table. Snake_case json tags, db tags, pointer
types for nullable columns. Typed enum aliases in enums.go. Sole
RawJSON/jsonb carve-out: AutomationStepActionCommand.CommandParams.
Builds and vets clean.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `migrations/_baseline_source/*.sql`
- ADR-001, ADR-004

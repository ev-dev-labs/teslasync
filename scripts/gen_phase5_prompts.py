"""Generate 71 atomic Phase 5 prompts for the db-refactor.

Categories:
  Models  01-23  -> per-table model regen (green)
  Enums   24-28  -> typed enum constants (green)
  Cleanup 29     -> delete eliminated fields (yellow)
  Signal  30-38  -> signal_observations + signal_catalog repos (blue)
  Auto    39-52  -> automations parent + steps + CTI loaders (blue)
  Snap    53-66  -> snapshot + live-state repos (blue)
  Gate    67-71  -> build / vet / test / tidy (green/short-form)
"""
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / ".github" / "prompts" / "db-refactor" / "phase-5-go-models"
OUT_DIR.mkdir(parents=True, exist_ok=True)

LONG_TEMPLATE = """---
description: "Phase 5 - {desc}"
---

# {emoji} {category} {num:02d} - {title}

> **Severity:** {severity} | **Priority:** {priority} | **Prompt #:** {num} of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | {outputs} |
| Depends on | {depends} |
| Blocks | {blocks} |
| ADR refs | {adrs} |
| Estimated effort | small (~15-30 min) |

## Single Goal

{goal}

## What's Being Established

{established}

## Recommendation

{recommendation}

## Suggested Fix

{fix}

## Acceptance Criteria

{accept}

## Verification

```powershell
{verify}
```

## Out of Scope

{oos}

## Commit When Done

```powershell
git add {commit_paths}
git commit -m "phase-5({scope}): {commit_msg}`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
"""

SHORT_TEMPLATE = """---
description: "Phase 5 gate - {desc}"
---

# {emoji} Build {num:02d} - {title}

> **Severity:** {severity} | **Priority:** {priority} | **Prompt #:** {num} of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | (verification only - no source changes) |
| Depends on | {depends} |
| Blocks | {blocks} |
| ADR refs | {adrs} |
| Estimated effort | small (~5-15 min) |

## Single Goal

{goal}

## Verification

```powershell
{verify}
```

## Acceptance Criteria

{accept}

## Out of Scope

Source code changes. This is a gate prompt - if it fails, fix the upstream prompt and re-run.

## Commit When Done

No commit unless a fix was required upstream.
"""

# ---------------------------------------------------------------------------
# Helper builders
# ---------------------------------------------------------------------------

def model_prompt(num, slug, table, model_file, fields_desc, adrs="ADR-001, ADR-005", extra=""):
    title = f"Regenerate {table} model"
    return dict(
        filename=f"{num:02d}-regen-{slug}-model",
        emoji="\U0001F7E2",
        category="Models",
        severity="Standard",
        priority="High" if num <= 10 else "Medium",
        num=num,
        title=title,
        desc=f"regenerate Go model for {table}",
        outputs=f"`internal/models/{model_file}`",
        depends="`phase-4-migration/*` (schema applied)",
        blocks="`phase-5-go-models/29-delete-eliminated-fields`",
        adrs=adrs,
        goal=f"Regenerate the `{table}` Go model so its fields, tags, and types match the migrated schema exactly. No `raw_json`, no JSONB except where ADR-005 carves an exception.",
        established=f"A canonical Go struct for `{table}` with `db:` and `json:` tags matching column names (snake_case). Nullable columns become pointer types. Time columns are `time.Time` or `*time.Time`. {extra}",
        recommendation=f"```go\npackage models\n\n// {table} mirrors the post-migration schema.\ntype {table.title().replace('_','')} struct {{\n{fields_desc}\n}}\n```",
        fix=f"1. Open `internal/models/{model_file}`.\n2. Replace the struct definition with the regenerated one above.\n3. Remove every field eliminated by Phase 3 (anything not in the new schema).\n4. Ensure no `RawJSON map[string]any` or `Signals jsonb` style fields remain.\n5. Keep helper methods (e.g. `IsActive()`) but update them if they referenced removed fields.",
        accept=f"- Struct fields 1-to-1 with `{table}` columns from Phase 3 schema.\n- All nullable columns use pointer types.\n- All `db:` and `json:` tags match column names exactly.\n- No `raw_json`, no JSONB carve-outs unless ADR-005 explicitly allows.\n- File compiles in isolation (`go build ./internal/models/...`).",
        verify=f"cd D:\\repos\\teslasync\ngo build ./internal/models/...\nSelect-String -Path internal/models/{model_file} -Pattern 'raw_json|RawJSON|jsonb' -SimpleMatch",
        oos="Repository changes (covered in prompts 30-66). Migration changes (Phase 3/4).",
        commit_paths=f"internal/models/{model_file}",
        scope="models",
        commit_msg=f"regenerate {table} model to match post-migration schema",
    )


def enum_prompt(num, slug, file_name, enum_desc, values_block):
    return dict(
        filename=f"{num:02d}-define-enums-{slug}",
        emoji="\U0001F7E2",
        category="Enums",
        severity="Standard",
        priority="Medium",
        num=num,
        title=f"Define enum constants - {enum_desc}",
        desc=f"typed enum constants for {enum_desc}",
        outputs=f"`internal/models/{file_name}`",
        depends="`phase-5-go-models/01-23` (model files exist)",
        blocks="`phase-5-go-models/30-66` (repos use these enums)",
        adrs="ADR-001, ADR-002, ADR-004",
        goal=f"Define typed Go constants for {enum_desc} so callers cannot pass arbitrary strings. Each value must match the corresponding Postgres enum/CHECK constraint.",
        established=f"A new file `internal/models/{file_name}` exporting a string-based type plus exhaustive `const` block. A `Valid()` method returns true only for known values.",
        recommendation=f"```go\npackage models\n\n{values_block}\n```",
        fix=f"1. Create `internal/models/{file_name}`.\n2. Paste the typed constants above.\n3. Add a `Valid() bool` method on the type.\n4. Update model fields that previously held a plain `string` to use the new type (where applicable).",
        accept="- File compiles.\n- All enum values match Phase 3 schema CHECK / enum.\n- A `Valid()` method exists and is exhaustive.\n- No string-typed field for these values remains in models.",
        verify=f"cd D:\\repos\\teslasync\ngo build ./internal/models/...\nSelect-String -Path internal/models/{file_name} -Pattern 'func .* Valid'",
        oos="Repository wiring (later prompts). Migration changes.",
        commit_paths=f"internal/models/{file_name}",
        scope="enums",
        commit_msg=f"add typed enum constants for {enum_desc}",
    )


def repo_prompt(num, slug, repo_file, method, scope_label, goal, code_block, adrs, depends, blocks, extra_fix=""):
    return dict(
        filename=f"{num:02d}-{slug}",
        emoji="\U0001F535",
        category="Repos",
        severity="Architectural" if "bulk" in slug or "loader" in slug or "upsert" in slug else "Standard",
        priority="High" if num <= 38 else "Medium",
        num=num,
        title=f"{scope_label}: {method}",
        desc=f"implement {method} on {scope_label}",
        outputs=f"`internal/database/{repo_file}`",
        depends=depends,
        blocks=blocks,
        adrs=adrs,
        goal=goal,
        established=f"A single method `{method}` on the existing repo struct in `internal/database/{repo_file}`. The repo struct itself is unchanged; only this method is added or rewritten.",
        recommendation=f"```go\n{code_block}\n```",
        fix=f"1. Open `internal/database/{repo_file}` (create the file with the repo struct skeleton if this is the first method on this repo).\n2. Add the `{method}` method shown above.\n3. Use parameterized queries only - no `fmt.Sprintf` into SQL.\n4. Wrap errors with context: `fmt.Errorf(\"{slug}: %w\", err)`.\n5. {extra_fix}",
        accept=f"- Method `{method}` exists on the repo.\n- All queries are parameterized.\n- Errors are wrapped with context.\n- `go build ./internal/database/...` succeeds.\n- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).",
        verify=f"cd D:\\repos\\teslasync\ngo build ./internal/database/...\nSelect-String -Path internal/database/{repo_file} -Pattern '{method}'",
        oos="Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).",
        commit_paths=f"internal/database/{repo_file}",
        scope="repos",
        commit_msg=f"add {method} to {scope_label.lower()}",
    )


def gate_prompt(num, slug, title, goal, verify, accept, depends="`phase-5-go-models/01-66`", blocks="`phase-6-handlers/*`"):
    return dict(
        filename=f"{num:02d}-{slug}",
        emoji="\U0001F7E2",
        category="Gate",
        severity="Critical",
        priority="High",
        num=num,
        title=title,
        desc=title.lower(),
        outputs="(verification only)",
        depends=depends,
        blocks=blocks,
        adrs="ADR-001, ADR-002, ADR-004, ADR-005",
        goal=goal,
        established="",
        recommendation="",
        fix="",
        accept=accept,
        verify=verify,
        oos="",
        commit_paths="",
        scope="gate",
        commit_msg="",
        short=True,
    )

# ---------------------------------------------------------------------------
# 23 model prompts (01-23)
# ---------------------------------------------------------------------------
MODEL_SPECS = [
    ("vehicles",            "vehicles",                    "vehicle.go",
     "    ID          int64     `db:\"id\" json:\"id\"`\n    VIN         string    `db:\"vin\" json:\"vin\"`\n    DisplayName string    `db:\"display_name\" json:\"display_name\"`\n    CreatedAt   time.Time `db:\"created_at\" json:\"created_at\"`\n    UpdatedAt   time.Time `db:\"updated_at\" json:\"updated_at\"`"),
    ("drives",              "drives",                      "drive.go",
     "    ID         int64      `db:\"id\" json:\"id\"`\n    VehicleID  int64      `db:\"vehicle_id\" json:\"vehicle_id\"`\n    StartTs    time.Time  `db:\"start_ts\" json:\"start_ts\"`\n    EndTs      *time.Time `db:\"end_ts\" json:\"end_ts\"`\n    DistanceKm *float64   `db:\"distance_km\" json:\"distance_km\"`"),
    ("charging",            "charging_sessions",           "charging.go",
     "    ID        int64      `db:\"id\" json:\"id\"`\n    VehicleID int64      `db:\"vehicle_id\" json:\"vehicle_id\"`\n    StartTs   time.Time  `db:\"start_ts\" json:\"start_ts\"`\n    EndTs     *time.Time `db:\"end_ts\" json:\"end_ts\"`\n    EnergyKwh *float64   `db:\"energy_kwh\" json:\"energy_kwh\"`"),
    ("trips",               "trips",                       "trip.go",
     "    ID        int64     `db:\"id\" json:\"id\"`\n    VehicleID int64     `db:\"vehicle_id\" json:\"vehicle_id\"`\n    Name      string    `db:\"name\" json:\"name\"`\n    CreatedAt time.Time `db:\"created_at\" json:\"created_at\"`"),
    ("positions",           "positions",                   "position.go",
     "    VehicleID int64     `db:\"vehicle_id\" json:\"vehicle_id\"`\n    Ts        time.Time `db:\"ts\" json:\"ts\"`\n    Lat       float64   `db:\"lat\" json:\"lat\"`\n    Lon       float64   `db:\"lon\" json:\"lon\"`\n    SpeedKph  *float64  `db:\"speed_kph\" json:\"speed_kph\"`"),
    ("climate",             "climate_snapshots",           "climate.go",
     "    VehicleID  int64     `db:\"vehicle_id\" json:\"vehicle_id\"`\n    Ts         time.Time `db:\"ts\" json:\"ts\"`\n    InsideTempC  *float64 `db:\"inside_temp_c\" json:\"inside_temp_c\"`\n    OutsideTempC *float64 `db:\"outside_temp_c\" json:\"outside_temp_c\"`"),
    ("motor",               "motor_snapshots",             "motor.go",
     "    VehicleID  int64     `db:\"vehicle_id\" json:\"vehicle_id\"`\n    Ts         time.Time `db:\"ts\" json:\"ts\"`\n    PowerKw    *float64  `db:\"power_kw\" json:\"power_kw\"`\n    TorqueNm   *float64  `db:\"torque_nm\" json:\"torque_nm\"`"),
    ("security",            "security_events",             "security.go",
     "    VehicleID int64     `db:\"vehicle_id\" json:\"vehicle_id\"`\n    Ts        time.Time `db:\"ts\" json:\"ts\"`\n    EventKind string    `db:\"event_kind\" json:\"event_kind\"`"),
    ("signals",             "signal_observations + signal_catalog", "signal.go",
     "    VehicleID int64     `db:\"vehicle_id\" json:\"vehicle_id\"`\n    Ts        time.Time `db:\"ts\" json:\"ts\"`\n    SignalID  int64     `db:\"signal_id\" json:\"signal_id\"`\n    NumValue  *float64  `db:\"num_value\" json:\"num_value\"`\n    StrValue  *string   `db:\"str_value\" json:\"str_value\"`"),
    ("vehicle-meta",        "vehicle_meta_snapshots",      "vehicle_meta.go",
     "    VehicleID int64     `db:\"vehicle_id\" json:\"vehicle_id\"`\n    Ts        time.Time `db:\"ts\" json:\"ts\"`\n    Odometer  *float64  `db:\"odometer\" json:\"odometer\"`\n    Software  *string   `db:\"software_version\" json:\"software_version\"`"),
    ("charging-telemetry",  "charging_telemetry",          "charging_telemetry.go",
     "    SessionID int64     `db:\"session_id\" json:\"session_id\"`\n    Ts        time.Time `db:\"ts\" json:\"ts\"`\n    PowerKw   *float64  `db:\"power_kw\" json:\"power_kw\"`\n    Voltage   *float64  `db:\"voltage\" json:\"voltage\"`\n    Current   *float64  `db:\"current\" json:\"current\"`"),
    ("automations-parent",  "automations",                 "automation.go",
     "    ID        int64     `db:\"id\" json:\"id\"`\n    Name      string    `db:\"name\" json:\"name\"`\n    Enabled   bool      `db:\"enabled\" json:\"enabled\"`\n    CreatedAt time.Time `db:\"created_at\" json:\"created_at\"`"),
    ("automation-step-trigger-models",   "automation_step_trigger_*",   "automation_step_trigger.go",
     "    StepID   int64  `db:\"step_id\" json:\"step_id\"`\n    Kind     string `db:\"kind\" json:\"kind\"`"),
    ("automation-step-condition-models", "automation_step_condition_*", "automation_step_condition.go",
     "    StepID   int64  `db:\"step_id\" json:\"step_id\"`\n    Kind     string `db:\"kind\" json:\"kind\"`"),
    ("automation-step-action-models",    "automation_step_action_*",    "automation_step_action.go",
     "    StepID        int64           `db:\"step_id\" json:\"step_id\"`\n    Kind          string          `db:\"kind\" json:\"kind\"`\n    CommandParams json.RawMessage `db:\"command_params\" json:\"command_params\"` // ADR-005 sole jsonb carve-out"),
    ("alerts",              "alerts",                      "alert.go",
     "    ID        int64     `db:\"id\" json:\"id\"`\n    VehicleID int64     `db:\"vehicle_id\" json:\"vehicle_id\"`\n    Severity  string    `db:\"severity\" json:\"severity\"`\n    CreatedAt time.Time `db:\"created_at\" json:\"created_at\"`"),
    ("notifications",       "notifications",               "notification.go",
     "    ID        int64     `db:\"id\" json:\"id\"`\n    Channel   string    `db:\"channel\" json:\"channel\"`\n    CreatedAt time.Time `db:\"created_at\" json:\"created_at\"`"),
    ("notification-channel-discord",          "notification_channel_discord",  "notification_channel_discord.go",
     "    ID         int64  `db:\"id\" json:\"id\"`\n    WebhookURL string `db:\"webhook_url\" json:\"webhook_url\"`"),
    ("notification-channel-slack-telegram",   "notification_channel_slack/telegram", "notification_channel_slack_telegram.go",
     "    ID         int64  `db:\"id\" json:\"id\"`\n    WebhookURL string `db:\"webhook_url\" json:\"webhook_url\"`\n    BotToken   string `db:\"bot_token\" json:\"bot_token\"`"),
    ("notification-channel-email-webhook",    "notification_channel_email/webhook",  "notification_channel_email_webhook.go",
     "    ID      int64  `db:\"id\" json:\"id\"`\n    Address string `db:\"address\" json:\"address\"`"),
    ("notification-channel-ntfy-pushover",    "notification_channel_ntfy/pushover",  "notification_channel_ntfy_pushover.go",
     "    ID      int64  `db:\"id\" json:\"id\"`\n    Topic   string `db:\"topic\" json:\"topic\"`\n    Token   string `db:\"token\" json:\"token\"`"),
    ("tesla",               "tesla_tokens + api_call_logs", "tesla.go",
     "    ID          int64     `db:\"id\" json:\"id\"`\n    AccessToken string    `db:\"access_token\" json:\"-\"`\n    ExpiresAt   time.Time `db:\"expires_at\" json:\"expires_at\"`"),
    ("system",              "system_audit + system_status", "system.go",
     "    ID        int64     `db:\"id\" json:\"id\"`\n    Kind      string    `db:\"kind\" json:\"kind\"`\n    CreatedAt time.Time `db:\"created_at\" json:\"created_at\"`"),
]

ALL = []
for i, (slug, table, fname, fields) in enumerate(MODEL_SPECS, start=1):
    extra = "ADR-005 carve-out: this struct includes a single `json.RawMessage` field for `command_params`." if "action" in slug else ""
    ALL.append(model_prompt(i, slug, table, fname, fields, extra=extra))

# ---------------------------------------------------------------------------
# 5 enum prompts (24-28)
# ---------------------------------------------------------------------------
ENUM_SPECS = [
    ("signal-types", "signal value/type kinds", "enum_signal_types.go",
     "type SignalValueKind string\n\nconst (\n    SignalValueNumeric SignalValueKind = \"numeric\"\n    SignalValueString  SignalValueKind = \"string\"\n    SignalValueBool    SignalValueKind = \"bool\"\n)\n\nfunc (k SignalValueKind) Valid() bool {\n    switch k {\n    case SignalValueNumeric, SignalValueString, SignalValueBool:\n        return true\n    }\n    return false\n}"),
    ("automation-triggers", "automation trigger kinds", "enum_automation_triggers.go",
     "type AutomationTriggerKind string\n\nconst (\n    TriggerSchedule    AutomationTriggerKind = \"schedule\"\n    TriggerSignalEvent AutomationTriggerKind = \"signal_event\"\n    TriggerStateEnter  AutomationTriggerKind = \"state_enter\"\n    TriggerWebhook     AutomationTriggerKind = \"webhook\"\n)\n\nfunc (k AutomationTriggerKind) Valid() bool {\n    switch k {\n    case TriggerSchedule, TriggerSignalEvent, TriggerStateEnter, TriggerWebhook:\n        return true\n    }\n    return false\n}"),
    ("automation-conditions-actions", "automation condition + action kinds", "enum_automation_steps.go",
     "type AutomationConditionKind string\nconst (\n    ConditionSignalCompare AutomationConditionKind = \"signal_compare\"\n    ConditionTimeWindow    AutomationConditionKind = \"time_window\"\n    ConditionVehicleState  AutomationConditionKind = \"vehicle_state\"\n    ConditionGeofence      AutomationConditionKind = \"geofence\"\n)\n\ntype AutomationActionKind string\nconst (\n    ActionCommand      AutomationActionKind = \"command\"\n    ActionNotification AutomationActionKind = \"notification\"\n    ActionWebhook      AutomationActionKind = \"webhook\"\n    ActionDelay        AutomationActionKind = \"delay\"\n)"),
    ("notification-channels", "notification channel kinds", "enum_notification_channels.go",
     "type NotificationChannelKind string\n\nconst (\n    ChannelDiscord  NotificationChannelKind = \"discord\"\n    ChannelSlack    NotificationChannelKind = \"slack\"\n    ChannelTelegram NotificationChannelKind = \"telegram\"\n    ChannelEmail    NotificationChannelKind = \"email\"\n    ChannelWebhook  NotificationChannelKind = \"webhook\"\n    ChannelNtfy     NotificationChannelKind = \"ntfy\"\n    ChannelPushover NotificationChannelKind = \"pushover\"\n)"),
    ("vehicle-states", "vehicle live state kinds", "enum_vehicle_states.go",
     "type VehicleStateKind string\n\nconst (\n    StateOnline    VehicleStateKind = \"online\"\n    StateAsleep    VehicleStateKind = \"asleep\"\n    StateOffline   VehicleStateKind = \"offline\"\n    StateCharging  VehicleStateKind = \"charging\"\n    StateDriving   VehicleStateKind = \"driving\"\n    StateParked    VehicleStateKind = \"parked\"\n)"),
]
for i, (slug, desc, fname, code) in enumerate(ENUM_SPECS, start=24):
    ALL.append(enum_prompt(i, slug, fname, desc, code))

# ---------------------------------------------------------------------------
# Cleanup prompt 29
# ---------------------------------------------------------------------------
ALL.append(dict(
    filename="29-delete-eliminated-fields",
    emoji="\U0001F7E1",
    category="Cleanup",
    severity="Architectural",
    priority="High",
    num=29,
    title="Delete eliminated fields across all models",
    desc="purge raw_json, signals jsonb, and dropped snapshot columns",
    outputs="`internal/models/*.go`",
    depends="`phase-5-go-models/01-28`",
    blocks="`phase-5-go-models/30-66`",
    adrs="ADR-001, ADR-002, ADR-005",
    goal="Remove every Go field that no longer maps to a column in the post-migration schema. Specifically: `RawJSON`, `Signals jsonb`, and any per-snapshot `Signals map` fields.",
    established="A clean models package with no references to eliminated fields. `grep` for `raw_json|RawJSON|jsonb` returns only the documented ADR-005 carve-out (`AutomationStepActionCommand.CommandParams`).",
    recommendation="Run a project-wide search:\n\n```powershell\nSelect-String -Path internal/models/*.go -Pattern 'raw_json|RawJSON|Signals\\s+map|jsonb' -SimpleMatch\n```\n\nDelete every match except `command_params` on `AutomationStepActionCommand`.",
    fix="1. Run the search above.\n2. For each hit, delete the field from the struct and any helper method that referenced it.\n3. Confirm `go build ./internal/models/...` still passes.\n4. Confirm the only remaining match is the ADR-005 carve-out.",
    accept="- `go build ./internal/models/...` passes.\n- `Select-String` returns at most 1 hit (`AutomationStepActionCommand.CommandParams`).\n- No struct field maps to a dropped column.",
    verify="cd D:\\repos\\teslasync\ngo build ./internal/models/...\n$hits = Select-String -Path internal/models/*.go -Pattern 'raw_json|RawJSON|Signals\\s+map|jsonb' -SimpleMatch\n$hits | Where-Object { $_.Line -notmatch 'command_params|CommandParams' }",
    oos="Database/repo cleanup (covered in Phase 4 + repo prompts).",
    commit_paths="internal/models/",
    scope="cleanup",
    commit_msg="purge raw_json and jsonb fields from models (ADR-005)",
))

# ---------------------------------------------------------------------------
# Signal repos 30-38
# ---------------------------------------------------------------------------
SIGNAL_REPO_FILE = "signal_observation_repo.go"
SIGNAL_CATALOG_FILE = "signal_catalog_repo.go"

SIGNAL_SPECS = [
    (30, "signal-observations-repo-bulk-insert", SIGNAL_REPO_FILE, "BulkInsert", "SignalObservationRepo",
     "Bulk-insert signal observations using `pgx.CopyFrom` for high-throughput telemetry ingest (ADR-001).",
     "func (r *SignalObservationRepo) BulkInsert(ctx context.Context, obs []models.SignalObservation) error {\n    if len(obs) == 0 { return nil }\n    rows := pgx.CopyFromSlice(len(obs), func(i int) ([]any, error) {\n        o := obs[i]\n        return []any{o.VehicleID, o.Ts, o.SignalID, o.NumValue, o.StrValue}, nil\n    })\n    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{\"signal_observations\"},\n        []string{\"vehicle_id\", \"ts\", \"signal_id\", \"num_value\", \"str_value\"}, rows)\n    if err != nil { return fmt.Errorf(\"signal observations bulk insert: %w\", err) }\n    return nil\n}",
     "ADR-001, ADR-002"),
    (31, "signal-observations-repo-list-by-vehicle", SIGNAL_REPO_FILE, "ListByVehicle", "SignalObservationRepo",
     "Return signal observations for a vehicle in a time window, ordered by ts ASC.",
     "func (r *SignalObservationRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time, limit int) ([]models.SignalObservation, error) {\n    rows, err := r.pool.Query(ctx, `SELECT vehicle_id, ts, signal_id, num_value, str_value FROM signal_observations WHERE vehicle_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts ASC LIMIT $4`, vehicleID, from, to, limit)\n    if err != nil { return nil, fmt.Errorf(\"list by vehicle: %w\", err) }\n    defer rows.Close()\n    var out []models.SignalObservation\n    for rows.Next() {\n        var o models.SignalObservation\n        if err := rows.Scan(&o.VehicleID, &o.Ts, &o.SignalID, &o.NumValue, &o.StrValue); err != nil { return nil, err }\n        out = append(out, o)\n    }\n    return out, rows.Err()\n}",
     "ADR-001"),
    (32, "signal-observations-repo-list-by-name", SIGNAL_REPO_FILE, "ListByName", "SignalObservationRepo",
     "Return signal observations for a vehicle filtered by signal name (joins signal_catalog).",
     "func (r *SignalObservationRepo) ListByName(ctx context.Context, vehicleID int64, name string, from, to time.Time, limit int) ([]models.SignalObservation, error) {\n    const q = `SELECT o.vehicle_id, o.ts, o.signal_id, o.num_value, o.str_value FROM signal_observations o JOIN signal_catalog c ON c.id = o.signal_id WHERE o.vehicle_id=$1 AND c.name=$2 AND o.ts BETWEEN $3 AND $4 ORDER BY o.ts ASC LIMIT $5`\n    rows, err := r.pool.Query(ctx, q, vehicleID, name, from, to, limit)\n    if err != nil { return nil, fmt.Errorf(\"list by name: %w\", err) }\n    defer rows.Close()\n    var out []models.SignalObservation\n    for rows.Next() {\n        var o models.SignalObservation\n        if err := rows.Scan(&o.VehicleID, &o.Ts, &o.SignalID, &o.NumValue, &o.StrValue); err != nil { return nil, err }\n        out = append(out, o)\n    }\n    return out, rows.Err()\n}",
     "ADR-001"),
    (33, "signal-observations-repo-get-latest", SIGNAL_REPO_FILE, "GetLatest", "SignalObservationRepo",
     "Return the most recent observation for a (vehicle, signal) pair.",
     "func (r *SignalObservationRepo) GetLatest(ctx context.Context, vehicleID, signalID int64) (*models.SignalObservation, error) {\n    var o models.SignalObservation\n    err := r.pool.QueryRow(ctx, `SELECT vehicle_id, ts, signal_id, num_value, str_value FROM signal_observations WHERE vehicle_id=$1 AND signal_id=$2 ORDER BY ts DESC LIMIT 1`, vehicleID, signalID).Scan(&o.VehicleID, &o.Ts, &o.SignalID, &o.NumValue, &o.StrValue)\n    if err == pgx.ErrNoRows { return nil, nil }\n    if err != nil { return nil, fmt.Errorf(\"get latest: %w\", err) }\n    return &o, nil\n}",
     "ADR-001"),
    (34, "signal-observations-repo-delete-older-than", SIGNAL_REPO_FILE, "DeleteOlderThan", "SignalObservationRepo",
     "Drop observations older than `cutoff`. Used by the cold-storage retention worker.",
     "func (r *SignalObservationRepo) DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {\n    tag, err := r.pool.Exec(ctx, `DELETE FROM signal_observations WHERE ts < $1`, cutoff)\n    if err != nil { return 0, fmt.Errorf(\"delete older than: %w\", err) }\n    return tag.RowsAffected(), nil\n}",
     "ADR-001"),
    (35, "signal-catalog-repo-bulk-upsert", SIGNAL_CATALOG_FILE, "BulkUpsert", "SignalCatalogRepo",
     "Upsert a batch of signal definitions using `INSERT ... ON CONFLICT (name) DO UPDATE ... RETURNING id` (ADR-009 onboarding ritual).",
     "func (r *SignalCatalogRepo) BulkUpsert(ctx context.Context, defs []models.SignalDef) error {\n    for _, d := range defs {\n        err := r.pool.QueryRow(ctx, `INSERT INTO signal_catalog (name, value_kind, unit) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET value_kind=EXCLUDED.value_kind, unit=EXCLUDED.unit RETURNING id`, d.Name, d.ValueKind, d.Unit).Scan(&d.ID)\n        if err != nil { return fmt.Errorf(\"upsert %s: %w\", d.Name, err) }\n    }\n    return nil\n}",
     "ADR-009"),
    (36, "signal-catalog-repo-get-by-name", SIGNAL_CATALOG_FILE, "GetByName", "SignalCatalogRepo",
     "Lookup a signal definition by its canonical name.",
     "func (r *SignalCatalogRepo) GetByName(ctx context.Context, name string) (*models.SignalDef, error) {\n    var d models.SignalDef\n    err := r.pool.QueryRow(ctx, `SELECT id, name, value_kind, unit FROM signal_catalog WHERE name=$1`, name).Scan(&d.ID, &d.Name, &d.ValueKind, &d.Unit)\n    if err == pgx.ErrNoRows { return nil, nil }\n    if err != nil { return nil, fmt.Errorf(\"get by name: %w\", err) }\n    return &d, nil\n}",
     "ADR-009"),
    (37, "signal-catalog-repo-list", SIGNAL_CATALOG_FILE, "List", "SignalCatalogRepo",
     "Return the full signal catalog ordered by name.",
     "func (r *SignalCatalogRepo) List(ctx context.Context) ([]models.SignalDef, error) {\n    rows, err := r.pool.Query(ctx, `SELECT id, name, value_kind, unit FROM signal_catalog ORDER BY name`)\n    if err != nil { return nil, fmt.Errorf(\"list catalog: %w\", err) }\n    defer rows.Close()\n    var out []models.SignalDef\n    for rows.Next() {\n        var d models.SignalDef\n        if err := rows.Scan(&d.ID, &d.Name, &d.ValueKind, &d.Unit); err != nil { return nil, err }\n        out = append(out, d)\n    }\n    return out, rows.Err()\n}",
     "ADR-009"),
    (38, "signal-catalog-repo-get-id-by-name", SIGNAL_CATALOG_FILE, "GetIDByName", "SignalCatalogRepo",
     "Fast id-only lookup. Used by the ingest hot path to translate name -> id once and cache it.",
     "func (r *SignalCatalogRepo) GetIDByName(ctx context.Context, name string) (int64, error) {\n    var id int64\n    err := r.pool.QueryRow(ctx, `SELECT id FROM signal_catalog WHERE name=$1`, name).Scan(&id)\n    if err == pgx.ErrNoRows { return 0, nil }\n    if err != nil { return 0, fmt.Errorf(\"get id by name: %w\", err) }\n    return id, nil\n}",
     "ADR-009"),
]
for spec in SIGNAL_SPECS:
    num, slug, fname, method, scope, goal, code, adrs = spec
    ALL.append(repo_prompt(num, slug, fname, method, scope, goal, code, adrs,
                           depends="`phase-5-go-models/29-delete-eliminated-fields`",
                           blocks="`phase-6-handlers/*`"))

# ---------------------------------------------------------------------------
# Automation repos 39-52
# ---------------------------------------------------------------------------
A_PARENT = "automation_repo.go"
A_STEPS  = "automation_step_repo.go"
A_CHILD  = "automation_step_child_repo.go"

AUTO_SPECS = [
    (39, "automations-repo-get-by-id", A_PARENT, "GetByID", "AutomationRepo",
     "Return an automation parent row by id (no children).",
     "func (r *AutomationRepo) GetByID(ctx context.Context, id int64) (*models.Automation, error) {\n    var a models.Automation\n    err := r.pool.QueryRow(ctx, `SELECT id, name, enabled, created_at FROM automations WHERE id=$1`, id).Scan(&a.ID, &a.Name, &a.Enabled, &a.CreatedAt)\n    if err == pgx.ErrNoRows { return nil, nil }\n    if err != nil { return nil, fmt.Errorf(\"get by id: %w\", err) }\n    return &a, nil\n}", "ADR-004"),
    (40, "automations-repo-list-summaries", A_PARENT, "ListSummaries", "AutomationRepo",
     "Return lightweight automation summaries (id/name/enabled) for list views - no steps loaded.",
     "func (r *AutomationRepo) ListSummaries(ctx context.Context) ([]models.AutomationSummary, error) {\n    rows, err := r.pool.Query(ctx, `SELECT id, name, enabled FROM automations ORDER BY name`)\n    if err != nil { return nil, fmt.Errorf(\"list summaries: %w\", err) }\n    defer rows.Close()\n    var out []models.AutomationSummary\n    for rows.Next() {\n        var s models.AutomationSummary\n        if err := rows.Scan(&s.ID, &s.Name, &s.Enabled); err != nil { return nil, err }\n        out = append(out, s)\n    }\n    return out, rows.Err()\n}", "ADR-004"),
    (41, "automations-repo-list-full", A_PARENT, "ListFull", "AutomationRepo",
     "Return automations with their steps + tags fully hydrated. Uses the UNION-query loader (prompts 49-51) rather than per-step fan-out.",
     "func (r *AutomationRepo) ListFull(ctx context.Context) ([]models.AutomationFull, error) {\n    parents, err := r.ListSummaries(ctx)\n    if err != nil { return nil, err }\n    out := make([]models.AutomationFull, 0, len(parents))\n    for _, p := range parents {\n        steps, err := r.steps.ListByAutomation(ctx, p.ID)\n        if err != nil { return nil, fmt.Errorf(\"hydrate %d: %w\", p.ID, err) }\n        out = append(out, models.AutomationFull{Automation: models.Automation{ID: p.ID, Name: p.Name, Enabled: p.Enabled}, Steps: steps})\n    }\n    return out, nil\n}", "ADR-004"),
    (42, "automations-repo-create", A_PARENT, "Create", "AutomationRepo",
     "Insert a new automation parent row, returning the assigned id.",
     "func (r *AutomationRepo) Create(ctx context.Context, a *models.Automation) error {\n    return r.pool.QueryRow(ctx, `INSERT INTO automations (name, enabled) VALUES ($1,$2) RETURNING id, created_at`, a.Name, a.Enabled).Scan(&a.ID, &a.CreatedAt)\n}", "ADR-004"),
    (43, "automations-repo-update", A_PARENT, "Update", "AutomationRepo",
     "Update name/enabled on an automation parent.",
     "func (r *AutomationRepo) Update(ctx context.Context, a *models.Automation) error {\n    _, err := r.pool.Exec(ctx, `UPDATE automations SET name=$1, enabled=$2 WHERE id=$3`, a.Name, a.Enabled, a.ID)\n    if err != nil { return fmt.Errorf(\"update: %w\", err) }\n    return nil\n}", "ADR-004"),
    (44, "automations-repo-delete", A_PARENT, "Delete", "AutomationRepo",
     "Delete an automation. Children cascade via FK ON DELETE CASCADE.",
     "func (r *AutomationRepo) Delete(ctx context.Context, id int64) error {\n    _, err := r.pool.Exec(ctx, `DELETE FROM automations WHERE id=$1`, id)\n    if err != nil { return fmt.Errorf(\"delete: %w\", err) }\n    return nil\n}", "ADR-004"),
    (45, "automation-steps-repo-insert", A_STEPS, "Insert", "AutomationStepRepo",
     "Insert a new step row (parent of the CTI child). Returns the assigned step id.",
     "func (r *AutomationStepRepo) Insert(ctx context.Context, s *models.AutomationStep) error {\n    return r.pool.QueryRow(ctx, `INSERT INTO automation_steps (automation_id, kind, ordinal) VALUES ($1,$2,$3) RETURNING id`, s.AutomationID, s.Kind, s.Ordinal).Scan(&s.ID)\n}", "ADR-004"),
    (46, "automation-steps-repo-update-order", A_STEPS, "UpdateOrder", "AutomationStepRepo",
     "Reorder steps within an automation. Takes a slice of (stepID, ordinal) tuples and runs the updates in a single transaction.",
     "func (r *AutomationStepRepo) UpdateOrder(ctx context.Context, automationID int64, ordering []models.StepOrder) error {\n    tx, err := r.pool.Begin(ctx)\n    if err != nil { return fmt.Errorf(\"begin: %w\", err) }\n    defer tx.Rollback(ctx)\n    for _, o := range ordering {\n        if _, err := tx.Exec(ctx, `UPDATE automation_steps SET ordinal=$1 WHERE id=$2 AND automation_id=$3`, o.Ordinal, o.ID, automationID); err != nil {\n            return fmt.Errorf(\"reorder %d: %w\", o.ID, err)\n        }\n    }\n    return tx.Commit(ctx)\n}", "ADR-004"),
    (47, "automation-steps-repo-delete", A_STEPS, "Delete", "AutomationStepRepo",
     "Delete a single step. CTI child cascades via FK.",
     "func (r *AutomationStepRepo) Delete(ctx context.Context, stepID int64) error {\n    _, err := r.pool.Exec(ctx, `DELETE FROM automation_steps WHERE id=$1`, stepID)\n    if err != nil { return fmt.Errorf(\"delete: %w\", err) }\n    return nil\n}", "ADR-004"),
    (48, "automation-steps-repo-list-by-automation", A_STEPS, "ListByAutomation", "AutomationStepRepo",
     "Return steps for an automation in ordinal order, with CTI children fully loaded via the UNION loader (prompts 49-51).",
     "func (r *AutomationStepRepo) ListByAutomation(ctx context.Context, automationID int64) ([]models.AutomationStep, error) {\n    rows, err := r.pool.Query(ctx, `SELECT id, automation_id, kind, ordinal FROM automation_steps WHERE automation_id=$1 ORDER BY ordinal`, automationID)\n    if err != nil { return nil, fmt.Errorf(\"list: %w\", err) }\n    defer rows.Close()\n    var out []models.AutomationStep\n    for rows.Next() {\n        var s models.AutomationStep\n        if err := rows.Scan(&s.ID, &s.AutomationID, &s.Kind, &s.Ordinal); err != nil { return nil, err }\n        out = append(out, s)\n    }\n    if err := rows.Err(); err != nil { return nil, err }\n    return r.children.HydrateAll(ctx, out)\n}", "ADR-004"),
    (49, "automation-step-children-loader-trigger", A_CHILD, "loadTriggers", "AutomationStepChildRepo",
     "Single UNION query that returns trigger CTI rows for a batch of step ids. Avoids N+1 fan-out.",
     "func (r *AutomationStepChildRepo) loadTriggers(ctx context.Context, stepIDs []int64) (map[int64]any, error) {\n    if len(stepIDs) == 0 { return nil, nil }\n    const q = `SELECT step_id, 'schedule' AS kind, cron_expr AS payload FROM automation_step_trigger_schedule WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'signal_event', signal_name FROM automation_step_trigger_signal_event WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'state_enter', state_name FROM automation_step_trigger_state_enter WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'webhook', endpoint FROM automation_step_trigger_webhook WHERE step_id = ANY($1)`\n    rows, err := r.pool.Query(ctx, q, stepIDs)\n    if err != nil { return nil, fmt.Errorf(\"load triggers: %w\", err) }\n    defer rows.Close()\n    out := map[int64]any{}\n    for rows.Next() { /* scan into typed struct based on kind */ }\n    return out, rows.Err()\n}", "ADR-004"),
    (50, "automation-step-children-loader-condition", A_CHILD, "loadConditions", "AutomationStepChildRepo",
     "Single UNION query that returns condition CTI rows for a batch of step ids.",
     "func (r *AutomationStepChildRepo) loadConditions(ctx context.Context, stepIDs []int64) (map[int64]any, error) {\n    if len(stepIDs) == 0 { return nil, nil }\n    const q = `SELECT step_id, 'signal_compare' AS kind, signal_name FROM automation_step_condition_signal_compare WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'time_window', window_spec FROM automation_step_condition_time_window WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'vehicle_state', state_name FROM automation_step_condition_vehicle_state WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'geofence', fence_id::text FROM automation_step_condition_geofence WHERE step_id = ANY($1)`\n    /* ... scan ... */\n    return nil, nil\n}", "ADR-004"),
    (51, "automation-step-children-loader-action", A_CHILD, "loadActions", "AutomationStepChildRepo",
     "Single UNION query that returns action CTI rows for a batch of step ids. The `command` action carries `command_params jsonb` (sole ADR-005 carve-out).",
     "func (r *AutomationStepChildRepo) loadActions(ctx context.Context, stepIDs []int64) (map[int64]any, error) {\n    if len(stepIDs) == 0 { return nil, nil }\n    const q = `SELECT step_id, 'command' AS kind, command_name, command_params FROM automation_step_action_command WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'notification', channel_id::text, NULL FROM automation_step_action_notification WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'webhook', url, NULL FROM automation_step_action_webhook WHERE step_id = ANY($1)\n               UNION ALL SELECT step_id, 'delay', duration::text, NULL FROM automation_step_action_delay WHERE step_id = ANY($1)`\n    /* ... scan ... */\n    return nil, nil\n}", "ADR-004, ADR-005"),
    (52, "automation-step-children-upsert-router", A_CHILD, "Upsert", "AutomationStepChildRepo",
     "Route an upsert to the correct CTI child table based on the step's typed `Kind`.",
     "func (r *AutomationStepChildRepo) Upsert(ctx context.Context, step models.AutomationStep, payload any) error {\n    switch step.Kind {\n    case string(models.TriggerSchedule):\n        return r.upsertTriggerSchedule(ctx, step.ID, payload)\n    case string(models.ActionCommand):\n        return r.upsertActionCommand(ctx, step.ID, payload)\n    /* ... 10 more cases ... */\n    default:\n        return fmt.Errorf(\"unknown step kind: %s\", step.Kind)\n    }\n}", "ADR-004"),
]
for spec in AUTO_SPECS:
    num, slug, fname, method, scope, goal, code, adrs = spec
    ALL.append(repo_prompt(num, slug, fname, method, scope, goal, code, adrs,
                           depends="`phase-5-go-models/29-delete-eliminated-fields`",
                           blocks="`phase-6-handlers/*`"))

# ---------------------------------------------------------------------------
# Snapshot repos 53-66
# ---------------------------------------------------------------------------
SNAP_SPECS = [
    (53, "positions-repo-bulk-insert", "position_repo.go", "BulkInsert", "PositionRepo",
     "Bulk-insert positions via `pgx.CopyFrom`. Drops the old `signals jsonb` write entirely.",
     "func (r *PositionRepo) BulkInsert(ctx context.Context, ps []models.Position) error {\n    if len(ps) == 0 { return nil }\n    rows := pgx.CopyFromSlice(len(ps), func(i int) ([]any, error) {\n        p := ps[i]\n        return []any{p.VehicleID, p.Ts, p.Lat, p.Lon, p.SpeedKph}, nil\n    })\n    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{\"positions\"}, []string{\"vehicle_id\",\"ts\",\"lat\",\"lon\",\"speed_kph\"}, rows)\n    if err != nil { return fmt.Errorf(\"positions bulk insert: %w\", err) }\n    return nil\n}", "ADR-002, ADR-005"),
    (54, "positions-repo-list-by-vehicle", "position_repo.go", "ListByVehicle", "PositionRepo",
     "List positions for a vehicle in a time window.",
     "func (r *PositionRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]models.Position, error) {\n    rows, err := r.pool.Query(ctx, `SELECT vehicle_id, ts, lat, lon, speed_kph FROM positions WHERE vehicle_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts`, vehicleID, from, to)\n    if err != nil { return nil, err }\n    defer rows.Close()\n    var out []models.Position\n    for rows.Next() {\n        var p models.Position\n        if err := rows.Scan(&p.VehicleID, &p.Ts, &p.Lat, &p.Lon, &p.SpeedKph); err != nil { return nil, err }\n        out = append(out, p)\n    }\n    return out, rows.Err()\n}", "ADR-002"),
    (55, "charging-telemetry-repo-bulk-insert", "charging_telemetry_repo.go", "BulkInsert", "ChargingTelemetryRepo",
     "Bulk-insert charging telemetry samples via `pgx.CopyFrom`.",
     "func (r *ChargingTelemetryRepo) BulkInsert(ctx context.Context, ts []models.ChargingTelemetry) error {\n    if len(ts) == 0 { return nil }\n    rows := pgx.CopyFromSlice(len(ts), func(i int) ([]any, error) {\n        t := ts[i]\n        return []any{t.SessionID, t.Ts, t.PowerKw, t.Voltage, t.Current}, nil\n    })\n    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{\"charging_telemetry\"}, []string{\"session_id\",\"ts\",\"power_kw\",\"voltage\",\"current\"}, rows)\n    if err != nil { return fmt.Errorf(\"charging telemetry bulk insert: %w\", err) }\n    return nil\n}", "ADR-002"),
    (56, "charging-telemetry-repo-list-by-session", "charging_telemetry_repo.go", "ListBySession", "ChargingTelemetryRepo",
     "List telemetry samples for a charging session in time order.",
     "func (r *ChargingTelemetryRepo) ListBySession(ctx context.Context, sessionID int64) ([]models.ChargingTelemetry, error) {\n    rows, err := r.pool.Query(ctx, `SELECT session_id, ts, power_kw, voltage, current FROM charging_telemetry WHERE session_id=$1 ORDER BY ts`, sessionID)\n    if err != nil { return nil, err }\n    defer rows.Close()\n    var out []models.ChargingTelemetry\n    for rows.Next() {\n        var t models.ChargingTelemetry\n        if err := rows.Scan(&t.SessionID, &t.Ts, &t.PowerKw, &t.Voltage, &t.Current); err != nil { return nil, err }\n        out = append(out, t)\n    }\n    return out, rows.Err()\n}", "ADR-002"),
    (57, "climate-repo-bulk-insert", "climate_repo.go", "BulkInsert", "ClimateRepo",
     "Bulk-insert climate snapshots via `pgx.CopyFrom`.",
     "func (r *ClimateRepo) BulkInsert(ctx context.Context, cs []models.ClimateSnapshot) error {\n    if len(cs) == 0 { return nil }\n    rows := pgx.CopyFromSlice(len(cs), func(i int) ([]any, error) {\n        c := cs[i]\n        return []any{c.VehicleID, c.Ts, c.InsideTempC, c.OutsideTempC}, nil\n    })\n    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{\"climate_snapshots\"}, []string{\"vehicle_id\",\"ts\",\"inside_temp_c\",\"outside_temp_c\"}, rows)\n    if err != nil { return fmt.Errorf(\"climate bulk insert: %w\", err) }\n    return nil\n}", "ADR-002"),
    (58, "climate-repo-list-by-vehicle", "climate_repo.go", "ListByVehicle", "ClimateRepo",
     "List climate snapshots for a vehicle in a time window.",
     "func (r *ClimateRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]models.ClimateSnapshot, error) {\n    rows, err := r.pool.Query(ctx, `SELECT vehicle_id, ts, inside_temp_c, outside_temp_c FROM climate_snapshots WHERE vehicle_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts`, vehicleID, from, to)\n    if err != nil { return nil, err }\n    defer rows.Close()\n    var out []models.ClimateSnapshot\n    for rows.Next() {\n        var c models.ClimateSnapshot\n        if err := rows.Scan(&c.VehicleID, &c.Ts, &c.InsideTempC, &c.OutsideTempC); err != nil { return nil, err }\n        out = append(out, c)\n    }\n    return out, rows.Err()\n}", "ADR-002"),
    (59, "motor-repo-bulk-insert", "motor_repo.go", "BulkInsert", "MotorRepo",
     "Bulk-insert motor snapshots via `pgx.CopyFrom`.",
     "func (r *MotorRepo) BulkInsert(ctx context.Context, ms []models.MotorSnapshot) error {\n    if len(ms) == 0 { return nil }\n    rows := pgx.CopyFromSlice(len(ms), func(i int) ([]any, error) {\n        m := ms[i]\n        return []any{m.VehicleID, m.Ts, m.PowerKw, m.TorqueNm}, nil\n    })\n    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{\"motor_snapshots\"}, []string{\"vehicle_id\",\"ts\",\"power_kw\",\"torque_nm\"}, rows)\n    if err != nil { return fmt.Errorf(\"motor bulk insert: %w\", err) }\n    return nil\n}", "ADR-002"),
    (60, "motor-repo-get-latest", "motor_repo.go", "GetLatest", "MotorRepo",
     "Return the latest motor snapshot for a vehicle.",
     "func (r *MotorRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.MotorSnapshot, error) {\n    var m models.MotorSnapshot\n    err := r.pool.QueryRow(ctx, `SELECT vehicle_id, ts, power_kw, torque_nm FROM motor_snapshots WHERE vehicle_id=$1 ORDER BY ts DESC LIMIT 1`, vehicleID).Scan(&m.VehicleID, &m.Ts, &m.PowerKw, &m.TorqueNm)\n    if err == pgx.ErrNoRows { return nil, nil }\n    if err != nil { return nil, err }\n    return &m, nil\n}", "ADR-002"),
    (61, "security-repo-bulk-insert", "security_repo.go", "BulkInsert", "SecurityRepo",
     "Bulk-insert security events via `pgx.CopyFrom`.",
     "func (r *SecurityRepo) BulkInsert(ctx context.Context, es []models.SecurityEvent) error {\n    if len(es) == 0 { return nil }\n    rows := pgx.CopyFromSlice(len(es), func(i int) ([]any, error) {\n        e := es[i]\n        return []any{e.VehicleID, e.Ts, e.EventKind}, nil\n    })\n    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{\"security_events\"}, []string{\"vehicle_id\",\"ts\",\"event_kind\"}, rows)\n    if err != nil { return fmt.Errorf(\"security bulk insert: %w\", err) }\n    return nil\n}", "ADR-002"),
    (62, "security-repo-list-by-vehicle", "security_repo.go", "ListByVehicle", "SecurityRepo",
     "List security events for a vehicle in a time window.",
     "func (r *SecurityRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]models.SecurityEvent, error) {\n    rows, err := r.pool.Query(ctx, `SELECT vehicle_id, ts, event_kind FROM security_events WHERE vehicle_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts`, vehicleID, from, to)\n    if err != nil { return nil, err }\n    defer rows.Close()\n    var out []models.SecurityEvent\n    for rows.Next() {\n        var e models.SecurityEvent\n        if err := rows.Scan(&e.VehicleID, &e.Ts, &e.EventKind); err != nil { return nil, err }\n        out = append(out, e)\n    }\n    return out, rows.Err()\n}", "ADR-002"),
    (63, "vehicle-meta-snapshots-repo-bulk-insert", "vehicle_meta_repo.go", "BulkInsert", "VehicleMetaRepo",
     "Bulk-insert vehicle meta snapshots via `pgx.CopyFrom`.",
     "func (r *VehicleMetaRepo) BulkInsert(ctx context.Context, ms []models.VehicleMetaSnapshot) error {\n    if len(ms) == 0 { return nil }\n    rows := pgx.CopyFromSlice(len(ms), func(i int) ([]any, error) {\n        m := ms[i]\n        return []any{m.VehicleID, m.Ts, m.Odometer, m.Software}, nil\n    })\n    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{\"vehicle_meta_snapshots\"}, []string{\"vehicle_id\",\"ts\",\"odometer\",\"software_version\"}, rows)\n    if err != nil { return fmt.Errorf(\"vehicle meta bulk insert: %w\", err) }\n    return nil\n}", "ADR-002"),
    (64, "vehicle-meta-snapshots-repo-get-latest", "vehicle_meta_repo.go", "GetLatest", "VehicleMetaRepo",
     "Return the latest meta snapshot for a vehicle.",
     "func (r *VehicleMetaRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.VehicleMetaSnapshot, error) {\n    var m models.VehicleMetaSnapshot\n    err := r.pool.QueryRow(ctx, `SELECT vehicle_id, ts, odometer, software_version FROM vehicle_meta_snapshots WHERE vehicle_id=$1 ORDER BY ts DESC LIMIT 1`, vehicleID).Scan(&m.VehicleID, &m.Ts, &m.Odometer, &m.Software)\n    if err == pgx.ErrNoRows { return nil, nil }\n    if err != nil { return nil, err }\n    return &m, nil\n}", "ADR-002"),
    (65, "vehicle-live-state-repo-get", "vehicle_live_state_repo.go", "Get", "VehicleLiveStateRepo",
     "Read the single hot-path live state row for a vehicle. Source of truth for current state per ADR-002.",
     "func (r *VehicleLiveStateRepo) Get(ctx context.Context, vehicleID int64) (*models.VehicleLiveState, error) {\n    var s models.VehicleLiveState\n    err := r.pool.QueryRow(ctx, `SELECT vehicle_id, ts, state, soc, lat, lon FROM vehicle_live_state WHERE vehicle_id=$1`, vehicleID).Scan(&s.VehicleID, &s.Ts, &s.State, &s.SOC, &s.Lat, &s.Lon)\n    if err == pgx.ErrNoRows { return nil, nil }\n    if err != nil { return nil, err }\n    return &s, nil\n}", "ADR-002"),
    (66, "vehicle-live-state-repo-upsert", "vehicle_live_state_repo.go", "Upsert", "VehicleLiveStateRepo",
     "Write-through upsert. Uses `ON CONFLICT (vehicle_id) DO UPDATE` with `COALESCE` to preserve known fields and `GREATEST(ts, EXCLUDED.ts)` to never regress the timestamp (ADR-002).",
     "func (r *VehicleLiveStateRepo) Upsert(ctx context.Context, s models.VehicleLiveState) error {\n    const q = `INSERT INTO vehicle_live_state (vehicle_id, ts, state, soc, lat, lon)\n               VALUES ($1,$2,$3,$4,$5,$6)\n               ON CONFLICT (vehicle_id) DO UPDATE SET\n                 ts    = GREATEST(vehicle_live_state.ts, EXCLUDED.ts),\n                 state = COALESCE(EXCLUDED.state, vehicle_live_state.state),\n                 soc   = COALESCE(EXCLUDED.soc,   vehicle_live_state.soc),\n                 lat   = COALESCE(EXCLUDED.lat,   vehicle_live_state.lat),\n                 lon   = COALESCE(EXCLUDED.lon,   vehicle_live_state.lon)`\n    _, err := r.pool.Exec(ctx, q, s.VehicleID, s.Ts, s.State, s.SOC, s.Lat, s.Lon)\n    if err != nil { return fmt.Errorf(\"live state upsert: %w\", err) }\n    return nil\n}", "ADR-002"),
]
for spec in SNAP_SPECS:
    num, slug, fname, method, scope, goal, code, adrs = spec
    ALL.append(repo_prompt(num, slug, fname, method, scope, goal, code, adrs,
                           depends="`phase-5-go-models/29-delete-eliminated-fields`",
                           blocks="`phase-5-go-models/67-build-models-package`"))

# ---------------------------------------------------------------------------
# Build/test gate prompts 67-71 (short-form)
# ---------------------------------------------------------------------------
ALL.append(gate_prompt(67, "build-models-package", "Build models package",
    "Confirm `internal/models/...` compiles cleanly after all model + enum + cleanup prompts.",
    "cd D:\\repos\\teslasync\ngo build ./internal/models/...",
    "- `go build ./internal/models/...` exits 0.\n- No unresolved references."))
ALL.append(gate_prompt(68, "build-database-package", "Build database (repos) package",
    "Confirm `internal/database/...` compiles cleanly after all repo prompts.",
    "cd D:\\repos\\teslasync\ngo build ./internal/database/...",
    "- `go build ./internal/database/...` exits 0.\n- No unresolved references to dropped columns or removed model fields."))
ALL.append(gate_prompt(69, "vet-and-lint", "go vet + golangci-lint",
    "Static analysis on the changed packages must be clean.",
    "cd D:\\repos\\teslasync\ngo vet ./internal/models/... ./internal/database/...\ngolangci-lint run ./internal/models/... ./internal/database/...",
    "- `go vet` exits 0.\n- `golangci-lint run` exits 0 (or only pre-existing baseline warnings)."))
ALL.append(gate_prompt(70, "test-models-package", "Test models package",
    "Run the models unit tests (Valid() exhaustiveness, JSON round-trip, etc).",
    "cd D:\\repos\\teslasync\ngo test -race -count=1 ./internal/models/...",
    "- All tests pass.\n- `-race` reports no data races."))
ALL.append(gate_prompt(71, "mod-tidy-and-tidy-check", "go mod tidy + tidy-check",
    "Ensure go.mod / go.sum reflect actual imports introduced by Phase 5.",
    "cd D:\\repos\\teslasync\ngo mod tidy\ngit diff --exit-code go.mod go.sum",
    "- `go mod tidy` makes no changes (or changes are committed).\n- `git diff --exit-code go.mod go.sum` exits 0."))

# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
def render(p):
    if p.get("short"):
        return SHORT_TEMPLATE.format(**p)
    return LONG_TEMPLATE.format(**p)

if __name__ == "__main__":
    assert len(ALL) == 71, f"expected 71 prompts, got {len(ALL)}"
    seen = set()
    for p in ALL:
        if p["filename"] in seen:
            raise RuntimeError(f"duplicate filename: {p['filename']}")
        seen.add(p["filename"])
        out = OUT_DIR / f"{p['filename']}.prompt.md"
        out.write_text(render(p), encoding="utf-8")
    print(f"wrote {len(ALL)} prompts to {OUT_DIR}")

# Phase-49 / Prompt 0003 — Max-Fires-Per-Resolution Cap (T3.1)

## Why

Decision **D5**: a `repeat`-mode rule with `cooldown_min=5` fires 288×/day
forever while the condition holds. Add a per-rule cap so even mis-configured
re-alerts can't spam infinitely. Counter resets when the underlying
condition resolves (falling edge).

`alert_rule_state.fire_count_since_reset` already exists (added in 0002).
This slice adds the rule-level cap and engine logic.

## Evidence

`alert_rule_state.fire_count_since_reset` already increments on every fire
(slice 0002 `MarkFired` SQL). What's missing: a cap column on `alert_rules`
and a guard in `RuleEngine.Evaluate` that suppresses fire when the count
hits the cap.

## Design

### Migration `000194_alert_rules_max_fires_cap.up.sql`

```sql
ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS max_fires_per_resolution INTEGER NULL
    CHECK (max_fires_per_resolution IS NULL OR max_fires_per_resolution > 0);

COMMENT ON COLUMN alert_rules.max_fires_per_resolution IS
    'For repeat-mode rules: stop firing after N fires until the condition resolves (falling edge). NULL = unlimited (legacy behaviour).';
```

Down: `ALTER TABLE alert_rules DROP COLUMN IF EXISTS max_fires_per_resolution;`

Existing rules: NULL by default. **D4** says don't backfill — NULL means
"unchanged behaviour" so no rules silently start being capped.

### Model `internal/models/alert.go`

```go
type AlertRule struct {
    // ... existing fields ...
    MaxFiresPerResolution *int `db:"max_fires_per_resolution" json:"max_fires_per_resolution,omitempty"`
}
```

Pointer (not int) so JSON omits the field for existing rules and the wire
"null" stays distinct from "0".

### Engine `internal/api/rule_engine.go`

In `Evaluate`, after the cooldown check passes and BEFORE calling
`MarkFired`:

```go
if rule.MaxFiresPerResolution != nil &&
   st != nil &&
   st.FireCountSinceReset >= *rule.MaxFiresPerResolution {
    metrics.AlertRulesMaxFiresCapHit.Inc()  // new metric
    return EvalResult{}
}
```

Falling-edge reset path (already calls `ClearLatch` from 0002) — `ClearLatch`
zeros `fire_count_since_reset` so the next rising edge starts fresh. No
additional code needed in this slice for that path.

### DTO `internal/api/alert_handler_dtos.go`

Accept `max_fires_per_resolution` on Create/Update. Validate `>0` if non-null.

### Frontend `web/src/api/types.ts` + `AlertStudioPage.tsx`

- `AlertRule` interface: `max_fires_per_resolution?: number | null`
- Editor: new optional numeric input "Max alerts before condition resolves" with help text "Leave blank for unlimited. Only applies to repeat-mode rules."
- When `trigger_mode === 'once'`, hide or disable this input (it has no effect on once mode — once fires once, period).
- Schema validation (`features/notifications/schemas/alertRule.ts`): `max_fires_per_resolution: z.number().int().positive().nullable().optional()`

### Tests

`internal/api/rule_engine_test.go`:
- `TestEvaluate_MaxFiresCap_SuppressesAfterCap` — cap=3, fire 4 times, verify 4th suppressed
- `TestEvaluate_MaxFiresCap_FallingEdgeResetsCounter` — fire 3 times (cap=3), condition flips false, condition flips true, verify next fire allowed
- `TestEvaluate_MaxFiresCap_NullMeansUnlimited` — NULL cap → fires forever (10 iters, all fire)
- `TestEvaluate_MaxFiresCap_OnceMode_NoEffect` — once mode latches after 1; cap doesn't matter

`internal/database/alert_repo_test.go`:
- `TestAlertRepo_CreateUpdateMaxFires` — round-trips the column

## Allowed files

```
migrations/000194_alert_rules_max_fires_cap.up.sql           NEW
migrations/000194_alert_rules_max_fires_cap.down.sql         NEW
internal/models/alert.go                                     MOD
internal/api/rule_engine.go                                  MOD
internal/api/rule_engine_test.go                             MOD
internal/api/alert_handler_dtos.go                           MOD
internal/api/alert_handler_rules.go                          MOD (Create/Update + validate wiring)
internal/database/alert_repo.go                              MOD
internal/database/alert_repo_test.go                         NEW (SQL-shape test pinning the column constant)
internal/metrics/metrics.go                                  MOD (new counter)
web/src/api/types.ts                                         MOD
web/src/features/notifications/schemas/alertRule.ts          MOD
web/src/features/notifications/pages/AlertStudioPage.tsx     MOD
web/src/i18n/en.json                                         MOD (labels + helptext)
```

> Honesty Covenant rule 9 amendments (commit phase-49/0003-max-fires-cap):
>
> - `internal/database/alert_repo_test.go` did not exist on the branch.
>   Changed `MOD` → `NEW` and the planned test from
>   `TestAlertRepo_CreateUpdateMaxFires` (a roundtrip the codebase has
>   no testcontainer harness for) to `TestAlertRuleColumnsIncludesMaxFiresCap`
>   (an SQL-shape test pinning the `alertRuleColumns` constant —
>   matches the convention in `vampire_drain_repo_test.go`,
>   `guard_repo_test.go`, `alert_rule_state_repo_test.go`).
> - Added `internal/api/alert_handler_rules.go` (MOD) — the prompt
>   listed the DTO file but not the handler that wires the DTO to the
>   model + validates the value > 0.

## Acceptance criteria

1. Build green: backend + frontend
2. New rule with `max_fires_per_resolution=3` and 5-min cooldown stops at 3 fires
3. After condition flips false then true, counter resets and rule fires again
4. NULL cap = legacy behaviour (no regression on existing rules)
5. Once-mode rule with non-null cap: cap is ignored (latch wins)
6. New `tesla_alert_rules_max_fires_cap_hit_total` Prometheus counter exposed
7. UI hides the input when trigger_mode === 'once'

## Verification log

```
go build ./... && go test -race -count=1 -run 'TestEvaluate_MaxFiresCap|TestAlertRuleColumnsIncludesMaxFiresCap' ./...
cd web && npx tsc --noEmit
curl -s localhost:8080/metrics | grep teslasync_cep_rules_max_fires_cap_hit_total
```

> Honesty Covenant rule 9 amendment: the metric name is
> `teslasync_cep_rules_max_fires_cap_hit_total` (the project namespace
> is `teslasync` and the prefix follows the sibling
> `teslasync_cep_rules_*` family), not `tesla_alert_rules_*`.

## Log location

`.github/prompts/db-refactor/logs/phase-49-0003-max-fires-cap.log`

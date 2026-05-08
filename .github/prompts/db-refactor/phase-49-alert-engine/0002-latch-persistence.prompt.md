# Phase-49 / Prompt 0002 — Latch Persistence (T1 bug fix)

## Why

`RuleEngine.OnceLatched` lives only in a Go map. Every API pod restart
clears it, so once-mode rules whose condition still matches re-fire on the
next telemetry batch. This is the user-reported "vehicle locked alert
fires every time I deploy" symptom.

Decision **D9**: persist latch state in a NEW table `alert_rule_state`
(NOT additional columns on `alert_rules`) — this lets us track per
`(rule, vehicle)` latch even for fleet-wide rules.

## Evidence

```
$ rg 'OnceLatched' internal/api/rule_engine.go
internal/api/rule_engine.go:35:	OnceLatched bool
internal/api/rule_engine.go:74:		onceLatched = st.OnceLatched
internal/api/rule_engine.go:110:			st.OnceLatched = false
internal/api/rule_engine.go:122:	if rule.TriggerMode == "once" && onceLatched {
internal/api/rule_engine.go:144:		st.OnceLatched = true
internal/api/rule_engine.go:149:		st.OnceLatched = true

$ grep -A2 'func (e \*RuleEngine) LoadCooldownFromDB' internal/api/rule_engine.go
# Only initializes empty state entries — does NOT restore LastFiredAt or OnceLatched
```

Reproduction (manual, do not script in this slice):

1. Create rule "Locked = true", `trigger_mode='once'`, vehicle locked.
2. Trigger one telemetry batch → notification fires, latch=true.
3. Restart `teslasync-api` container.
4. Trigger another telemetry batch → notification fires AGAIN.

After this slice, step 4 must NOT fire.

## Design

### Migration `000193_alert_rule_state.up.sql`

```sql
CREATE TABLE alert_rule_state (
    rule_id                  BIGINT      NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    vehicle_id               BIGINT      NOT NULL REFERENCES vehicles(id)    ON DELETE CASCADE,
    latched_at               TIMESTAMPTZ NULL,
    last_fired_at            TIMESTAMPTZ NULL,
    fire_count_since_reset   INTEGER     NOT NULL DEFAULT 0,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rule_id, vehicle_id)
);

CREATE INDEX alert_rule_state_rule_id_idx     ON alert_rule_state (rule_id);
CREATE INDEX alert_rule_state_vehicle_id_idx  ON alert_rule_state (vehicle_id);

COMMENT ON TABLE  alert_rule_state IS 'Persistent per-(rule,vehicle) firing state — survives pod restarts.';
COMMENT ON COLUMN alert_rule_state.latched_at IS 'When the once-mode rule fired and is now suppressed until condition resets.';
COMMENT ON COLUMN alert_rule_state.last_fired_at IS 'Most recent successful fire — used by cooldown gate.';
COMMENT ON COLUMN alert_rule_state.fire_count_since_reset IS 'Counter for max_fires_per_resolution cap (added in slice 0003).';
```

Down migration: `DROP TABLE IF EXISTS alert_rule_state CASCADE;`

### Repo `internal/database/alert_rule_state_repo.go`

```go
type AlertRuleStateRepo struct { db *DB }

type AlertRuleState struct {
    RuleID, VehicleID int64
    LatchedAt, LastFiredAt *time.Time
    FireCountSinceReset int
}

// LoadByRule returns every (rule, vehicle) state row for a rule.
// Used at engine boot to hydrate the in-memory cache.
LoadByRule(ctx, ruleID int64) ([]*AlertRuleState, error)

// LoadAll hydrates the engine cache for all rules at startup.
LoadAll(ctx) ([]*AlertRuleState, error)

// MarkFired upserts the row, sets LastFiredAt=now, increments
// fire_count_since_reset, and (when isOnce) sets latched_at=now.
// Returns whether the upsert actually happened (false = race lost).
MarkFired(ctx, ruleID, vehicleID int64, now time.Time, isOnce bool) (bool, error)

// ClearLatch sets latched_at=NULL and resets fire_count_since_reset.
// Called on falling edge.
ClearLatch(ctx, ruleID, vehicleID int64) error
```

`MarkFired` SQL must be the race-safe upsert from R1 in 0000:

```sql
INSERT INTO alert_rule_state (rule_id, vehicle_id, latched_at, last_fired_at, fire_count_since_reset, updated_at)
VALUES ($1, $2, CASE WHEN $3 THEN $4 END, $4, 1, $4)
ON CONFLICT (rule_id, vehicle_id) DO UPDATE
   SET latched_at            = CASE WHEN $3 THEN $4 ELSE alert_rule_state.latched_at END,
       last_fired_at         = $4,
       fire_count_since_reset = alert_rule_state.fire_count_since_reset + 1,
       updated_at            = $4
 WHERE alert_rule_state.latched_at IS NULL  -- race-safe: only fire if not already latched
RETURNING (xmax = 0) AS inserted;
```

If RETURNING returns no row → another batch latched first → return
`(false, nil)` from MarkFired and the caller suppresses the notification.

### Engine integration `internal/api/rule_engine.go`

Replace the in-memory `OnceLatched` checks with calls to the repo:

- Constructor: `NewRuleEngine(stateRepo *database.AlertRuleStateRepo)` — accept the repo, store it.
- Boot: new method `HydrateFromDB(ctx)` calls `stateRepo.LoadAll()` and seeds `e.state[ruleKey]` with `LatchedAt`, `LastFiredAt`, derived `OnceLatched = LatchedAt != nil`.
- Fire path: instead of mutating in-memory state, call `stateRepo.MarkFired(...)`. If returns `(false, nil)`, suppress the notification (race lost — peer pod fired first).
- Falling edge path (line 105-117): call `stateRepo.ClearLatch(...)` AND clear in-memory cache.

In-memory cache becomes a write-through cache of the DB. Reads are still
in-memory hot-path; writes go DB-first then update cache.

### Wiring `cmd/teslasync/main.go` and `internal/api/router.go`

- Construct `AlertRuleStateRepo` near other repos.
- Pass into `NewRuleEngine(stateRepo)`.
- Call `engine.HydrateFromDB(ctx)` after boot, before MQTT subscribers start.

### Tests

`internal/database/alert_rule_state_repo_test.go`:
- `TestMarkFired_FirstFire` — inserts row with latched_at when isOnce=true
- `TestMarkFired_SecondFireSameVehicle_RaceLost` — second concurrent call returns `(false, nil)`
- `TestMarkFired_RepeatMode_DoesNotLatch` — isOnce=false leaves latched_at NULL
- `TestClearLatch_ResetsCounter` — fire_count_since_reset back to 0
- `TestLoadAll_HydratesEverything` — round-trip through repo

`internal/api/rule_engine_test.go` (extend):
- `TestEvaluate_OnceMode_SurvivesRestart` — fire, simulate restart by re-Hydrating, verify second eval suppressed
- `TestEvaluate_OnceMode_FallingEdgeClearsLatch` — fire, signal flips false, latch cleared
- `TestEvaluate_RepeatMode_DoesNotLatch` — fires every cooldown regardless

## Allowed files

```
migrations/000193_alert_rule_state.up.sql                    NEW
migrations/000193_alert_rule_state.down.sql                  NEW
internal/database/alert_rule_state_repo.go                   NEW
internal/database/alert_rule_state_repo_test.go              NEW
internal/api/rule_engine.go                                  MOD
internal/api/rule_engine_test.go                             MOD
internal/api/telemetry_alerts.go                             MOD (constructor wiring)
internal/app/new.go                                          MOD (HydrateFromDB call)
```

> **Slice 0002 deviation note (Honesty Covenant rule 9, applied 2026-05-08):**
> The original draft listed `internal/api/router.go` and `cmd/teslasync/main.go`
> as the wiring targets. Pre-execution audit established that:
>
> - `cmd/teslasync/main.go` is the 71-line stub left after Phase-47/04 and
>   delegates all wiring to `internal/app/new.go`. No changes belong there.
> - `internal/api/router.go` constructs `*TelemetryHandler` (which
>   internally constructs the alert evaluator); the actual evaluator
>   construction site is `internal/api/telemetry_handler_wiring.go`, which
>   in turn calls `NewTelemetryAlertEvaluator(db, ...)` defined in
>   `internal/api/telemetry_alerts.go`.
>
> The minimum-blast-radius wiring is therefore: construct the new repo
> inside `NewTelemetryAlertEvaluator` (already takes `*database.DB`) and
> add the `HydrateFromDB(ctx)` call in `internal/app/new.go` next to the
> existing `LoadPrevSignalsFromStore` block. `router.go`,
> `telemetry_handler_wiring.go`, and `cmd/teslasync/main.go` are left
> untouched. Allowed-files updated above to match.

Any other file edited ⇒ STATUS=BLOCKED.

## Acceptance criteria

1. `go build ./...` exits 0
2. `go test -race -count=1 ./internal/api/... ./internal/database/...` exits 0
3. New tests cover: first-fire, race-lost, falling-edge reset, restart survival
4. `MarkFired` SQL uses `ON CONFLICT ... WHERE latched_at IS NULL RETURNING` form (race-safe)
5. Old in-memory-only path removed — `OnceLatched bool` is now derived from `LatchedAt != nil`, NOT independently tracked
6. Migration up + down + up cleanly idempotent

## Verification log

```
go build ./...
go test -race -count=1 -run 'TestAlertRuleState|TestRuleEngine_PersistentLatch|TestRuleEngine_NilStateRepo' ./internal/api/... ./internal/database/...
# both exit 0

# migration round-trip on a scratch DB (golang-migrate, NOT goose — corrected
# from the original draft after audit; the project uses `make migrate` which
# wraps internal/database/database.go::runMigrations using golang-migrate).
make migrate    # 000193 applies
# (down + re-up done by the migration test harness, not via a CLI verb)
```

## Log location

`.github/prompts/db-refactor/logs/phase-49-0002-latch-persistence.log` with
`=== STATUS === EXIT=N STATUS=DONE/BLOCKED` footer and the verification
transcripts pasted in.

# Fleet Telemetry resubscribe runbook

> **Audience:** TeslaSync on-call operators.
> **Scope:** Recovering from / preventing Tesla Fleet Telemetry subscription drift.
> **Last reviewed:** phase-42 prompt 0090.

This runbook covers the operator workflow for `cmd/resubscribe`, the
binary that pushes a fresh Fleet Telemetry subscription configuration to
every (or one) vehicle so Tesla's process-startup snapshot reseeds all
subscribed signals — most importantly the four `Setting*Unit` fields
whose absence would otherwise cause the ingest pipeline to fail-closed
and silently drop unit-bearing values per ADR-004 #9.

This is separate from the API's MQTT broker subscription. The API
automatically reasserts its `{topicBase}/+/v/+` MQTT subscription every 30
seconds and retries a failed SUBACK every five seconds. Do not run a Tesla
fleet-wide resubscribe merely because the local API consumer lost its broker
subscription.

## When to run

- After every deploy that touches `internal/tesla/config/`,
  `routing.yaml`, or any code path that changes the Fleet Telemetry
  subscription shape (added / removed / renamed signals, changed
  intervals).
- After Tesla reports lost subscriptions
  (`/api/1/partner_accounts/fleet_telemetry_error_vins`).
- After the alert thresholds below fire.
- As part of the phase-42 first-deploy sequence (after migrations apply
  but before declaring the rollout complete).

## Required ordering

Resubscribe MUST run AFTER the per-vehicle bootstrap step has populated
`vehicle_unit_history`. The order is:

1. **Bootstrap.** Run the bootstrap flow from phase-42 prompt 0023
   (`internal/tesla/client_vehicle_data.go` REST snapshot of
   `gui_settings`) for every vehicle that lacks a recent
   `vehicle_unit_history` row. This guarantees a unit context exists
   BEFORE Fleet Telemetry resumes streaming unit-bearing fields.

2. **Resubscribe.** THEN run `cmd/resubscribe`.

**Rationale.** With bootstrap skipped, the first ~1s of telemetry on a
fresh subscription arrives BEFORE the `Setting*Unit @ interval=1` fires.
Per ADR-004 #9 the pipeline drops unit-bearing values that arrive
without a unit context (fail-closed — never silent corruption). On-call
must NOT shortcut the bootstrap step on the grounds that "we'll catch
the unit values when they stream"; we will not catch them, we will drop
them, and the operator runbook for `tesla_unit_drops_no_context_total`
will then page the next on-call shift.

## Canary procedure

Never resubscribe the full fleet without a successful canary first.

1. Pick one low-traffic vehicle (the on-call's own car, or a stable test
   vehicle from a non-customer cohort).

2. Dry-run first to verify wiring without touching Tesla:
   ```bash
   TESLASYNC_OPERATOR_TOKEN=$(pass teslasync/operator-token) \
   ./resubscribe --vehicle <vehicle_id> --dry-run
   ```
   Confirm the `event="resubscribe.start"` audit line in the output
   contains the expected `vehicle_count=1`, `dry_run=true`, and a
   `config_sha256` matching the deploy artifact.

3. Real run:
   ```bash
   TESLASYNC_OPERATOR_TOKEN=$(pass teslasync/operator-token) \
   ./resubscribe --vehicle <vehicle_id>
   ```

4. Within 60s verify ALL of:
   - A fresh row appears in `vehicle_unit_history` for the canary
     (one row per `Setting*Unit` field that streamed in the snapshot).
   - `signal_log` shows `Setting*Unit` rows for the canary in the last
     5 min.
   - `tesla_unit_drops_no_context_total{vehicle_id=<canary>}` is FLAT
     (no increase from the pre-canary baseline).

5. Only after the canary verifies clean run the full fleet:
   ```bash
   TESLASYNC_OPERATOR_TOKEN=$(pass teslasync/operator-token) \
   ./resubscribe
   ```

## Token & auth

- The binary reuses the server's tesla client and reads its OAuth token
  from the same env var the server uses (Tesla Fleet API `TESLA_*` vars
  in `internal/config/config.go`). Before a fleet-wide run, confirm the
  token has at least 2× expected runtime remaining:
  > `runtime ≈ vehicles × per-vehicle-call-seconds / workers`
  >
  > For default `--workers=4` this is ~42 minutes per 10k vehicles. Refresh
  > the OAuth token before running if there is any doubt.

- **Operator credential (REQUIRED).** `cmd/resubscribe` REFUSES to run
  unless the env var `TESLASYNC_OPERATOR_TOKEN` is set:
  ```go
  if os.Getenv("TESLASYNC_OPERATOR_TOKEN") == "" {
      log.Fatal("refusing to run without TESLASYNC_OPERATOR_TOKEN; this is a privileged operation, see runbook")
  }
  ```
  The token is a shared secret rotated quarterly; on-call holds it via
  the team password manager. The binary does NOT validate the token
  cryptographically — its purpose is to make accidental invocation
  (e.g., by CI, by a developer's shell history, by a stray cron) IMPOSSIBLE.

- **Audit log (REQUIRED).** Before the first `SubscribeFleetTelemetry`
  call, the binary emits a single structured zerolog line at INFO level:
  ```json
  {
    "event":         "resubscribe.start",
    "operator":      "<USER or USERNAME>",
    "vehicle_count": <N>,
    "dry_run":       <true|false>,
    "workers":       <N>,
    "config_sha256": "<hex>"
  }
  ```
  `config_sha256` is sha256 of `(*teslaconfig.Builder).BuildSubscription()`
  output and uniquely identifies the subscription shape pushed during
  this run. On exit, a matching `event="resubscribe.end"` line is
  emitted with `succeeded=<N>`, `failed=<N>`, `skipped=<N>`,
  `duration_seconds=<float>`, `exit_code=<int>`.

  These two lines ARE the audit trail. They go to stdout (the on-call's
  terminal) AND to whichever structured log sink the deployment is
  configured to ship zerolog output to.

## Downtime expectation

- Resubscribe itself does NOT cause downtime. It DOES cause a brief
  (~1-3s) per-vehicle gap where Tesla rebuilds the subscription and
  re-emits the snapshot. Plan around this for any time-series alerting
  that fires on "missing data for N seconds" — pre-silence such alerts
  for the resubscribe window.

- Phase-42 deploy AS A WHOLE is one-way (DROP CASCADE in migration
  000180 from prompt 0078). Migrations 000180-000188 must apply as a
  single `migrate up` step BEFORE any application pod is rolled. Plan a
  maintenance window of at least 5 minutes for the migration sequence
  + rolling restart, and notify users via the customer status page if
  the deploy occurs during business hours.

## Alert thresholds

These are the Prometheus alert thresholds that should trigger
on-call action. They are codified in `helm/teslasync/templates/`
(post phase-44).

- `tesla_unit_drops_no_context_total` rate > **0.1/s for 5 min** → **PAGE**.
  Vehicles writing without unit context = ingest-pipeline corruption.
  Recover via this runbook (resubscribe the affected cohort).

- `tesla_bootstrap_skipped_total` rate > **0.05/s for 5 min** → **WARN**.
  REST `/vehicle_data` snapshot is failing for some vehicles; their next
  resubscribe will arrive without a unit context and will trigger the
  PAGE alert above. Investigate Tesla auth or rate-limit before that
  cascades.

- `tesla_signal_cache_stale_total` rate > **5/s for 10 min** → **WARN**.
  Indicates Redis lag or stale producers; not directly a resubscribe
  problem but commonly correlates with subscription drift.

- `tesla_unit_drift_suspected_total` increment in last 24h > **1** → **PAGE**.
  Silent unit corruption suspected — the `cmd/unit-drift-validator`
  cross-check (phase-42 prompt 0091) found a vehicle whose VehicleSpeed
  doesn't match the implied speed from Location deltas. Run
  `cmd/unit-drift-validator --vehicle <id>` to triage, then resubscribe
  that vehicle.

## How to run

Required environment:

| Variable                       | Source                              | Notes |
|--------------------------------|-------------------------------------|-------|
| `TESLASYNC_OPERATOR_TOKEN`     | team password manager               | Presence-only gate; binary refuses to run without it. |
| `DATABASE_*`                   | same as the API server              | Reads vehicle list. |
| `TESLA_*`                      | same as the API server              | Tesla OAuth + command proxy. |
| `FLEET_TELEMETRY_HOST` / `_PORT` | same as the API server            | Fleet Telemetry server VINs should connect to. |

Flags:

| Flag                      | Default | Purpose |
|---------------------------|--------:|---------|
| `--dry-run`               | `false` | Log what would happen without calling Tesla. Always run with this first. |
| `--vehicle <id>`          | `0`     | Single-vehicle mode for triage (`0` = all vehicles). |
| `--workers <N>`           | `4`     | Bounded worker-pool size. Don't exceed Tesla's per-account rate limit. |
| `--per-vehicle-timeout`   | `60s`   | `context.WithTimeout` per Tesla API call. |
| `--version`               |         | Print binary version and exit. |

## Verification steps

After a successful run (`exit_code=0` in the `resubscribe.end` audit
line), verify within 60s:

1. **`vehicle_unit_history` got fresh rows for the resubscribed cohort.**
   ```sql
   SELECT vehicle_id, unit_kind, unit_value, effective_from
   FROM vehicle_unit_history
   WHERE effective_from > now() - interval '5 minutes'
   ORDER BY effective_from DESC
   LIMIT 50;
   ```
   Expect 4 rows per resubscribed vehicle (DistanceUnit, TemperatureUnit,
   ChargeUnit, PressureUnit).

2. **`signal_log` shows `Setting*Unit` for the resubscribed cohort.**
   ```sql
   SELECT vehicle_id, field_name, COUNT(*)
   FROM signal_log
   WHERE field_name LIKE 'Setting%Unit'
     AND ts > now() - interval '5 minutes'
   GROUP BY vehicle_id, field_name
   ORDER BY vehicle_id, field_name;
   ```

3. **`tesla_unit_drops_no_context_total` did NOT spike** for the
   resubscribed cohort. Compare 5-min rate before vs. after; no
   resubscribed vehicle should appear in the post-rate.

If any of the three verification steps fails, the resubscribe DID NOT
land cleanly. Re-run for the affected vehicles after investigating
the corresponding Tesla API errors in the resubscribe.end audit log.

## Rollback note

There is NO rollback path for resubscribe itself — Fleet Telemetry
config is replace-only at the Tesla edge. The pre-deploy
`phase-42-pre-drop` git tag + the database backup taken before
migration 000180 are the ONLY rollback paths for the broader
phase-42 deploy. Resubscribe is a forward-only operation by design.

If a resubscribe lands a broken subscription shape (wrong fields, wrong
intervals, wrong hostname), the recovery is to fix the bug, build a
new binary, and run resubscribe again with the corrected configuration.
The audit trail (`config_sha256` in the start line) makes it possible
to identify which deploy pushed which subscription shape, which is
critical for forensics when the broken shape is detected hours after
the run.

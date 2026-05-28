# tools/migration-snapshots

> **Purpose:** snapshot harness for Phase R2 (the `internal/api/`
> restructure). Captures per-route HTTP response shapes BEFORE the
> handler restructure and verifies behavioral parity AFTER each
> R2 cluster commit.
>
> **Status:** SKELETON committed in R0. Harness IMPLEMENTATION lands in
> R2.0 (the R2 prep sub-phase). See `plan.md` §16.7.2.
>
> **Owner:** Phase R execution agent.

## Contract

A snapshot is a JSON file capturing the full HTTP response for a
specific request:

```
tools/migration-snapshots/
  <method>-<path-with-slashes-replaced-by-dashes>/
    pre.json    # captured BEFORE the cluster move
    post.json   # captured AFTER the cluster move
    request.txt # full request including method, path, headers, body
    diff.txt    # output of comparison (empty file = parity)
```

Example:
```
tools/migration-snapshots/
  GET-api-v1-charging/
    pre.json
    post.json
    request.txt
    diff.txt
```

## Normalization rules (applied to both pre and post)

The harness MUST normalize before diff to avoid false positives:

1. **JSON keys sorted alphabetically** at every level.
2. **Volatile fields redacted** (replaced with `"<REDACTED>"`):
   - Any field ending in `_at`, `_ts`, `_timestamp`, `_id` (UUIDs).
   - Top-level `request_id`, `trace_id`, `span_id`, `correlation_id`.
   - `generated_at`, `now`, `current_time`.
3. **Numerical fields** rounded to 6 decimal places (handles float
   noise).
4. **Empty arrays and `null` fields** preserved (do NOT collapse to
   absent).

## Fixture DB

Snapshot capture runs against a deterministic fixture DB:
- Seed: `db/seed.sql` + a frozen snapshot of `signal_log` covering
  one known drive + one known charging session + one known
  vehicle's first 7 days of telemetry.
- Vehicle ID: `1` (fixture vehicle).
- Auth: bypassed via test-only header `X-Test-Subject: test-user`
  (configured only when `TESLASYNC_TEST_MODE=1`).
- Time: fixed via `--clock=2026-05-01T12:00:00Z` flag on the API
  binary in test mode.

## Endpoint list

Endpoint list is generated automatically from
`internal/api/router.go` (and after R2, from
`internal/handler/v1/router.go` and each subpkg's `Mount`). The
generator walks chi's routes and lists every concrete path +
method combination. Endpoints requiring path params (e.g.
`/vehicles/{vehicleID}/state`) are exercised with the fixture
vehicle's ID.

## Running the harness

(Once implemented in R2.0:)

```powershell
# Capture pre-cluster snapshots
$env:TESLASYNC_TEST_MODE = '1'
make docker-up
go run ./tools/migration-snapshots/cmd/capture --label pre

# ...perform cluster move + restart API...

go run ./tools/migration-snapshots/cmd/capture --label post

# Compare pre vs post
go run ./tools/migration-snapshots/cmd/diff
# Exit 0 if all diff.txt are empty.
# Exit 1 if ANY diff.txt has content, with paths printed.
```

## CI integration (R13)

In R13, the snapshot harness becomes a `make` target gated in CI:
```
make snapshot-verify
```
This re-captures the current HEAD's snapshots and compares them
against the committed `pre.json` set. Any drift requires explicit
acknowledgment in the PR description.

## Why this exists

Per rubber-duck critique on the Phase R plan (#11, CRITICAL):

> "curl endpoint > snapshots/post.json && diff" assumes
> deterministic data, running services, stable auth, stable
> timestamps, sorted JSON, and seeded DB state. R2 parity gate
> may be flaky or skipped under pressure.

This harness defines the contract concretely so the parity gate
is reliable when R2 starts.

## Open questions for R2.0

- Should we use `httptest.NewRecorder` against in-process router
  instead of full docker-compose stack? (Probably yes for unit
  speed; full docker for integration-level periodic verification.)
- Should snapshots be gitignored (large) or committed (tiny if
  redacted)? Initial assumption: COMMITTED, redacted, fixture-only
  (predictable size).
- Should we use `cmp.Diff` (go-cmp) or external `jq` for the diff
  output? Initial assumption: `cmp.Diff` with json-normalized
  values for Go-native diagnostics.

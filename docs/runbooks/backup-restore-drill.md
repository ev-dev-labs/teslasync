# Backup restore drill

**A backup that has never been restored is a hypothesis.** This drill
turns it into evidence, on a schedule.

Definition: `ops/restore/drill.yaml`
Workflow: `.github/workflows/backup-restore-drill.yml`
Gate: `go run ./cmd/ops-gate -check restore`

## Why two modes

| Mode | Credentials | Runs | Proves |
|---|---|---|---|
| `roundtrip` (default) | none | every schedule tick | The backup → upload → download → checksum → decompress → restore chain works, and row counts survive it. |
| `production-artifact` | required | manual, opt-in | The actual production artifact imports into an isolated TimescaleDB, preserves critical rows, and boots the API. |

The default mode needs no secrets on purpose. A scheduled drill whose
only mode requires production credentials will silently no-op the first
time a token rotates, and nobody notices until the day it matters.

`production-artifact` **skips loudly**: when its credentials are absent
the job fails with an explicit "nothing was verified" summary rather
than reporting green.

## Running it

```bash
# credential-free, self-contained
gh workflow run backup-restore-drill.yml -f mode=roundtrip

# against the newest real production artifact (needs environment secrets)
gh workflow run backup-restore-drill.yml -f mode=production-artifact
```

The production-artifact mode needs one read-only connection string:
`BACKUP_DRILL_DATABASE_URL`. It reads the latest successful `backup_runs`
metadata and provider configuration; it never writes to that database.
The workflow creates and guards its own target database.

The archive-only verifier can still be run locally:

```bash
DATABASE_HOST=… DATABASE_NAME=… \
BACKUP_VERIFY_CRITICAL_TABLES=vehicles,drives,charging_sessions \
  go run ./cmd/backup-verify
```

`cmd/backup-restore-drill` is intentionally stricter. It requires distinct
source and target connections, a target database named
`teslasync_drill_*` or `*_restore_drill`, and a matching row in
`restore_drill_guard`. Those checks prevent an accidental import into
production.

## What "pass" means

From `ops/restore/drill.yaml` `success_criteria`:

1. **artifact-round-trips** — the artifact downloads with a matching
   checksum and decompresses cleanly.
2. **critical-tables-non-empty** — every table in `critical_tables`
   restores with a non-zero row count. *A "successful" backup with zero
   rows in `vehicles` is a failed backup that exited 0.*
3. **row-parity** — every table in the artifact is imported transactionally
   and its restored row count equals its artifact row count.
4. **api-health** — the real TeslaSync API binary boots against the restored
   database and returns HTTP 200 from `/healthz`.
5. **rto-recorded** — production mode measures scratch provisioning,
   migrations, artifact download, import, and API health as one recovery
   interval.
6. **immutable-evidence** — a successful production run emits
   `restore-evidence.json`, tied to the workflow run ID and attempt, commit
   SHA, artifact run ID and SHA-256, critical row counts, and API health.
7. **scratch-reset-is-scoped-and-measured** — the import resets the target
   first, but only the allowlisted restorable tables.
8. **identity-columns-preserved** — production primary keys survive the
   import, and the identity sequences are advanced past them.
9. **restore-contract-tested-on-real-schema** — every drill run first
   executes the restore contract tests against the real `migrations/` tree.

## How the import works, and why

Two properties of the real schema make a naive import impossible, and both
were invisible behind the old three-column test fixture.

**A migrated scratch database is not empty.** Migrations seed `settings`
(11 rows at migration 234). The import used to require every target table
to be empty, so every production-artifact drill failed before writing a
single row.

The import therefore **resets first**, inside the same transaction as the
import:

* Only the explicitly allowlisted restorable tables (`internal/backup`
  `backupTables`) are cleared — never an arbitrary sweep of the database.
* They are cleared in reverse foreign-key order, derived from the live
  catalog rather than hardcoded.
* `DELETE`, not `TRUNCATE ... CASCADE`. CASCADE would reach 40+ tables that
  are not restorable at all (everything with a `vehicle_id` foreign key).
* Foreign keys are still **enforced** during the reset — `session_replication_role`
  is only switched to `replica` afterwards, for the insert phase. A
  non-restorable table holding a `RESTRICT`-referencing row therefore fails
  the drill loudly instead of being silently orphaned.
* Where the schema itself declares `ON DELETE CASCADE`, dependent rows do go
  with the parent. That is the schema's contract, not a choice made by the
  drill, so the collateral is counted before and after and published as
  `collateral_rows_cleared` in `restore-result.json`. On a pristine scratch
  database it is empty; anything else is a signal that the target was not
  what you thought it was.

**Four restorable tables use `GENERATED ALWAYS AS IDENTITY`.** `vehicles`,
`alert_rules`, `geofences`, and `notification_channels` all declare
`id bigint GENERATED ALWAYS AS IDENTITY`. Inserting the artifact's explicit
primary keys into such a table fails with:

```
ERROR:  cannot insert a non-DEFAULT value into column "id"
DETAIL:  Column "id" is an identity column defined as GENERATED ALWAYS.
HINT:  Use OVERRIDING SYSTEM VALUE to override.
```

The import emits `OVERRIDING SYSTEM VALUE` for exactly those tables — never
for others, where PostgreSQL rejects the clause outright — so production
primary keys survive and the restored foreign keys still resolve. Sequences
are then advanced past the imported maximum, so the first insert after a
restore does not collide with restored data.

Every one of these properties is tested against the real migrated schema in
`internal/backuprestore/restore_realschema_test.go`, which the drill runs
before the drill itself:

```bash
docker run -d --name pg -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill \
  -p 55433:5432 timescale/timescaledb-ha:pg17
TESLASYNC_RESTORE_TEST_DATABASE_URL=postgres://drill:drill@localhost:55433/postgres?sslmode=disable \
  go test ./internal/backuprestore/ -run RealSchema -v
```

The guardrails did not weaken when the import gained the power to DELETE.
The target must still be a database whose name matches the drill pattern, it
must still carry the guard nonce — now re-checked **on the importing
connection itself, inside the transaction**, immediately before the first
destructive statement — and it must still resolve to a different database
from the source.

## RTO / RPO

`ops/restore/drill.yaml` declares:

```yaml
objectives:
  scope: Durable vehicle history and API service restoration
  rto_target: 1h
  rpo_target: 24h
  recovery_point_source: Newest checksum-verified production backup artifact
  measurement_status: pending-first-drill
  last_measured_at: ""
  last_measured_rto: ""
  last_measured_rpo: ""
  last_drill_reference: ""
```

`measurement_status` is **`pending-first-drill`**. These are targets, not
measurements — no production restore has been timed. The gate enforces
that the field is either `pending-first-drill` or `measured`, precisely
so a target can never be presented as a measured capability.

Production mode rejects artifacts older than **24 hours**, matching the RPO
target rather than the weekly drill cadence. It also fails when end-to-end
recovery exceeds one hour.

To move to `measured`:

1. Run the drill in `production-artifact` mode and download its
   `restore-drill-<run-id>-<attempt>` artifact.
2. Review `restore-evidence.json` and the linked workflow logs.
3. Commit that file unchanged as
   `ops/restore/evidence/<run-id>-<attempt>.json`.
4. Set `last_measured_at` to the UTC date (`YYYY-MM-DD`) from the evidence's
   `drill_completed_at` timestamp. Set `last_measured_rto` and
   `last_measured_rpo` to the exact durations encoded by the evidence, and set
   `last_drill_reference` to that committed path.

The restore gate parses and cross-checks the structured result. An arbitrary
repository file or URL can no longer substantiate a measured recovery claim.

## Incident ownership

The manifest assigns roles rather than repository usernames so the same
contract works for every self-hosted deployment:

| Role | Responsibility |
|---|---|
| `deployment-owner` | Accountable for invoking recovery and accepting any data-loss window |
| `platform-on-call` | Incident commander; owns severity, decisions, timeline, and 30-minute handoffs |
| `database-on-call` | Recovery lead; restores only into scratch until parity is proven |
| `deployment-owner` | Communications lead; records status and the effective RPO |
| `repository-maintainers` | Fallback when the deployment's primary roles cannot resolve a product defect |

A single-person installation may assign one person to several roles, but
must still explicitly state who is making the incident decision and who
is executing the restore. Handoff notes record: current severity, newest
verified backup timestamp, elapsed outage, current restore step, blockers,
and the next decision deadline.

## Drill failed

Work down this list; the order matters.

1. **Download the run artifact first.** It carries the parity table,
   non-sensitive restore result, API health response, logs, and structured
   evidence. Do not replace evidence from a failed attempt with a rerun.
2. **Checksum mismatch** — treat as an emergency. Existing backups may
   be unrestorable, which is the one failure here that cannot be fixed
   retroactively. Do not overwrite the artifact. Follow
   `docs/runbooks/degraded-mode-object-storage.md`.
3. **Row parity mismatch** — the import transaction rolled back because the
   artifact and restored table counts differed. Check schema compatibility
   and the exact table result before suspecting storage corruption.
4. **Restore errored mid-way** — capture the failing table. If it is
   a schema mismatch, cross-reference `ops/migrations/manifest.yaml`:
   the `rollback_notes` for recent migrations describe what a restore
   into an older schema will hit.
5. **API health failed** — inspect `scratch-api.log`; a backup that imports
   but cannot start the service does not meet the recovery objective.
6. **Storage unreachable** — this is an object-storage incident, not a
   backup-content incident. Go to
   `docs/runbooks/degraded-mode-object-storage.md`.
7. **Open an issue** labelled `ops,backup` with the run URL attached, and
   record how long the platform was without a verified artifact. That
   window is a real RPO gap.

## Do not

- Do not point the drill at the production database as a restore
  *target*. It only ever reads an artifact.
- Do not mark a drill green by re-running until it passes. An
  intermittent restore failure is a finding.
- Do not update `measurement_status: measured` without a run reference.
- Do not use archive verification time as RTO; RTO ends only after the
  restored API is healthy.

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
| `production-artifact` | required | manual, opt-in | The **actual production artifact** restores. |

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

Locally, the verifier half can be run against any database:

```bash
DATABASE_URL=postgres://… \
BACKUP_VERIFY_CRITICAL_TABLES=vehicles,drives,charging_sessions \
  go run ./cmd/backup-verify
```

## What "pass" means

From `ops/restore/drill.yaml` `success_criteria`:

1. **artifact-round-trips** — the artifact downloads with a matching
   checksum and decompresses cleanly.
2. **critical-tables-non-empty** — every table in `critical_tables`
   restores with a non-zero row count. *A "successful" backup with zero
   rows in `vehicles` is a failed backup that exited 0.*
3. **row-parity** — restored row counts equal the source counts.
4. **rto-recorded** — the wall-clock restore duration is written to the
   job summary on every run.

## RTO / RPO

`ops/restore/drill.yaml` declares:

```yaml
objectives:
  rto_target: 1h
  rpo_target: 24h
  measurement_status: pending-first-drill
```

`measurement_status` is **`pending-first-drill`**. These are targets, not
measurements — no production restore has been timed. The gate enforces
that the field is either `pending-first-drill` or `measured`, precisely
so a target can never be presented as a measured capability.

To move to `measured`: run the drill in `production-artifact` mode,
take the recorded wall-clock duration from the job summary, and update
the field in the same commit as the recorded evidence.

## Drill failed

Work down this list; the order matters.

1. **Read the job summary first.** It carries the parity table and the
   restore duration. Both are gone once you re-run.
2. **Checksum mismatch** — treat as an emergency. Existing backups may
   be unrestorable, which is the one failure here that cannot be fixed
   retroactively. Do not overwrite the artifact. Follow
   `docs/runbooks/degraded-mode-object-storage.md`.
3. **Row parity mismatch** — the restore completed but lost data.
   Usually a migration applied to the source but not the restore target,
   or a FK ordering problem. Check the migration versions on both sides
   before suspecting the artifact.
4. **Restore errored mid-way** — capture the failing statement. If it is
   a schema mismatch, cross-reference `ops/migrations/manifest.yaml`:
   the `rollback_notes` for recent migrations describe what a restore
   into an older schema will hit.
5. **Storage unreachable** — this is an object-storage incident, not a
   backup-content incident. Go to
   `docs/runbooks/degraded-mode-object-storage.md`.
6. **Open an issue** labelled `ops,backup` with the run URL attached, and
   record how long the platform was without a verified artifact. That
   window is a real RPO gap.

## Do not

- Do not point the drill at the production database as a restore
  *target*. It only ever reads an artifact.
- Do not mark a drill green by re-running until it passes. An
  intermittent restore failure is a finding.
- Do not update `measurement_status: measured` without a run reference.

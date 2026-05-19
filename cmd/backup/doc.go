// Command backup produces a portable, restorable archive of the TeslaSync
// PostgreSQL/TimescaleDB instance and uploads it to a configurable
// destination.
//
// # Why this exists
//
// TeslaSync is self-hosted infrastructure. The default deployment is a
// single-node k3s cluster running TimescaleDB on a local-path PV. That
// makes the operator the sole disaster-recovery owner — there is no
// cloud-managed Postgres taking nightly snapshots and no SRE team paging
// when the volume corrupts. The platform owes its operators a first-party
// backup story that:
//
//   - works on a stock self-hosted topology with zero extra services,
//   - works equally well with an external object store (MinIO, Backblaze
//     B2, Cloudflare R2, Wasabi, AWS S3) for off-site copies,
//   - produces an archive that survives a major-version Postgres
//     upgrade (custom pg_dump format), and
//   - exposes RPO/RTO knobs through Helm values, not editing Go code.
//
// # What it does
//
// On each invocation:
//
//  1. Reads DATABASE_* env vars (same names as the API) and BACKUP_*
//     env vars for destination + retention.
//  2. Shells out to `pg_dump --format=custom --compress=9` against the
//     configured database. Custom format is the only format that supports
//     `pg_restore --jobs=N` parallel restore and selective table restore.
//  3. Streams the dump to either:
//     - a local mount path (BACKUP_DEST=local), OR
//     - an S3-compatible bucket (BACKUP_DEST=s3, BACKUP_S3_ENDPOINT
//       points to MinIO/B2/R2/Wasabi/AWS).
//  4. Writes a sidecar manifest.json with: timestamp, git sha of the
//     producing binary, current schema_migrations version, dump size,
//     SHA-256 of the dump.
//  5. Enforces simple retention: keep last N daily + last N weekly.
//  6. Logs everything as structured zerolog so the operator can plumb
//     it into Loki/ELK/Grafana.
//
// # What it does NOT do
//
//   - It does NOT restore. Restore is `pg_restore` — documented in
//     docs/runbooks/backup-restore.md. The asymmetry is deliberate;
//     restore is a manual operation that should never be automated
//     without an operator in the loop.
//   - It does NOT back up Redis, MQTT, or MongoDB. Redis and MQTT are
//     ephemeral by design (signal state rebuilds from Postgres on next
//     telemetry tick). MongoDB is opt-in raw-capture debug storage that
//     is intentionally TTL'd; if the operator wants it backed up, they
//     can extend this binary or run mongodump in parallel.
//   - It does NOT encrypt the dump at rest. Encryption is the operator's
//     responsibility — typically via the storage layer (PVC encryption,
//     bucket-side SSE-KMS, or running `age` / `gpg` in the volume).
//     Inlining encryption here would force a key-management decision
//     this binary cannot make safely.
//
// # Exit codes
//
//	0 — backup written and uploaded successfully
//	1 — hard failure (DB unreachable, pg_dump non-zero, upload failed)
//	2 — partial: dump succeeded locally but the off-site upload failed.
//	    The CronJob is configured with restartPolicy: OnFailure so this
//	    triggers a retry. The local copy is left behind so the operator
//	    can investigate.
//
// # See also
//
//   - docs/runbooks/backup-restore.md — restore procedure + RPO/RTO.
//   - helm/teslasync/templates/cronjob-backup.yaml — scheduled run.
//   - .github/workflows/restore-test.yml — nightly restore drill.
//
// Layer: cmd-internal
package main

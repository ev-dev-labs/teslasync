# Backup & Restore — Operator Runbook

> **Audience:** operators running TeslaSync on self-hosted k3s (or any
> Kubernetes flavour).
> **Owner:** platform / SRE.
> **Last validated:** automated nightly via
> `.github/workflows/restore-test.yml`.

## TL;DR

```bash
# Enable backups to a local PVC (simplest, single-node OK):
helm upgrade teslasync ./helm/teslasync \
  --reuse-values \
  --set backup.enabled=true \
  --set backup.dest=local \
  --set backup.local.size=50Gi

# Or to a MinIO/B2/R2 bucket (recommended for off-host durability):
helm upgrade teslasync ./helm/teslasync \
  --reuse-values \
  --set backup.enabled=true \
  --set backup.dest=s3 \
  --set backup.s3.endpoint=https://s3.us-west-002.backblazeb2.com \
  --set backup.s3.bucket=teslasync-prod \
  --set backup.s3.accessKey=<KEY> \
  --set backup.s3.secretKey=<SECRET>
```

A CronJob runs daily at **03:30 UTC** (`backup.schedule`), produces a
custom-format `pg_dump`, writes a JSON manifest sidecar containing
`{ dump_sha256, dump_bytes, schema_migration }`, and prunes older
copies down to `retainDailyCopies` + `retainWeeklyCopies`.

---

## What is backed up

| Component        | Backed up? | Why                                                                |
|------------------|-----------:|--------------------------------------------------------------------|
| TimescaleDB      |     **✓**  | The system of record. Captured with `pg_dump --format=custom -Z9`. |
| Schema migrations |    **✓**  | Captured implicitly (it’s a table inside the same DB).             |
| Redis            |        —   | Ephemeral L2 cache + SSE bus. Cold-rebuilt from signal_log.        |
| MQTT             |        —   | Transient ingest broker. Vehicles re-deliver on reconnect.         |
| MongoDB          |        —   | Opt-in debug capture only (TTL’d).                                 |
| Object storage   |        —   | Not used today.                                                    |

If you add a new stateful component, decide explicitly whether it
needs backup and update both this runbook and the CronJob template.

---

## Recovery objectives

| Objective | Default | Knob                                          |
|-----------|--------:|-----------------------------------------------|
| **RPO**   |    24 h | `backup.schedule` (cron). Tighten to hourly with `"0 * * * *"`. |
| **RTO**   |   ~10 min for ≤5 GB dumps | dominated by `pg_restore --jobs=N`; scales with DB size and disk speed. |

These are *targets*, not contracts — measure your own restore time
quarterly and adjust the schedule + retention to match your DR plan.

---

## Storage backends

### `dest=local` (PVC)

Single-PVC backup target. Suitable when the cluster’s PVCs themselves
live on storage that you snapshot out-of-band (e.g. a NAS with ZFS
snapshots, a longhorn replica, an external Restic job).

**Do not** treat a local PVC as your only backup — a corrupted PVC
takes both production AND the backups with it.

### `dest=s3` (S3-compatible)

Works with any S3-compatible endpoint by setting
`backup.s3.endpoint`. Verified targets:

| Provider          | Endpoint                                                |
|-------------------|---------------------------------------------------------|
| AWS S3            | *(leave blank)*                                         |
| MinIO (in-cluster)| `http://minio.minio.svc.cluster.local:9000`             |
| Backblaze B2      | `https://s3.us-west-002.backblazeb2.com`                |
| Cloudflare R2     | `https://<accountid>.r2.cloudflarestorage.com`          |
| Wasabi            | `https://s3.eu-central-1.wasabisys.com`                 |

`backup.s3.pathStyle: true` is the safe default. AWS and R2 also
accept it; MinIO and B2 require it.

**Credentials**: either pass `accessKey`/`secretKey` directly to Helm
(chart will create the secret) or pre-create a secret with
`access-key`/`secret-key` keys and point `backup.s3.credentialsSecret`
at it. The second form is the right choice when ExternalSecrets,
sealed-secrets, or SOPS owns your secret material.

---

## Encryption

The backup binary deliberately does **not** encrypt. Choose one (or
more) of:

1. **Bucket-side SSE-KMS** — most operationally trivial; the cloud
   provider holds the key.
2. **PVC encryption** — for `dest=local`, mount on a LUKS-backed PV.
3. **Operator-managed at-rest tooling** — wrap the dump with `age` or
   `gpg` in an external job pipeline.

If your threat model includes "the backup bucket is read by the wrong
party", option 3 is the only one that survives a misconfigured bucket
policy.

---

## Manifest schema

Every dump is accompanied by `<dump-basename>.manifest.json`:

```json
{
  "version": 1,
  "created_at": "2026-05-18T03:30:14.713Z",
  "schema_migration": 198,
  "database_host": "teslasync-postgresql",
  "database_name": "teslasync",
  "dump_file": "teslasync-20260518T033014Z.dump",
  "dump_bytes": 4218291,
  "dump_sha256": "8f1c…b4d2",
  "dump_format": "custom",
  "pg_dump_compress_level": 9
}
```

`schema_migration` is the authoritative pointer to the migration set
the dump was produced against. **Restoring a dump on a newer
codebase is fine; the migration runner will roll forward. Restoring
on an OLDER codebase will fail loudly.**

---

## Restore procedure

> Test this procedure in a non-production namespace at least once per
> quarter. The automated CI workflow at
> `.github/workflows/restore-test.yml` proves the round-trip every
> night but is not a substitute for an operator drill.

### 0. Stop writes (graceful)

```bash
kubectl scale deploy/teslasync-api --replicas=0
kubectl scale deploy/teslasync-notification-worker --replicas=0
kubectl scale deploy/teslasync-export-worker --replicas=0
kubectl scale deploy/teslasync-automation-worker --replicas=0
kubectl scale deploy/teslasync-command-proxy --replicas=0
```

Leave Postgres and Redis running. The pipeline subscriber will buffer
in MQTT and pick up after restore.

### 1. Locate and verify the dump

```bash
# Local PVC
kubectl exec -it deploy/teslasync-api -- ls -lh /backups
# … or for s3:
aws s3 ls s3://teslasync-prod/ --endpoint-url https://...

# Verify integrity before doing anything destructive
sha256sum dump.dump          # must match manifest.dump_sha256
jq . dump.dump.manifest.json # confirm schema_migration is what you expect
```

### 2. Create a restore target

Decide whether to restore in-place (destructive) or to a parallel DB
and cut over.

**Parallel restore (preferred):**

```sql
CREATE DATABASE teslasync_restore;
```

**In-place restore:** drop and recreate the existing DB. Make
absolutely sure no consumer is connected.

### 3. Run `pg_restore`

```bash
pg_restore \
  --host=$DATABASE_HOST \
  --username=$DATABASE_USER \
  --dbname=teslasync_restore \
  --no-owner --no-privileges \
  --jobs=4 \
  /path/to/dump.dump
```

`--jobs=4` parallelises restore across cores. `--no-owner` /
`--no-privileges` are appropriate when the dest user differs from
prod.

### 4. Confirm schema_migrations is current

```bash
psql -d teslasync_restore -c "SELECT version, dirty FROM schema_migrations;"
```

If the code you’re about to run is **newer** than `version`, run
`migrate up` to roll forward. If the code is **older**, abort and
either restore on the right code version or move forward in code.

### 5. Cut over

If you used parallel restore, rename:

```sql
ALTER DATABASE teslasync RENAME TO teslasync_pre_restore_TIMESTAMP;
ALTER DATABASE teslasync_restore RENAME TO teslasync;
```

### 6. Bring writers back

```bash
kubectl scale deploy/teslasync-api --replicas=2
kubectl scale deploy/teslasync-notification-worker --replicas=1
kubectl scale deploy/teslasync-export-worker --replicas=1
kubectl scale deploy/teslasync-automation-worker --replicas=1
kubectl scale deploy/teslasync-command-proxy --replicas=1
```

### 7. Post-restore sanity

```bash
# Vehicles list returns:
curl -s https://teslasync.example/api/v1/vehicles | jq 'length'

# Latest signal arrived recently:
psql -d teslasync -c "SELECT MAX(ts) FROM signal_log;"

# FSM transitions are flowing:
psql -d teslasync -c "SELECT COUNT(*) FROM fsm_transitions WHERE ts > NOW() - INTERVAL '5 min';"
```

If any of the three is wrong, page on-call and consider rolling back
to `teslasync_pre_restore_TIMESTAMP`.

---

## Failure modes and how to react

| Symptom                                              | Likely cause                                                   | Action                                                                                          |
|------------------------------------------------------|----------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| CronJob exits 0 but no dump appears                  | PVC not mounted or `BACKUP_LOCAL_PATH` wrong                   | `kubectl describe job` → check volumeMounts.                                                    |
| CronJob exits 2                                      | Dump succeeded, upload failed (partial)                        | Check the bucket / PVC, retry the job; the staged dump is in `/tmp` of the pod (lost on exit). |
| CronJob exits non-zero != 2                          | `pg_dump` failure — auth, connectivity, version skew           | Read pod logs; `pg_dump` stderr is line-logged at warn level.                                   |
| Restore complains about missing extensions           | TimescaleDB extension not pre-installed on the target server   | `CREATE EXTENSION timescaledb;` on target before `pg_restore`.                                  |
| Restore-test workflow goes red                       | Backup binary is broken                                        | **P0 page** — open the workflow logs, the failed artifact is uploaded for 3 days.               |
| Dump sha256 mismatch                                 | Storage layer corruption between write and read                | Do **not** restore. Treat the dump as poisoned. Investigate storage path.                       |

---

## Operational checklist (quarterly)

- [ ] Perform a manual restore drill into a scratch namespace.
- [ ] Confirm `restore-test.yml` has been green for the last 30 days.
- [ ] Verify the dump size trend is sane (TimescaleDB chunk growth).
- [ ] Confirm off-site copy is current (S3 bucket lifecycle inventory).
- [ ] Rotate S3 credentials.
- [ ] Re-read this runbook and update anything that has drifted.

---

## Related

- `cmd/backup/doc.go` — design rationale for the binary.
- `helm/teslasync/templates/cronjob-backup.yaml` — workload manifest.
- `helm/teslasync/values.yaml` (`backup:` block) — all knobs.
- `.github/workflows/restore-test.yml` — nightly drill.

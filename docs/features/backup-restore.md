# Backup & Restore

A self-hosted platform is your responsibility. TeslaSync ships with operational tooling to make that responsibility manageable, but it does **not** replace the discipline of regular off-host backups. This page covers what you need to back up, the strategy that matches different recovery goals, the in-app backup tooling, and the restore drill you should rehearse before you need it.

## What can go wrong

Before "what to back up", be honest about which failure modes you're protecting against. Different modes need different backups:

| Failure                                          | What recovers you                                                |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Single accidentally-deleted vehicle / drive      | App-level restore from the in-app backup page                    |
| Database corruption / botched migration          | PostgreSQL physical backup or PITR (point-in-time recovery)      |
| Host loss (disk, VM, cluster node)               | Volume snapshot + database dump on external storage              |
| Region loss / fire                               | Off-site copy of the snapshots / dumps                           |
| Encryption-key loss                              | Off-site copy of the key material (this is the one people forget) |
| Tesla credentials revoked                        | Re-OAuth flow — no backup helps, but you need to be told fast    |

## What to back up

| Data                              | Volume                        | Frequency        | Why                                                                             |
| --------------------------------- | ----------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| **PostgreSQL / TimescaleDB**      | Grows continuously            | Nightly + WAL    | Vehicles, encrypted tokens, settings, drives, charging, signals, alerts, AI audit log, embeddings |
| **Redis**                         | Small, ephemeral              | Optional         | L2 live cache + AI rate-limit counters; restorable from telemetry within minutes |
| **Mosquitto persistence**         | Small                         | Optional         | Only if you've enabled persistent MQTT sessions                                  |
| **Grafana**                       | Small                         | Weekly           | Dashboard definitions, datasources, users                                        |
| **MongoDB**                       | Variable                      | Nightly if used  | Raw signal capture (debugging only)                                              |
| **Encryption keys**               | A few hundred bytes           | Once + on change | The AES-GCM key that wraps Tesla tokens in the database                          |
| **Tesla provider config**         | Trivial                       | Once + on change | `.env`, Helm values, secrets references                                          |
| **Generated export files**        | Variable                      | n/a              | Re-runnable from source data; don't need separate backup                         |
| **Logs**                          | Operational only              | Retention policy | For incident analysis, not for restore                                           |

The asymmetric thing here is the **encryption keys**. If you back up the database and lose the wrapping key, every Tesla token in the dump is irrecoverable — you'll need every user to re-authorise. Store the key material in your secret manager (Vault, AWS Secrets Manager, Kubernetes Secrets backed by KMS) and treat it with the same paranoia you treat your TLS private keys.

## Recovery goals (RPO / RTO)

Two numbers drive everything else:

- **RPO (Recovery Point Objective)** — how much data are you willing to lose? "Last night's backup" = up to 24 hours.
- **RTO (Recovery Time Objective)** — how long can the service be down? "Restore from snapshot" = tens of minutes.

A reasonable starting point for self-hosted:

| Tier       | RPO    | RTO    | Strategy                                                                |
| ---------- | ------ | ------ | ----------------------------------------------------------------------- |
| Hobby      | 24 h   | 2 h    | Nightly `pg_dump` + filesystem snapshot to a NAS; keep 14 days          |
| Serious    | 1 h    | 30 min | Nightly base + WAL shipping; on-host hot standby; snapshots off-site    |
| Production | 5 min  | 15 min | Continuous WAL to object storage; warm standby; PITR rehearsed quarterly |

The in-app backup page is intended as a **supplement** to one of these — not a replacement.

## The in-app backup page

`/admin/backup` is an app-level export / restore tool. It produces a single archive (`.tar.gz`) containing the user-visible state of the platform — vehicle list, settings, alert rules, automations, notification channels, geofences, locations, dashboards — and a manifest of which rows came from which tables.

It does **not** contain the bulk telemetry hypertables, the AI call audit log, or the raw signal capture. Those grow forever and belong in your real database backup.

What the in-app backup is good for:

- Migrating from one self-hosted instance to another while keeping your configuration
- Snapshotting your alert rules and automations before a risky change so you can roll back the configuration without rolling back telemetry
- Sharing a starter configuration with another user

What it is **not** good for:

- Disaster recovery — use database-level backups for that
- Audit / compliance — use the audit log + database backups for that
- Restoring a deleted drive — the source data is in the telemetry hypertables, not the archive

The page exposes:

- **Create backup** — produces a fresh archive and shows its size + row counts
- **Download** — fetches the archive (signed URL, expires in 15 min)
- **Upload & restore** — uploads an archive and replays it, with a dry-run + diff option

Restores are transactional per domain (vehicles, alerts, automations, etc.) so a partially-broken archive doesn't leave you in a half-restored state.

## A database backup playbook that actually works

For PostgreSQL / TimescaleDB, the simplest correct setup:

```bash
# Nightly logical dump, compressed, with parallelism
docker compose exec -T postgres pg_dump \
  -U teslasync -d teslasync \
  --format=directory --jobs=4 --compress=9 \
  --file=/backups/teslasync-$(date +%F)

# Filesystem snapshot of the directory afterwards
zfs snapshot tank/backups@teslasync-$(date +%F)

# Off-host copy
rclone copy /backups remote:teslasync-backups --transfers=4
```

For Kubernetes, the same idea using a `CronJob` against the database service. WAL shipping (`pg_basebackup` + `wal-g` to object storage) is the right next step when 24-hour RPO isn't acceptable.

## The restore drill

A backup you've never restored is a hope, not a backup. Rehearse this at least once before you trust the setup:

1. Spin up a fresh empty instance in a staging namespace / host
2. Restore the latest database dump into it
3. Apply the latest `.env` / Helm values (with staging Tesla credentials)
4. Bring up the API and check:
   ```bash
   curl http://staging/healthz
   curl http://staging/readyz
   psql -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;"
   psql -c "SELECT COUNT(*) FROM vehicles;"
   psql -c "SELECT extname FROM pg_extension WHERE extname IN ('timescaledb','vector');"
   ```
5. Re-authorise Tesla (you probably want a staging Tesla app for this)
6. Open the dashboard, replay a drive, check that the AI audit log is intact (if you use Helix)
7. Tear down

Do this quarterly. Document the time it took. That's your real RTO.

## What to do when something is actively burning

The order matters when an instance is down:

1. **Stop the bleeding** — pause workers if they're making things worse; don't let `automation-worker` fire 200 missed automations the moment you bring it back up
2. **Confirm scope** — is it the database, the API, the worker, or the host? `healthz` / `readyz` / `pg_isready` answer different questions
3. **Restore from the most recent uncorrupted backup** — not the most recent backup if you're not sure it's clean
4. **Bring up the API in read-only mode if your platform supports it** — let users see their data while you finish recovery
5. **Replay telemetry** — Fleet Telemetry vehicles will refill the live store quickly; polling will catch up on its own schedule
6. **Disable automations until you're confident the rule state is correct** — then re-enable in batches

A `/internal/flush` endpoint exists for graceful shutdown. Use it from PreStop hooks to drain in-flight writes before pods terminate. There's no "panic stop" — graceful is always faster overall.

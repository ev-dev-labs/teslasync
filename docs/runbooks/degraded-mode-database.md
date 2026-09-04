# Degraded mode: PostgreSQL / TimescaleDB

**Criticality:** critical — Postgres is the system of record. There is no
read fallback for durable data.

Registered in `ops/runbooks/dependencies.yaml` (`database`).

## Symptoms

- `/readyz` reports `"database": "unhealthy"` or `"database_writes": "unhealthy"`,
  and the pod drops out of Service endpoints.
- `/healthz` remains healthy because liveness intentionally does not query
  PostgreSQL. A database stall is not repaired by restarting the API.
- 5xx ratio climbs on list/analytics endpoints first (they hold a
  connection longest), then spreads to every read.
- Logs contain `pool exhausted`, `context deadline exceeded`, or
  `connection refused` from `internal/database`.
- The `slo:api_availability` burn-rate alert fires.

## Confirm

```bash
kubectl -n "$NS" exec deploy/"$RELEASE"-api -- wget -qO- localhost:8080/readyz
kubectl -n "$NS" logs deploy/"$RELEASE"-api --since=10m | grep -Ei 'pool|deadline|refused'
kubectl -n "$NS" get pods -l app.kubernetes.io/component=postgresql
kubectl -n "$NS" port-forward svc/"$RELEASE"-api 8080:8080
curl -s http://127.0.0.1:8080/metrics | grep -E \
  'teslasync_database_pool_(connections|utilization_ratio|empty_acquire|canceled_acquire|acquire_duration)'
```

Then check whether the database is *down* or merely *saturated*:

```sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
SELECT pid, now() - query_start AS age, left(query, 120)
  FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC LIMIT 20;
SELECT * FROM pg_locks WHERE NOT granted;
```

A long-running `CREATE INDEX` or `ALTER TABLE` in `pg_locks` means a
migration is the cause — cross-reference `ops/migrations/manifest.yaml`
for its recorded `lock_risk` and `expected_duration`.

## Immediate mitigation

1. **Stop making it worse.** Pause any in-flight rollout:
   `helm upgrade "$RELEASE" … --set rollout.paused=true`.
2. **If saturation:** the pgx pool is capped at `DATABASE_MAX_CONNS`
   (default 12 for the API; each worker defaults to 2). A sustained
   `teslasync_database_pool_utilization_ratio` near `1`, increasing
   `pool_empty_acquire_count`, or increasing
   `pool_empty_acquire_wait_seconds` confirms connection pressure.
   Terminate the specific offenders rather than restarting the API, which
   only re-queues the same work:
   `SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE now() - query_start > interval '5 min' AND state <> 'idle';`
3. **If the write breaker is open:** leave it open. It is shedding load
   deliberately. Fix the underlying write failure; it half-opens on its
   own and `/readyz` follows.
4. **If Postgres is down:** the API pods are already out of the Service.
   Do not scale the API up — it will not help and adds connection
   pressure when the database returns.

## Recovery

1. Restore the database (restart the pod, fail over to the replica, or
   restore a backup — see `docs/runbooks/backup-restore-drill.md`).
2. Wait for `/readyz` to report `"database": "ok"` on its own. The
   readiness gate re-admits the pod automatically; no restart is needed.
3. If a migration was the trigger, decide with
   `ops/migrations/manifest.yaml`: entries marked
   `forward_compatible: true` should be **left applied** while you roll
   the application back. Only run `migrate down` when the entry's
   `rollback_notes` explicitly says to.
4. If you rolled the application back, re-run the rollback evaluator so
   the decision is recorded rather than remembered.

## Verify

```bash
go run ./cmd/smoke-gate -base-url "https://$HOST" -manifest ops/smoke/checks.yaml
```

Then confirm the burn-rate alert has cleared and `signal_log` is
advancing again:

```sql
SELECT max(ts) FROM signal_log;
```

Ingest is only healthy once that timestamp is moving; a healthy
`/readyz` with a frozen `signal_log` means MQTT is the real problem —
switch to `docs/runbooks/degraded-mode-mqtt.md`.

## Escalation

Page the on-call platform engineer if the database is unavailable for
more than 15 minutes, or immediately if data loss is suspected (failed
restore, corrupted WAL, or a migration that ran partially). Attach the
`pg_stat_activity` and `pg_locks` output captured in **Confirm** — it is
gone once the database restarts.

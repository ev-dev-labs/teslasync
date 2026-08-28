# Degraded mode: Redis

**Criticality:** degraded-tolerable. Redis is the L2 shared live-signal
cache and the SSE fan-out bus. Losing it degrades cross-pod behaviour;
it does not stop ingest and it does not lose durable data.

Registered in `ops/runbooks/dependencies.yaml` (`redis`).

## Symptoms

- Live values differ between browser sessions depending on which API pod
  they hit — each pod is answering from its own in-process
  `signal.Store` L1 instead of the shared L2.
- SSE clients only receive events produced by the pod they happen to be
  attached to; dashboards look "stuck" for some users and live for
  others.
- Postgres read QPS steps up sharply as cached responses start missing.
- API latency rises without any corresponding rise in error rate.

## Confirm

```bash
kubectl -n "$NS" get pods -l app.kubernetes.io/component=redis
kubectl -n "$NS" exec deploy/"$RELEASE"-redis -- redis-cli ping
kubectl -n "$NS" logs deploy/"$RELEASE"-api --since=10m | grep -i redis
```

Check whether the shared live state is actually present:

```bash
kubectl -n "$NS" exec deploy/"$RELEASE"-redis -- redis-cli --scan --pattern 'vehicle:*:signals' | head
```

An empty scan with a healthy `PING` means the writers stopped, not the
server — check the API logs for repeated `HSET` failures.

## Immediate mitigation

1. Confirm ingest is unaffected: Redis must never be a synchronous
   blocker for MQTT (ADR-007). If ingest *has* stopped, Redis is not
   your problem — go to `docs/runbooks/degraded-mode-mqtt.md`.
2. If cross-pod reads are returning stale or nonsense values, flip the
   documented rollback switch so every pod reads its own L1 only:

   ```bash
   helm upgrade "$RELEASE" … --set fleetTelemetry.liveSignalStoreMode=local
   ```

   This is `LIVE_SIGNAL_STORE_MODE=local`. It is the supported
   degraded mode, not a hack.
3. If Redis is merely slow, do **not** raise `maxmemory` blindly — the
   deployment is capped deliberately. Check for eviction first:
   `redis-cli info stats | grep evicted_keys`.

## Recovery

1. Restore Redis (restart the pod; the AOF volume replays on start).
2. Live state re-populates automatically: the pipeline writes every
   signal to the L2 HSET on the next change, and pods rehydrate from
   `signal_log` on restart. No manual backfill is required.
3. Return `LIVE_SIGNAL_STORE_MODE` to `hybrid` once the shared cache is
   healthy, and confirm cross-pod reads agree again.
4. Treat any live value older than two minutes as stale, per the ADR-007
   layered live-state contract.

## Verify

```bash
go run ./cmd/smoke-gate -base-url "https://$HOST" -manifest ops/smoke/checks.yaml
kubectl -n "$NS" exec deploy/"$RELEASE"-redis -- redis-cli --scan --pattern 'vehicle:*:signals' | head
```

Open two browser sessions against different pods and confirm they show
the same live values and both receive SSE updates.

## Escalation

Page only if the degraded mode is *also* failing — i.e. per-pod L1 reads
are wrong, or `signal_log` writes are failing. A plain Redis outage with
`LIVE_SIGNAL_STORE_MODE=local` in effect is a business-hours issue, not
a page. Note that SSE fan-out is not durable replay: clients recover
missed state by polling, so a Redis outage does not require a data
backfill.

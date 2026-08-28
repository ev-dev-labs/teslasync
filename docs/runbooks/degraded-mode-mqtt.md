# Degraded mode: MQTT broker / Fleet Telemetry transport

**Criticality:** critical for ingest. MQTT is the *only* path by which
Tesla Fleet Telemetry reaches the platform, and it also carries the
internal `teslasync/*` worker topics.

Registered in `ops/runbooks/dependencies.yaml` (`mqtt`).

## Symptoms

- `signal_log` stops advancing: charts flatline at a fixed timestamp
  while the API stays perfectly healthy for historical reads.
- The `telemetry_freshness` SLO burns; `mqtt_no_backlog` may follow.
- Drive/charge sessions never close, because the FSM stops seeing the
  transitions that end them.
- API logs show reconnect attempts from `resilience.ConnectWithRetry`.

## Confirm

```bash
kubectl -n "$NS" get pods -l app.kubernetes.io/component=mosquitto
kubectl -n "$NS" logs deploy/"$RELEASE"-api --since=15m | grep -i 'mqtt\|PipelineSubscriber'
```

The boot-time sanity line must be present after any restart:

```
"phase-42 PipelineSubscriber started" topic=telemetry/+/v/+ codec_failure_disposition=dlq_ack
```

Distinguish the three failure shapes — they have different fixes:

| Shape | Evidence | Meaning |
|---|---|---|
| Broker down | `connection refused`, pod not Running | Transport failure |
| Connected, no messages | Subscriber started, `signal_log` frozen | Tesla stopped publishing, or the subscription lapsed |
| Connected, messages dropped | `tesla_router_writer_failures_total` climbing | Ingest works; a **writer** is failing (usually the database) |

```sql
SELECT max(recorded_at) FROM signal_log;
```

## Immediate mitigation

1. **Broker down:** restart Mosquitto. The persistence volume replays
   retained messages; Fleet Telemetry redelivers a bounded backlog on
   reconnect, so a short outage is self-healing.
2. **Connected but silent:** the vehicle subscription has probably
   lapsed. Re-establish it:

   ```bash
   kubectl -n "$NS" exec deploy/"$RELEASE"-api -- /app/resubscribe
   ```

3. **Writer failures:** do **not** chase MQTT. `tesla_router_writer_failures_total`
   means the codec succeeded and a destination write failed. Writer
   failures are logged and counted but never propagated to MQTT
   redelivery (ADR-004), precisely so a stuck table cannot block the
   whole stream. Go to `docs/runbooks/degraded-mode-database.md`.
4. Check the DLQ before assuming data was lost — codec failures are
   acked and routed to the DLQ rather than redelivered as poison pills.

## Recovery

1. Restore the broker or the subscription.
2. Confirm ingest resumes: `max(recorded_at)` in `signal_log` must start
   moving within a minute.
3. Reconcile any sessions the FSM missed. The 15s reconciliation loop
   closes stale drive/charge sessions on its own; verify no session is
   stuck open with an `ended_at` far in the past.
4. Replay the DLQ only after the root cause is fixed, and only via the
   audited replay path so the action is recorded.

## Verify

```bash
go run ./cmd/smoke-gate -base-url "https://$HOST" -manifest ops/smoke/checks.yaml
```

Then confirm freshness has recovered by watching `telemetry_freshness`
return inside its SLO and by opening a vehicle page — live values should
update without a manual refresh (that also proves SSE fan-out survived).

## Escalation

Page immediately if ingest has been stopped for more than 15 minutes:
telemetry gaps are permanent — there is no way to backfill data Tesla
did not deliver. Capture the DLQ depth and the last `signal_log`
timestamp before restarting anything.

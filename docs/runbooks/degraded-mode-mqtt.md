# Degraded mode: MQTT broker / Fleet Telemetry transport

**Criticality:** critical for ingest. MQTT is the *only* path by which
Tesla Fleet Telemetry reaches the platform, and it also carries the
internal `teslasync/*` worker topics.

Registered in `ops/runbooks/dependencies.yaml` (`mqtt`).

## Symptoms

- `signal_log` stops advancing: charts flatline at a fixed timestamp
  while the API stays perfectly healthy for historical reads.
- The `telemetry_freshness` or `mqtt_pipeline_subscription` SLO burns.
- Drive/charge sessions never close, because the FSM stops seeing the
  transitions that end them.
- API logs show reconnect attempts from `resilience.ConnectWithRetry`.

## Confirm

```bash
kubectl -n "$NS" get pods -l app.kubernetes.io/component=mosquitto
kubectl -n "$NS" logs deploy/"$RELEASE"-api --since=15m | grep -i 'mqtt\|PipelineSubscriber'
kubectl -n "$NS" port-forward svc/"$RELEASE"-api 8080:8080
curl -s http://127.0.0.1:8080/metrics | grep 'teslasync_mqtt_pipeline_'
```

The boot-time sanity line must be present after any restart:

```
"phase-42 PipelineSubscriber started" topic=telemetry/+/v/+ codec_failure_disposition=dlq_ack
```

Distinguish the three failure shapes — they have different fixes:

| Shape | Evidence | Meaning |
|---|---|---|
| Broker down | `connection refused`, pod not Running | Transport failure |
| Dedicated client disconnected, auxiliary client connected | `teslasync_mqtt_pipeline_connected 0`, `teslasync_mqtt_connected 1` | Consumer-specific transport wedge; liveness restarts the API after its grace window |
| Connected, subscription absent | `teslasync_mqtt_pipeline_connected 1`, `teslasync_mqtt_pipeline_subscribed 0` | SUBSCRIBE/SUBACK failure; the supervisor retries every 5 seconds |
| Connected and subscribed, no messages | Both pipeline gauges are `1`, `signal_log` frozen | Tesla or the vehicle stopped publishing |
| Connected, messages dropped | `tesla_router_writer_failures_total` climbing | Ingest works; a **writer** is failing (usually the database) |
| Handlers admitted faster than persistence completes | `tesla_mqtt_persistence_admission_wait_seconds` or `tesla_mqtt_persistence_queue_wait_seconds` rising | Database backpressure is active; inspect pool pressure before changing MQTT |
| Coalesced writes timing out | `tesla_mqtt_persistence_batches_total{outcome="timeout"}` rising | PostgreSQL acquisition or execution exceeded the persistence deadline |

```sql
SELECT max(ts) FROM signal_log;
```

## Immediate mitigation

1. **Broker down:** restore Mosquitto. Do not restart the API repeatedly:
   liveness deliberately stays healthy during a broker-wide outage while
   paho reconnects in the background.
2. **Consumer disconnected or unsubscribed while the broker is reachable:**
   wait through the 90-second liveness grace. The subscriber retries failed
   subscriptions every 5 seconds; if its dedicated connection remains wedged,
   Kubernetes restarts only the API pod.
3. **Connected and subscribed but silent:** the vehicle subscription has probably
   lapsed. Re-establish it:

   ```bash
   kubectl -n "$NS" exec deploy/"$RELEASE"-api -- /app/resubscribe
   ```

4. **Writer failures:** do **not** chase MQTT. `tesla_router_writer_failures_total`
   means the codec succeeded and a destination write failed. Writer
   failures are logged and counted but never propagated to MQTT
   redelivery (ADR-004), precisely so a stuck table cannot block the
   whole stream. Go to `docs/runbooks/degraded-mode-database.md`.
5. **Persistence pressure:** keep the bounded defaults unless measurements
   show the database has headroom. Increasing
   `FLEET_TELEMETRY_PERSISTENCE_CONCURRENCY` can recreate pool saturation;
   prefer a slightly larger `FLEET_TELEMETRY_BATCH_MS` to coalesce more
   same-timestamp fields with fewer statements.
6. Check the DLQ before assuming data was lost — codec failures are
   acked and routed to the DLQ rather than redelivered as poison pills.

## Recovery

1. Restore the broker or the subscription.
2. Confirm ingest resumes: `max(ts)` in `signal_log` must start
   moving within a minute.
3. Reconcile any sessions the FSM missed. The 15s reconciliation loop
   closes stale drive/charge sessions on its own; verify no session is
   stuck open with an `ended_at` far in the past.
4. Replay the DLQ only after the root cause is fixed, and only via the
   audited replay path so the action is recorded.

The embedded broker retains up to 10,000 QoS 1/2 messages per offline
persistent client. This is restart headroom, not a health signal:
`teslasync_mqtt_consumer_backlog` counts messages already inside API handlers
and cannot report Mosquitto's offline queue depth. For an external broker,
configure and monitor its persistent-session queue independently. The bundled
broker snapshots session state every five seconds, so a hard power loss may
still lose the most recent unsaved broker state; only an orderly node drain or
an upstream replay source can close that final window.

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
did not deliver. Capture the broker's persistent-session queue depth, the
four `teslasync_mqtt_pipeline_*` metrics, and the last `signal_log` timestamp
before restarting anything.

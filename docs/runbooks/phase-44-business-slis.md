# Phase-44: Business SLI metrics

> **Status:** active (Phase-44 prompt 0022).
> **Owner:** Observability working group.
> **Companion runbooks:**
> - [`phase-44-metrics-conventions.md`](./phase-44-metrics-conventions.md) — generic HTTP RED metric vocabulary
> - [`phase-44-context-propagation-audit.md`](./phase-44-context-propagation-audit.md)

This runbook documents the business-critical Prometheus series declared in
[`internal/metrics/business.go`](../../internal/metrics/business.go) and
[`internal/metrics/metrics_telemetry.go`](../../internal/metrics/metrics_telemetry.go).
These complement the per-route HTTP RED metrics with deeper insight into
ingestion freshness, FSM agreement, pipeline throughput, MQTT pressure, and
upstream-API health.

## Metrics catalogue

| Metric                                                       | Type        | Labels         | Source                                                                                  |
|--------------------------------------------------------------|-------------|----------------|------------------------------------------------------------------------------------------|
| `teslasync_telemetry_lag_seconds`                            | gauge       | `vehicle_id`   | Refresher goroutine ticks every `interval`; emits `now - lastSeen` per known vehicle.   |
| `teslasync_fsm_state_correctness_ratio`                      | gauge       | `vehicle_id`   | Periodic reconciliation pass calls `SetFSMStateCorrectness(vid, ratio)`.                 |
| `teslasync_normalize_pipeline_throughput_signals_per_second` | gauge       | (none)         | Each `normalize.Pipeline.Process*` batch publishes `signal.count / batch_duration`.      |
| `teslasync_mqtt_consumer_backlog`                            | gauge       | (none)         | Inc on `mqtt.consume` entry, Dec on exit (success / drop / panic / non-ack error).       |
| `teslasync_mqtt_pipeline_connected`                          | gauge       | `consumer`     | Dedicated persistent Fleet Telemetry client transport state.                            |
| `teslasync_mqtt_pipeline_subscribed`                         | gauge       | `consumer`     | Last acknowledged Fleet Telemetry subscription state.                                   |
| `teslasync_mqtt_pipeline_subscription_attempts_total`        | counter     | `trigger,result` | Initial, reconnect, and supervisor SUBSCRIBE outcomes.                                |
| `teslasync_mqtt_pipeline_liveness_unhealthy_seconds`         | gauge       | `consumer`     | Restart-eligible consumer wedge duration while the broker is independently reachable.   |
| `teslasync_tesla_api_circuit_breaker_state`                  | gauge       | `endpoint`     | `SetTeslaAPICircuitBreakerState(endpoint, state)` from the resilience layer.             |

### `teslasync_telemetry_lag_seconds`

Stamps the per-vehicle "last received signal" time (via
`metrics.RecordSignalReceived(vehicleID, ts)`) on every successful write
through `signal.HybridLiveSignalStore.Update` and `.UpdateNonBlocking`.

A background ticker started by
`metrics.StartTelemetryLagRefresher(interval, stop)` walks the registry
every `interval` and writes `(now - lastSeen).Seconds()` to the gauge for
every vehicle. This produces a freshness signal that keeps decaying even
when no new samples arrive (unlike a stamp-on-write gauge, which would
freeze at ingestion time).

**SLO target:** `telemetry_lag_seconds < 60` for any vehicle that should
be online (i.e., FSM in `online` / `driving` / `charging`).

### `teslasync_fsm_state_correctness_ratio`

Per-vehicle gauge in `[0, 1]`. `1.0` = the FSM's current state agrees
with the most recent raw signal value (`Gear` → drive state, `ChargeState`
→ charging state, etc.) at the most recent reconciliation pass. `0.0` =
either no raw signal observed yet, or the FSM has fully diverged.

The reconciliation pass is owned by the FSM subsystem (separate prompt;
not yet wired). Until then, callers can call
`metrics.SetFSMStateCorrectness("vehicle-1", 1.0)` from any verification
job. The helper clamps the input to `[0, 1]`.

**SLO target:** `min over (5m) (fsm_state_correctness_ratio) >= 0.99` per
vehicle.

### `teslasync_normalize_pipeline_throughput_signals_per_second`

Throughput gauge written from `normalize.batchSpan.stop()` in
[`internal/tesla/normalize/tracing.go`](../../internal/tesla/normalize/tracing.go):
each batch divides `signal.count` by the batch's wall-clock duration and
publishes the result. Empty batches and zero-duration batches are skipped.

This is intentionally a gauge (not a counter rate) so dashboards can show
instantaneous throughput at the natural batch granularity without
PromQL `rate()` smoothing.

**SLO target:** depends on deployment; align with the RED latency p95
ceiling. A drop to zero while `mqtt_consumer_backlog > 0` indicates the
pipeline has stalled.

### `teslasync_mqtt_consumer_backlog`

Incremented by `metrics.IncMQTTConsumerBacklog()` at the entry of
`PipelineSubscriber.onPipelineMessage` (in
[`internal/mqtt/mqtt.go`](../../internal/mqtt/mqtt.go)). Decremented via
`defer metrics.DecMQTTConsumerBacklog()` so every code path (happy,
drop, panic, redeliver) eventually balances.

Steady-state value is near zero. Sustained growth indicates that
downstream stages (normalize / writers / DB) cannot keep up with MQTT
ingest rate.

**SLO target:** `mqtt_consumer_backlog < 100` sustained over `5m`.

This gauge is **not** the broker-side persistent-session queue. Mosquitto's
offline queue can grow while this gauge remains zero because messages have not
yet entered an API handler. Use `teslasync_mqtt_pipeline_subscribed` for the
consumer-availability SLO and broker-native metrics for offline queue depth.

### Fleet Telemetry consumer lifecycle

`teslasync_mqtt_pipeline_connected` tracks the dedicated persistent client's
transport, while `teslasync_mqtt_pipeline_subscribed` tracks successful SUBACK
state. Keep these separate: a connected client can have zero subscriptions
after a broker session loss or failed reconnect SUBACK.

`teslasync_mqtt_pipeline_subscription_attempts_total` uses only the bounded
`trigger={initial,reconnect,supervisor}` and
`result={success,timeout,error}` labels. The supervisor retries every five
seconds while connected. `teslasync_mqtt_pipeline_liveness_unhealthy_seconds`
advances only while a consumer-specific failure is eligible for restart; it
stays zero during a broker-wide outage to prevent restart storms.

**SLO target:** `mqtt_pipeline_subscribed == 1` for 99.9% of the seven-day
window.

### `teslasync_tesla_api_circuit_breaker_state`

Per-endpoint gauge with three legal values:

| Value | State        | Meaning                                                       |
|-------|--------------|---------------------------------------------------------------|
| `0`   | `closed`     | Normal traffic; requests flow through to the upstream.        |
| `1`   | `open`       | Failing fast; the breaker is short-circuiting requests.       |
| `2`   | `half-open`  | Probing; allowing a trickle of requests to test recovery.     |

The gauge is updated by the resilience layer via
`metrics.SetTeslaAPICircuitBreakerState(endpoint, state)`. Today the
breaker layer is not yet wired — callers can invoke the helper from
any place that observes Tesla API failures.

**SLO target:** `tesla_api_circuit_breaker_state == 0` during business
hours; transient `1` or `2` excursions are acceptable for ≤ `5m`.

## Recording rules & alerts

```promql
# Vehicles with stale telemetry (> 5 min)
sum(teslasync_telemetry_lag_seconds > 300)

# FSM consistency fleet-wide
avg(teslasync_fsm_state_correctness_ratio)

# Pipeline starved (no signals processed in last 1m while backlog non-zero)
(teslasync_normalize_pipeline_throughput_signals_per_second == 0)
  and on()
(teslasync_mqtt_consumer_backlog > 0)

# Upstream API breaker tripped
max by (endpoint) (teslasync_tesla_api_circuit_breaker_state) > 0
```

## Alert templates (consumed by phase-44 prompt 0032)

```yaml
- alert: TelemetryLagFleetwide
  expr: sum(teslasync_telemetry_lag_seconds > 300) > 5
  for: 5m
  labels:
    severity: page
  annotations:
    summary: "More than 5 vehicles have telemetry lag > 5 minutes"

- alert: NormalizePipelineStalled
  expr: |
    (teslasync_normalize_pipeline_throughput_signals_per_second == 0)
    and on() (teslasync_mqtt_consumer_backlog > 0)
  for: 2m
  labels:
    severity: page
  annotations:
    summary: "Normalize pipeline produced 0 signals/sec while MQTT backlog > 0"

- alert: TeslaAPIBreakerOpen
  expr: max by (endpoint) (teslasync_tesla_api_circuit_breaker_state) == 1
  for: 5m
  labels:
    severity: warn
  annotations:
    summary: "Tesla API breaker open on {{ $labels.endpoint }}"
```

## Wiring guide for new sources

1. **Add a metric:** declare it in
   [`internal/metrics/business.go`](../../internal/metrics/business.go) so
   the `promauto` global registry picks it up automatically.
2. **Add a helper:** wrap raw `Inc`/`Set`/`Observe` in a typed function
   so packages that mutate the metric never reach into the prometheus
   primitives directly. This keeps wiring testable and traceable.
3. **Wire from one place per source:** every metric should have one
   producer. Multiple producers fight over the gauge's value and
   confuse dashboards.
4. **Add a unit test in
   [`internal/metrics/business_test.go`](../../internal/metrics/business_test.go)**
   that exercises the helper, asserts the metric value, and (for
   gauges with refreshers) tests the refresh tick.

## Test coverage

The current contract is pinned by these tests in
`internal/metrics/business_test.go`:

| Test                                                        | Pins                                                            |
|-------------------------------------------------------------|------------------------------------------------------------------|
| `TestRecordSignalReceived_AndRefresh`                       | Refresher writes `(now - lastSeen)` for known vehicles           |
| `TestRecordSignalReceived_EmptyVehicleIDSkipped`            | Empty vehicleID is a no-op (no series, no panic)                 |
| `TestSetTeslaAPICircuitBreakerState`                        | Open / closed transitions reflected in the gauge                 |
| `TestSetFSMStateCorrectness_ClampedTo01`                    | Out-of-range inputs are clamped to `[0, 1]`                      |
| `TestSetNormalizePipelineThroughput`                        | Helper writes the expected value                                 |
| `TestMQTTConsumerBacklog_IncDec`                            | Inc / Dec arithmetic works                                       |
| `TestStartTelemetryLagRefresher_RunsAndStops`               | Refresher goroutine actually emits samples and stops on signal   |

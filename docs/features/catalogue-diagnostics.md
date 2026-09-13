# Diagnostics

Sidebar group **Diagnostics**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| System Status | `/system-status` | Health of every dependent service — MQTT, Redis, DB, Tesla API. | Renders an empty state when no data is available — the page is not hidden. |
| Outage Autobiography | `/outage` | What queued, replayed with original event time, or stayed unknown. | Renders an empty state when no data is available — the page is not hidden. |
| Database Health | `/db-health` | Database size, query latency, and replication lag. | Renders an empty state when no data is available — the page is not hidden. |
| Anomaly Detection | `/anomaly-detection` | Auto-detected outliers in charging, range, and drives. | Renders an empty state when no data is available — the page is not hidden. |
| Remaining Useful Life | `/diagnostics/rul` | Estimate remaining useful life for monitored components. | Renders an empty state when no data is available — the page is not hidden. |
| Root-Cause Intelligence | `/diagnostics/root-cause` | Rank evidence-backed explanations for vehicle anomalies. | Renders an empty state when no data is available — the page is not hidden. |
| Dashcam & Sentry | `/dashcam` | Search, redact, and reconstruct Dashcam and Sentry incidents locally. | Renders an empty state when no data is available — the page is not hidden. |
| Live Signals | `/signals` | Live values for every telemetry signal the car publishes. | Renders an empty state when no data is available — the page is not hidden. |
| Live Signal Inspector | `/admin/live-signals` | Inspect a single signal in real time with history. | Operator surface — needs a healthy API, MQTT, and DB. |
| Ingest X-Ray | `/admin/ingest-xray` | See every payload as it lands from Fleet Telemetry. | Operator surface — needs a healthy API, MQTT, and DB. |
| DLQ Inspector | `/admin/dlq` | Dead-letter queue — messages that failed to ingest. | Operator surface — needs a healthy API, MQTT, and DB. |
| Feature Flags | `/admin/flags` | Runtime feature flags — toggle without redeploy. | Operator surface — needs a healthy API, MQTT, and DB. |
| Schema Drift | `/admin/schema-drift` | Detect divergence between code models and the live DB schema. | Operator surface — needs a healthy API, MQTT, and DB. |
| Slow Queries | `/admin/slow-queries` | Top slow SQL queries with explain plans. | Operator surface — needs a healthy API, MQTT, and DB. |
| Vehicle Cost | `/admin/vehicle-cost` | Per-vehicle infrastructure cost attribution. | Operator surface — needs a healthy API, MQTT, and DB. |
| Data Quality | `/admin/data-quality` | Signal freshness, gaps, duplicates, and normalization provenance. | Operator surface — needs a healthy API, MQTT, and DB. |
| Disk Forecast | `/admin/disk-forecast` | When will the database run out of disk? | Operator surface — needs a healthy API, MQTT, and DB. |
| Secret Rotation | `/admin/secret-rotation` | Track and rotate secrets, tokens, and credentials. | Operator surface — needs a healthy API, MQTT, and DB. |
| Audit Log | `/admin/audit-log` | Every privileged action with actor, target, and timestamp. | Operator surface — needs a healthy API, MQTT, and DB. |
| GDPR Exports | `/admin/gdpr-exports` | Generate and download a complete user-data export. | Operator surface — needs a healthy API, MQTT, and DB. |
| State Debugger | `/state-debugger` | Inspect the per-vehicle finite-state machine in real time. | Operator surface — needs a healthy API, MQTT, and DB. |
| MQTT Inspector | `/mqtt-inspector` | Subscribe to any MQTT topic and watch messages flow. | Operator surface — needs a healthy API, MQTT, and DB. |
| Signal Correlation | `/signal-correlation` | Find signals that move together across a selected time window. | Renders an empty state when no data is available — the page is not hidden. |
| Signal Entropy | `/signal-entropy` | Measure signal variability and information density. | Renders an empty state when no data is available — the page is not hidden. |
| Signal Trend | `/signal-trend` | Detect robust long-term telemetry trends and direction changes. | Renders an empty state when no data is available — the page is not hidden. |
| Signal Change Points | `/signal-change-points` | Locate statistically meaningful shifts in signal behavior. | Renders an empty state when no data is available — the page is not hidden. |
| Signal Deadband Advisor | `/signal-deadband` | Recommend noise thresholds that preserve meaningful telemetry. | Renders an empty state when no data is available — the page is not hidden. |
| Nonlinear Signal Coupling | `/signal-mutual-information` | Discover nonlinear dependencies between telemetry signals. | Renders an empty state when no data is available — the page is not hidden. |
| Redis Signals | `/redis-signals` | Dump the Redis live-signal cache for a vehicle. | Operator surface — needs a healthy API, MQTT, and DB. |
| Telemetry Coverage | `/admin/telemetry/coverage` | Which Fleet Telemetry fields are wired vs missing. | Operator surface — needs a healthy API, MQTT, and DB. |
| API Logs | `/api-logs` | Recent HTTP requests with status, duration, and payload size. | Renders an empty state when no data is available — the page is not hidden. |
| API Playground | `/api-playground` | Try any API endpoint with parameter forms. | Renders an empty state when no data is available — the page is not hidden. |

[← All groups](./catalogue.md)

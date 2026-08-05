# Database

TeslaSync's database isn't a passive store. It's where multi-million-row time series live next to relational settings, where vector embeddings power the Helix chatbot, where continuous aggregates keep charts fast over multi-year ranges, and where retention policies quietly garden the tables you'd otherwise have to babysit.

Everything that persists more than a few seconds — telemetry signals, drives, charging sessions, alert rules, audit logs, Helix call records, RAG embeddings — sits in one PostgreSQL instance with TimescaleDB and pgvector enabled. The bundled Compose image is `timescale/timescaledb-ha:pg17` which has both extensions pre-installed.

## Why PostgreSQL with TimescaleDB and pgvector, not three different stores

The platform is **mostly relational** (vehicles, users, settings, automations, alerts, geofences), **partly time-series** (telemetry signals, positions, derived metrics), and **partly vector** (RAG embeddings for the help chatbot). Splitting into three stores would mean:

- Distributed joins (give me the drives for vehicle X with their telemetry windows) become application-level joins, much slower
- Three backup-and-restore procedures instead of one
- Three sets of high-availability concerns
- Three transactional boundaries with no cross-store atomicity

TimescaleDB makes PostgreSQL competitive with dedicated time-series databases for the workloads TeslaSync has (single-server scale, joins to relational tables, retention policies, materialised views with auto-refresh). pgvector makes the same instance a credible vector store for a corpus of a few hundred to a few thousand documents. The cost is one Postgres instance to operate.

## Storage domains

Tables grouped by purpose. The exact list drifts as migrations are added; consult the interactive diagram for the live picture.

| Domain        | What lives there                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Core          | `vehicles`, `users`, `settings`, encrypted Tesla `tokens`, `addresses`, API keys                  |
| Live state    | `vehicle_live_state` (legacy snapshot), L2 Redis HSET (current), L1 in-process map               |
| Time-series   | `signal_log` hypertable, `positions`, telemetry snapshots, continuous aggregates                  |
| Drives        | `drives`, `drive_telemetry_readings`, `trips`, `trip_drives`, route replay                        |
| Charging      | `charging_sessions`, `charging_telemetry`, Tesla `charging_invoices`, Tesla `charging_sessions`   |
| Analytics     | Daily / hourly aggregates, cost, efficiency, battery, route metrics                               |
| Alerts        | `alert_rules`, `alerts`, `notification_channels`, `notification_logs`, `automations`, webhooks    |
| Fleet         | `geofences`, `locations`, `geofence_events`, `command_logs`                                       |
| Helix AI      | `ai_call_log` (audit), `ai_embeddings` (pgvector for RAG), `ai_feature_state` (per-user toggles)  |
| Operations    | `api_logs`, `audit_logs`, `exports`, `backup_history`, `repair_jobs`, `schema_migrations`         |

### Interactive diagram

The live schema diagram renders below — drag to pan, scroll to zoom, hover to highlight relationships, search to filter.

<div id="diagram-container" style="position: relative; width: 100%; height: 80vh; border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; margin-top: 16px;">
  <iframe
    id="diagram-iframe"
    src="/teslasync/database-diagram.html"
    style="width: 100%; height: 100%; border: none;"
    title="TeslaSync Database Diagram"
    loading="lazy"
    allowfullscreen
  ></iframe>
  <button
    id="fullscreen-btn"
    onclick="(function(){var c=document.getElementById('diagram-container');if(!c._fsInit){c._fsInit=true;document.addEventListener('fullscreenchange',function(){var fs=!!document.fullscreenElement;c.style.height=fs?'100vh':'80vh';c.style.borderRadius=fs?'0':'12px';document.getElementById('fs-label').textContent=fs?'Exit Fullscreen':'Fullscreen';document.getElementById('fs-icon-expand').style.display=fs?'none':'block';document.getElementById('fs-icon-shrink').style.display=fs?'block':'none'})}if(document.fullscreenElement){document.exitFullscreen()}else{c.requestFullscreen()}})()"
    style="position: absolute; top: 10px; right: 10px; z-index: 10; background: rgba(15,16,32,0.85); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 6px 14px; cursor: pointer; font-size: 14px; backdrop-filter: blur(8px); display: flex; align-items: center; gap: 6px; transition: all 0.2s;"
    onmouseover="this.style.background='rgba(99,102,241,0.8)'"
    onmouseout="this.style.background='rgba(15,16,32,0.85)'"
    title="Toggle fullscreen"
  >
    <svg id="fs-icon-expand" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
    <svg id="fs-icon-shrink" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M4 14h6v6m10-10h-6V4m0 6l7-7M3 21l7-7"/></svg>
    <span id="fs-label">Fullscreen</span>
  </button>
</div>

::: tip Navigation
- **Zoom**: scroll wheel or the diagram controls
- **Pan**: click-and-drag the background
- **Move tables**: drag the table header
- **Search**: filter tables / columns by name
- **Highlight**: hover a table to focus its relationships
- **Minimap**: bottom-right corner for fast navigation
:::

## Hypertables — how time-series storage works

TimescaleDB's hypertable splits a table into time-bucketed **chunks** under the hood. Queries that filter by time touch only the chunks that matter; old chunks can be compressed, dropped, or excluded from indexes independently.

The platform's hypertables:

| Table             | Bucket                  | What lives in it                                                |
| ----------------- | ----------------------- | --------------------------------------------------------------- |
| `signal_log`      | 7 days per chunk        | Every normalised signal value, the durable source of truth      |
| `positions`       | 7 days per chunk        | GPS positions over time                                         |
| `signal_history`  | Variable                | Older format retained for compatibility; new code reads `signal_log` |
| `audit_logs`      | 30 days per chunk       | Auth events, settings changes, sensitive operations             |
| `api_logs`        | 7 days per chunk        | HTTP access log (when enabled)                                  |

You query a hypertable like any normal table. TimescaleDB's planner handles chunk pruning and parallelism transparently.

## Continuous aggregates — how charts stay fast

Querying `signal_log` over a 6-month window for one signal would scan millions of rows. Continuous aggregates are **materialised views** that pre-roll the buckets:

| Aggregate                              | Source           | Bucket          | Used by                                  |
| -------------------------------------- | ---------------- | --------------- | ---------------------------------------- |
| `signal_log_1m`                        | `signal_log`     | 1 minute        | Last 24-hour drilldowns, dashboard cards |
| `signal_log_1h`                        | `signal_log`     | 1 hour          | Last 30-day charts                       |
| `signal_log_1d`                        | `signal_log`     | 1 day           | Multi-month / multi-year analytics       |
| Per-domain aggregates (drives, charging, cost, efficiency) | various | varies | Analytics pages, Grafana dashboards |

TimescaleDB's `continuous_aggregate_policy` background job refreshes the aggregates on a schedule defined per view. The platform-side API and Grafana queries pick the right aggregate for the requested range automatically.

To list what's deployed:

```sql
SELECT view_name, refresh_lag, schedule_interval
FROM timescaledb_information.continuous_aggregates;
```

To force a one-off refresh after a backfill:

```sql
CALL refresh_continuous_aggregate('signal_log_1h', '2025-01-01', '2025-02-01');
```

## Retention — automated cleanup

The platform's maintenance worker runs retention policies on a schedule. The defaults (see `internal/config/config.go`):

| Env var                            | Default     | What it controls                                                    |
| ---------------------------------- | ----------- | ------------------------------------------------------------------- |
| `DATA_RETENTION_DAYS`              | `0` (off)   | Old `vehicle_live_state` rows; legacy table                          |
| `POSITION_RETENTION_DAYS`          | `0` (off)   | `positions` rows older than N days                                  |
| `SIGNAL_HISTORY_RETENTION_DAYS`    | `0` (off)   | Legacy `signal_history` rows                                        |
| `AUDIT_RETENTION_DAYS`             | `365`       | `audit_logs` rows                                                   |
| `AUDIT_IP_RETENTION_DAYS`          | `30`        | Redact `ip` and `user_agent` from `audit_logs` after N days         |

Setting any of these to `0` disables that policy. The defaults are conservative — TeslaSync **does not delete telemetry data unless you tell it to**. If you want long-term storage, leave the position/signal retention off; if you want shorter retention to control disk, set the values that make sense for your fleet size.

For hypertable chunks, retention can also be configured as a TimescaleDB policy (`add_retention_policy('signal_log', INTERVAL '730 days')`) which drops whole chunks rather than row-by-row deletion. That's faster on large tables but loses fine-grained control.

## pgvector — RAG embeddings

Vector-backed Helix features such as `rag-help` can use retrieval-augmented
generation over indexed documentation. Embeddings live in the dimensioned
embedding tables:

- One row per chunk of a source document
- `embedding vector(N)` column with an ivfflat or hnsw index for cosine-similarity search
- `source_type` + `source_id` link each chunk back to its origin (e.g., `('docs', 'charging/quickstart.md')`)
- Content hash prevents re-embedding unchanged files

Retrieval is a parameterised SQL query, with no separate vector service.

Helix Chat's application-knowledge tool takes a different production path:
maintained Markdown is embedded in the API binary and ranked in process with
BM25-style lexical retrieval. Chat therefore does not require an embedding
provider, a populated vector index, or the `rag-help` feature toggle.

## Migrations

Migrations live in `migrations/`. They're `golang-migrate`-style numbered `up.sql` / `down.sql` pairs, applied in numerical order on API startup. The current sequence is **197 numbered migrations** (`000001` through `000210`, with some numbers reserved for in-flight work).

To inspect the latest:

```bash
Get-ChildItem migrations -Filter '*.up.sql' | Sort-Object Name | Select-Object -Last 10
```

To verify schema state at runtime:

```sql
SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 1;
SELECT extname FROM pg_extension WHERE extname IN ('timescaledb', 'vector', 'pg_stat_statements');
```

Rules:

- Migrations are **append-only**. Never edit one that's been applied in any environment. Add a new one to evolve.
- The first migration enables `timescaledb` and `vector`. Without the extension, subsequent migrations fail.
- A failed migration sets `schema_migrations.dirty=true` and blocks further runs until you reset it (see [Troubleshooting](/guide/troubleshooting#database-migration-is-stuck)).

## Live state versus historical state

A common source of confusion. The platform maintains both:

- **Live state** — the most recent value per vehicle per signal. Lives in L1 (in-process map) and L2 (`vehicle:{id}:signals` Redis HSET). Read for "what is the car doing right now". Microsecond latency. **Never queried from the database** at request time; the DB rehydrates the cache after a restart, not on every read.
- **Historical state** — every value over time. Lives in `signal_log` (and its continuous aggregates) and `positions`. Read for charts, audits, drive replays, analytics. Millisecond-to-second latency depending on range and aggregate.

These are two storage paths with two access patterns. Code that confuses them — querying `signal_log ORDER BY ts DESC LIMIT 1` for live state, for instance — bypasses the cache and produces stale results under load.

## Backup and restore

The default deployment runs PostgreSQL inside a container with a persistent volume. The recommended backup strategy is `pg_dump` for relational tables and TimescaleDB's `timescaledb-backup` tool (or filesystem snapshots) for the hypertables. The platform also ships an **in-app backup** feature in **Settings → Backup & Restore** for user-facing configuration (settings, rules, automations) — that's a smaller, app-aware export, not a database backup.

Full reference: [Backup & Restore](/features/backup-restore).

## Where to learn more

- [Architecture](/guide/architecture) — the runtime view of how requests touch the database
- [Caching](/caching) — the L1 / L2 / TanStack / service-worker layering above the database
- [Helix AI](/guide/helix-ai) — how `ai_call_log` and `ai_embeddings` are used
- [Backup & Restore](/features/backup-restore) — recovery procedures
- [Configuration](/guide/configuration) — every retention and database env var

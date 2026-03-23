# Configuration

TeslaSync is configured entirely through environment variables. In Docker Compose, these are loaded from the `.env` file. For Kubernetes, they are injected via ConfigMaps and Secrets.

## Environment Variables Reference

### Tesla API

These credentials are **required** for TeslaSync to communicate with the Tesla Fleet API.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TESLA_CLIENT_ID` | string | — | **Required.** Tesla developer application client ID |
| `TESLA_CLIENT_SECRET` | string | — | **Required.** Tesla developer application client secret |
| `TESLA_API_BASE_URL` | string | `https://fleet-api.prd.na.vn.cloud.tesla.com` | Tesla Fleet API base URL. Change for EU: `https://fleet-api.prd.eu.vn.cloud.tesla.com` |
| `TESLA_AUTH_URL` | string | `https://auth.tesla.com` | Tesla OAuth2 authorization URL |
| `TESLA_REDIRECT_URI` | string | `http://localhost:4000/api/v1/auth/callback` | OAuth2 callback URL. Must match the URL registered in your Tesla developer app |
| `TESLA_TIMEOUT` | duration | `30s` | HTTP timeout for Tesla API requests |

::: tip Regional API Endpoints
Tesla has different Fleet API endpoints by region:
- **North America:** `https://fleet-api.prd.na.vn.cloud.tesla.com`
- **Europe:** `https://fleet-api.prd.eu.vn.cloud.tesla.com`
- **China:** `https://fleet-api.prd.cn.vn.cloud.tesla.com`

Set `TESLA_API_BASE_URL` to the endpoint for your region.
:::

### Application Server

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TESLASYNC_PORT` | int | `8080` | HTTP server port |
| `TESLASYNC_LOG_LEVEL` | string | `info` | Log verbosity: `trace`, `debug`, `info`, `warn`, `error` |
| `TESLASYNC_DEV` | bool | `false` | Enable development mode (pretty-printed console logs) |

### Database (PostgreSQL)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_HOST` | string | `localhost` | PostgreSQL hostname |
| `DATABASE_PORT` | int | `5432` | PostgreSQL port |
| `DATABASE_USER` | string | `teslasync` | Database username |
| `DATABASE_PASSWORD` | string | `teslasync` | Database password |
| `DATABASE_NAME` | string | `teslasync` | Database name |
| `DATABASE_SSLMODE` | string | `disable` | SSL mode: `disable`, `require`, `verify-ca`, `verify-full` |
| `DATABASE_MAX_CONNS` | int | `25` | Maximum connection pool size |
| `DATABASE_MIN_CONNS` | int | `5` | Minimum idle connections |
| `DATABASE_CONN_MAX_LIFETIME` | duration | `5m` | Maximum connection lifetime before recycling |
| `DATABASE_CONN_MAX_IDLE_TIME` | duration | `1m` | Maximum idle time before closing a connection |

::: info Connection Pool Tuning
The default pool settings (5–25 connections) are suitable for most single-instance deployments. If running multiple replicas in Kubernetes, reduce `DATABASE_MAX_CONNS` per replica to avoid exhausting database connections.
:::

### MQTT (Mosquitto)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MQTT_ENABLED` | bool | `true` | Enable MQTT telemetry publishing |
| `MQTT_HOST` | string | `localhost` | MQTT broker hostname |
| `MQTT_PORT` | int | `1883` | MQTT broker port |
| `MQTT_USERNAME` | string | — | MQTT authentication username (optional) |
| `MQTT_PASSWORD` | string | — | MQTT authentication password (optional) |
| `MQTT_CLIENT_ID` | string | `teslasync` | MQTT client identifier |
| `MQTT_PREFIX` | string | `teslasync` | Topic prefix (topics are `{prefix}/vehicles/{vin}/{metric}`) |

### Worker (Vehicle Polling)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `WORKER_POLL_INTERVAL` | duration | `15s` | Polling interval for online/idle vehicles (vehicle_data calls) |
| `WORKER_SLEEP_POLL_INTERVAL` | duration | `0` | Polling interval for sleeping/offline vehicles (0 = never poll) |
| `WORKER_DRIVING_POLL_INTERVAL` | duration | `120s` | Polling interval when vehicle is actively driving |
| `WORKER_CHARGING_POLL_INTERVAL` | duration | `600s` | Polling interval when vehicle is charging |
| `WORKER_STATUS_CHECK_INTERVAL` | duration | `900s` | How often to call ListVehicles to check all vehicle states |
| `WORKER_SLEEP_POLL_MULT` | int | `4` | Backoff multiplier for sleeping vehicles. When vehicle returns 408, polling backs off: PollInterval × SleepPollMult, then doubles each consecutive asleep response, capping at 10 minutes. |
| `WORKER_STREAMING` | bool | `false` | Enable Tesla Streaming API (experimental) |

::: tip Cost-Optimized Polling
TeslaSync uses a two-tier polling strategy to minimize API costs and stay within the $10/month free credit:

**Tier 1 — Status check (every 15 min):** A single `ListVehicles` API call returns the state of ALL vehicles. No per-vehicle API calls needed. Sleeping/offline vehicles are never polled further.

**Tier 2 — Data fetch (only for active vehicles):**
- **Driving**: every 120s (GPS and speed data)
- **Charging**: every 600s (battery level changes slowly)
- **Online/Idle**: covered by the 15-min status check, no extra `vehicle_data` calls
- **Asleep/Offline**: never polled (0 API calls)

This approach eliminates the expensive per-vehicle `GetVehicleStatus` call and avoids waking sleeping cars entirely.

**API Suspend:** You can also suspend all Tesla Fleet API calls entirely from the Settings UI or via `POST /api/v1/settings/suspend-api` with body `{"suspended": true}`. Useful when a vehicle is in service. Token refresh continues during suspension so re-auth isn't needed.
:::

### Redis (Cache)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REDIS_ENABLED` | bool | `true` | Enable Redis caching layer |
| `REDIS_HOST` | string | `localhost` | Redis hostname |
| `REDIS_PORT` | int | `6379` | Redis port |
| `REDIS_PASSWORD` | string | — | Redis password (optional) |
| `REDIS_DB` | int | `0` | Redis database number |

::: tip
Redis is deployed automatically with the Helm chart and enabled by default. When Redis is unavailable, TeslaSync falls back to an in-memory cache automatically.
:::

### System

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `HELM_CHART_VERSION` | string | — | Helm chart version (set automatically by chart) |

### Authentication

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AUTH_ENABLED` | bool | `false` | Enable JWT authentication for the API |
| `AUTH_JWT_SECRET` | string | — | JWT signing secret (required if `AUTH_ENABLED=true`) |

### Data Retention

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATA_RETENTION_DAYS` | int | `365` | Number of days to keep general data (drives, charging, etc.) |
| `POSITION_RETENTION_DAYS` | int | `90` | Number of days to keep GPS position history |

::: warning Data Retention
The maintenance worker runs periodically to delete records older than the configured retention period. Lowering these values will permanently delete historical data. Make sure to export data before changing retention settings.
:::

### Docker Compose Variables

These are used by `docker-compose.yml` and are not read by the Go application:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `POSTGRES_USER` | string | `teslasync` | PostgreSQL container user |
| `POSTGRES_PASSWORD` | string | `teslasync` | PostgreSQL container password |
| `POSTGRES_DB` | string | `teslasync` | PostgreSQL container database name |
| `POSTGRES_PORT` | int | `5432` | PostgreSQL host port mapping |
| `WEB_PORT` | int | `3000` | Frontend host port mapping |
| `GRAFANA_PORT` | int | `3001` | Grafana host port mapping |
| `GRAFANA_USER` | string | `admin` | Grafana admin username |
| `GRAFANA_PASSWORD` | string | `teslasync` | Grafana admin password |
| `MQTT_PORT` | int | `1883` | MQTT host port mapping |
| `REDIS_PORT` | int | `6379` | Redis host port mapping |

## Example `.env` File

```bash
# ===========================================
# TeslaSync Configuration
# ===========================================

# Tesla API (REQUIRED)
TESLA_CLIENT_ID=your-client-id
TESLA_CLIENT_SECRET=your-client-secret
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback

# Database
POSTGRES_USER=teslasync
POSTGRES_PASSWORD=change-me-in-production
POSTGRES_DB=teslasync
POSTGRES_PORT=5432

# Application
TESLASYNC_PORT=8080
WEB_PORT=3000
POLL_INTERVAL=300s
LOG_LEVEL=info

# Grafana
GRAFANA_PORT=3001
GRAFANA_USER=admin
GRAFANA_PASSWORD=change-me-in-production

# MQTT
MQTT_PORT=1883

# Redis
REDIS_PORT=6379

# Data Retention
DATA_RETENTION_DAYS=365
POSITION_RETENTION_DAYS=90
```

## Configuration Best Practices

### Production Checklist

1. **Change all default passwords** — Database, Grafana, MQTT, JWT secret.
2. **Enable SSL for PostgreSQL** — Set `DATABASE_SSLMODE=require` or higher.
3. **Set a strong JWT secret** — Use a random 256-bit key if auth is enabled.
4. **Restrict CORS origins** — The default allows all origins; lock this down.
5. **Enable MQTT authentication** — Disable anonymous access in `mosquitto.conf`.
6. **Use Docker secrets** — Avoid storing credentials in `.env` files in production.
7. **Set appropriate data retention** — Balance storage costs with data needs.
8. **Tune the connection pool** — Match `DATABASE_MAX_CONNS` to your workload.

### Duration Format

Duration values accept Go-style duration strings:

| Format | Example | Meaning |
|--------|---------|---------|
| `s` | `15s` | 15 seconds |
| `m` | `5m` | 5 minutes |
| `h` | `1h` | 1 hour |
| Combined | `1h30m` | 1 hour 30 minutes |

## Tesla Fleet API Billing Optimization

Tesla's Fleet API charges per request. Each developer account receives a **$10/month free credit**, which covers approximately **5,000 data requests/month** (~166/day) at $0.002/request.

### Pricing

| Request Type | Cost | Example |
|-------------|------|---------|
| Data request (`vehicle_data`, `vehicles/{id}`) | $0.002 | Full vehicle snapshot |
| Wake | $0.02 | Wake a sleeping car |
| Command | $0.001 | Lock, climate, etc. |
| Streaming signal | $0.0000067 | Per telemetry signal |

### Why This Matters

| Polling Strategy | Requests/Day | Requests/Month | Est. Cost/Month |
|-----------------|-------------|----------------|-----------------|
| Fixed 30s (old default) | 2,880 | 86,400 | ~$172 |
| Per-vehicle status + data (previous) | ~352 | ~10,560 | ~$21 |
| **ListVehicles + selective data (current)** | **~126** | **~3,780** | **~$7.56** ✅ |

### How Cost-Optimized Polling Works

TeslaSync uses a two-tier approach:

1. **ListVehicles** (1 API call every 15 min): Returns all vehicle states in a single request. No per-vehicle status calls needed.
2. **GetVehicleData** (only for active vehicles): Only called for vehicles that are driving or charging.

| Vehicle State | Poll Interval | API Calls | Rationale |
|--------------|---------------|-----------|-----------|
| **Driving** | 120s | `vehicle_data` | GPS, speed, battery data at reasonable granularity |
| **Charging** | 600s (10 min) | `vehicle_data` | Battery level changes ~1% every few minutes |
| **Online/Idle** | — | None (status only) | State known from ListVehicles |
| **Asleep/Offline** | — | None | Never polled, never woken |

### Cost Estimation

For a typical usage pattern (1h driving/day on 20 days, 4h charging/day on 25 days):

| Component | Calculation | Requests/Month | Cost/Month |
|-----------|------------|----------------|------------|
| Status checks (ListVehicles) | 96/day × 30 | 2,880 | $5.76 |
| Driving (120s, 1h/day, 20 days) | 30/session × 20 | 600 | $1.20 |
| Charging (600s, 4h/day, 25 days) | 24/session × 25 | 600 | $1.20 |
| Idle | 0 (covered by status) | 0 | $0.00 |
| Sleep | 0 (never polled) | 0 | $0.00 |
| **Total (1 vehicle)** | | **4,080** | **$8.16** ✅ |

### Multi-Vehicle Cost Table

| Vehicles | Status (15min) | Driving (2min) | Charging (10min) | Est. Monthly |
|----------|---------------|----------------|-------------------|-------------|
| 1 | $5.76 | $1.20 | $1.20 | $8.16 |
| 2 | $5.76 | $2.40 | $2.40 | $10.56 |
| 3 | $5.76 | $3.60 | $3.60 | $12.96 |

::: warning Multi-Vehicle Users
2+ vehicles will exceed the $10/month free credit. To stay within budget:
- Increase `WORKER_DRIVING_POLL_INTERVAL` (e.g., `180s` or `300s`)
- Increase `WORKER_CHARGING_POLL_INTERVAL` (e.g., `900s`)
- Add a payment method to your Tesla developer account
:::

::: tip Staying Within Free Credit
To stay within the $10/month free credit (~5,000 requests) with 1 vehicle:
- The default intervals are already optimized for this budget
- Use the **API Usage Estimate** card in Settings to monitor your usage
- If you drive less than 1h/day, costs will be well under $10
:::

### Monitoring API Usage

The `/api/v1/system/api-usage` endpoint returns real-time usage statistics:

```json
{
  "total_requests": 1234,
  "skipped_polls": 5678,
  "estimated_cost": 2.47,
  "cost_per_request": 0.002,
  "monthly_credit": 10.0,
  "estimated_remaining": 7.53
}
```

The Settings page includes an interactive billing calculator where you can adjust driving and charging hours to see estimated monthly costs.

## Fleet Telemetry Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `FLEET_TELEMETRY_ENABLED` | `false` | Enable Fleet Telemetry status monitoring |
| `FLEET_TELEMETRY_HOST` | `` | Hostname of your Fleet Telemetry server |
| `FLEET_TELEMETRY_PORT` | `4443` | Port for Fleet Telemetry server |

## Tesla Fleet API Region

| Variable | Default | Description |
|----------|---------|-------------|
| `TESLA_API_BASE_URL` | `https://fleet-api.prd.na.vn.cloud.tesla.com` | Fleet API base URL. Change for EU or CN regions |

Available regions:
- **NA:** `https://fleet-api.prd.na.vn.cloud.tesla.com`
- **EU:** `https://fleet-api.prd.eu.vn.cloud.tesla.com`
- **CN:** `https://fleet-api.prd.cn.vn.cloud.tesla.com`

## Kubernetes / Helm Configuration

When deploying with the Helm chart, the following values control how the frontend communicates with the API backend. These are set in `values.yaml` and are separate from the environment variables above.

### `config.apiEndpoint`

| Helm Value | Default | Description |
|------------|---------|-------------|
| `config.apiEndpoint` | `""` (auto-derived) | Internal API endpoint used for both Nginx `proxy_pass` and frontend API base URL |

This value serves a **dual purpose**:

1. **Nginx reverse proxy target** — Configures `proxy_pass` in the Nginx config so that requests to `/api/*`, `/.well-known/*`, `/healthz`, `/readyz`, and `/metrics` are forwarded to the API pod over the internal Kubernetes network.

2. **Frontend API base URL** — Injected into the React SPA at runtime via Nginx `sub_filter`, setting `window.__TESLASYNC_API_BASE__` so the browser knows where to send API requests.

If left empty (the default), the chart automatically derives the endpoint as `http://<release>-api:<port>` based on the Helm release name and the API service port. For most deployments, you do not need to set this value.

```yaml
# Example: explicit override (rarely needed)
config:
  apiEndpoint: "http://my-custom-api-service:8080"
```

### `config.webEndpoint`

| Helm Value | Default | Description |
|------------|---------|-------------|
| `config.webEndpoint` | `""` | Public frontend URL, used to configure CORS `Access-Control-Allow-Origin` on the API |

This is the public-facing URL of your TeslaSync instance (e.g., `https://teslasync.example.com`). It is used by the API server to set the CORS allowed origin header.

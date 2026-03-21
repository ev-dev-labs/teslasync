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
| `WORKER_POLL_INTERVAL` | duration | `300s` | Polling interval for online/idle vehicles |
| `WORKER_SLEEP_POLL_INTERVAL` | duration | `1800s` | Polling interval for sleeping/offline vehicles |
| `WORKER_DRIVING_POLL_INTERVAL` | duration | `30s` | Polling interval when vehicle is actively driving |
| `WORKER_SLEEP_POLL_MULT` | int | `4` | Legacy multiplier for sleeping vehicles (superseded by adaptive polling) |
| `WORKER_STREAMING` | bool | `false` | Enable Tesla Streaming API (experimental) |

::: tip Adaptive Polling
TeslaSync uses adaptive polling to minimize API costs. The worker automatically adjusts the polling interval based on vehicle state:
- **Driving**: every 30s (real-time data needed)
- **Charging**: every 120s (battery level changes slowly)
- **Online/Idle**: every 300s (vehicle is awake but parked)
- **Asleep/Offline**: every 1800s (don't wake the car)

Before making the expensive `vehicle_data` API call, the worker first checks the vehicle's basic status using the cheaper vehicle endpoint. If the vehicle is asleep, the full data request is skipped entirely.
:::

### Redis (Cache)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REDIS_ENABLED` | bool | `false` | Enable Redis caching layer |
| `REDIS_HOST` | string | `localhost` | Redis hostname |
| `REDIS_PORT` | int | `6379` | Redis port |

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

Tesla's Fleet API charges per `vehicle_data` request. Each developer account receives a **$10/month free credit**, which covers approximately **4,500 requests/month** (~150/day).

### Why This Matters

| Polling Strategy | Requests/Day | Requests/Month | Est. Cost/Month |
|-----------------|-------------|----------------|-----------------|
| Fixed 30s (old default) | 2,880 | 86,400 | ~$192 |
| Fixed 5min | 288 | 8,640 | ~$19 |
| **Adaptive (current)** | **~140** | **~4,200** | **~$9** ✅ |

### How Adaptive Polling Works

TeslaSync automatically adjusts polling frequency based on what the vehicle is doing:

| Vehicle State | Poll Interval | Rationale |
|--------------|---------------|-----------|
| **Driving** | 30s | Need real-time speed, location, battery data |
| **Charging** | 120s | Battery level changes slowly (~1% every few minutes) |
| **Online/Idle** | 300s (5 min) | Vehicle is awake but parked, minimal changes |
| **Asleep/Offline** | 1800s (30 min) | Avoid waking the car (wake = extra API call) |

### Cost Estimation

For a typical usage pattern (1h driving, 2h charging, 13h idle, 8h sleep per day):

| State | Requests/Day | Requests/Month |
|-------|-------------|----------------|
| Driving (1h × 30s) | 120 | 3,600 |
| Charging (2h × 120s) | 60 | 1,800 |
| Idle (13h × 300s) | 156 | 4,680 |
| Sleep (8h × 1800s) | 16 | 480 |
| **Total** | **352** | **~10,560** |

At ~$0.00222/request, this costs approximately **$23/month per vehicle**. With the $10 credit, you'd pay **~$13/month** for a single vehicle.

::: tip Staying Within Free Credit
To stay within the $10/month free credit (~4,500 requests):
- Reduce `WORKER_DRIVING_POLL_INTERVAL` to `60s` if you don't need 30s granularity
- Drive less than 1h/day or increase idle interval to `600s`
- Use the **API Usage Estimate** card in Settings to monitor your usage
:::

### Monitoring API Usage

The `/api/v1/system/api-usage` endpoint returns real-time usage statistics:

```json
{
  "total_requests": 1234,
  "skipped_polls": 5678,
  "estimated_cost": 2.74,
  "cost_per_request": 0.00222,
  "monthly_credit": 10.0,
  "estimated_remaining": 7.26
}
```

The Settings page includes an interactive billing calculator where you can adjust driving and charging hours to see estimated monthly costs.

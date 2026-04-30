# Configuration

TeslaSync is configured with environment variables in Docker/Compose and with Helm values in Kubernetes. The names below are the variables read by the Go processes. Compose and Helm may derive them from `.env` or chart values before injecting them into containers. The web container also uses Helm values to build its Nginx reverse proxy configuration.

## Required Tesla settings

| Variable | Purpose |
|---|---|
| `TESLA_CLIENT_ID` | Tesla Developer application client ID |
| `TESLA_CLIENT_SECRET` | Tesla Developer application secret |
| `TESLA_REDIRECT_URI` | OAuth callback URL, usually `https://your-domain/api/v1/auth/callback` in production |
| `TESLA_API_BASE_URL` | Tesla Fleet API region endpoint |

## Core service settings

| Variable | Default | Purpose |
|---|---:|---|
| `TESLASYNC_PORT` | `4000` bare binary; Compose/Helm set `8080` | API listen port |
| `TESLASYNC_LOG_LEVEL` | `info` | zerolog level |
| `CORS_ORIGINS` | empty | Allowed browser origins; empty follows runtime default behavior |
| `WORKER_POLL_INTERVAL` | `15s` bare binary; Compose/Helm commonly set `30s` | Polling interval when telemetry is not streaming |
| `WORKER_SLEEP_POLL_MULT` | `4` | Sleep-state polling backoff multiplier |
| `DATABASE_HOST` | `postgres` | PostgreSQL/Timescale host |
| `DATABASE_PORT` | `5432` | Database port |
| `DATABASE_USER` | `teslasync` | Database user |
| `DATABASE_PASS` | `teslasync` | Database password |
| `DATABASE_NAME` | `teslasync` | Database name |
| `DATABASE_SSLMODE` | `disable` | PostgreSQL SSL mode |
| `DATABASE_MAX_CONNS` | `25` | Maximum pgx pool connections |
| `DATABASE_MIN_CONNS` | `5` | Minimum pgx pool connections |
| `DATABASE_STATEMENT_TIMEOUT` | `30000` | Query timeout in milliseconds |
| `DATABASE_HEALTH_CHECK_PERIOD` | `5s` | pgx pool health-check interval |
| `MQTT_ENABLED` | `true` | Enable MQTT integration |
| `MQTT_HOST` | `mosquitto` | MQTT broker host |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_CLIENT_ID` | `teslasync` | MQTT client ID |
| `MQTT_PREFIX` | `teslasync` | MQTT topic prefix |
| `REDIS_ENABLED` | `false` bare binary; Compose/Helm set `true` | Enable Redis-backed runtime cache |
| `REDIS_HOST` | `redis` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_DB` | `0` | Redis logical database |

## Fleet Telemetry settings

| Variable | Default | Purpose |
|---|---:|---|
| `FLEET_TELEMETRY_ENABLED` | `false` | Enable Fleet Telemetry ingestion workflows |
| `FLEET_TELEMETRY_HOST` | empty | Public telemetry hostname for Tesla vehicle connections |
| `FLEET_TELEMETRY_PORT` | `4443` | Telemetry server port |
| `FLEET_TELEMETRY_TOPIC_BASE` | `telemetry` | MQTT topic prefix |
| `FLEET_TELEMETRY_BATCH_MS` | `100` | Signal batching window |
| `FLEET_TELEMETRY_STALE_TIMEOUT` | `15m` | Staleness threshold before fallback behavior |
| `FLEET_TELEMETRY_FALLBACK_POLL_INTERVAL` | `5m` | Polling fallback when stream is stale |
| `FLEET_TELEMETRY_SNAPSHOT_WRITE_INTERVAL` | `10s` bare binary; Compose/Helm commonly set `1s` | Snapshot write throttle |
| `FLEET_TELEMETRY_CLEANUP_INTERVAL` | `2m` | Stale session cleanup interval |
| `FLEET_TELEMETRY_STALE_SESSION_TIMEOUT` | `5m` | Close idle drive/charge sessions after this duration |

## Vehicle command proxy

| Variable | Default | Purpose |
|---|---:|---|
| `TESLA_COMMAND_PROXY_URL` | empty | URL for Tesla's Vehicle Command proxy. When empty, commands are sent unsigned and may fail on vehicles requiring signed commands. |

In Compose, the proxy is available through the `commands` profile as `vehicle-command-proxy`. In Helm, use `commandProxy.enabled` or `commandProxy.external.url`.

## Optional raw telemetry capture

| Variable | Default | Purpose |
|---|---:|---|
| `MONGODB_ENABLED` | `false` | Enable optional MongoDB-backed raw telemetry capture |
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection URI |
| `MONGODB_DATABASE` | `teslasync` | MongoDB database name |
| `MONGODB_TTL_DAYS` | `7` | Raw telemetry retention TTL |

## Observability settings

| Variable | Default | Purpose |
|---|---:|---|
| `OTEL_ENABLED` | `false` | Enable OpenTelemetry tracing |
| `OTEL_ENDPOINT` | `localhost:4317`; Compose/Helm often set `jaeger:4317` | OTLP gRPC collector endpoint |
| `OTEL_SERVICE_NAME` | `teslasync` | Service name for traces |
| `OTEL_INSECURE` | `true` | Use insecure OTLP transport |

## Maps and cost analysis

| Variable | Default | Purpose |
|---|---:|---|
| `GOOGLE_MAPS_API_KEY` | empty | Optional Google Maps geocoding/tiles |
| `AZURE_MAPS_API_KEY` | empty | Optional Azure Maps geocoding/tiles |
| `GAS_PRICE_ENABLED` | `false` | Enable gas price polling for cost comparisons |
| `GAS_PRICE_POLL_INTERVAL` | `7d` | Gas price polling interval |
| `GAS_PRICE_API_KEY` | empty | EIA API key for gas price data |

## Helm web/API routing values

For the default same-origin deployment, browsers call `/api/v1/...` on the web host. Nginx inside the web pod proxies that path to the internal API service.

```yaml
config:
  apiEndpoint: "http://teslasync-dev-api.teslasync-dev.svc.cluster.local:8080"
  browserApiBase: ""
  webEndpoint: "https://teslasync.example.com"
  forwardAuthHeader: "X-Authentik-Username"
```

| Value | Meaning |
|---|---|
| `config.apiEndpoint` | Internal URL used by web/Nginx `proxy_pass`; safe to use `svc.cluster.local` here. |
| `config.browserApiBase` | Public browser API base. Leave empty for relative `/api/v1` paths. Never set this to a Kubernetes DNS name. |
| `config.webEndpoint` | Public web origin for CORS/auth redirects. |
| `config.forwardAuthHeader` | Header set by Authentik, Authelia, oauth2-proxy, or another ForwardAuth provider. |

## Frontend runtime preferences

User preferences such as theme, display mode, units, timezone, and dashboard layout are managed in the web UI and persisted through settings APIs/local storage as appropriate. Do not hardcode display units in pages; the frontend converts source units to user preferences.

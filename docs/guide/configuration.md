# Configuration

TeslaSync is configured with environment variables. Compose interpolates `.env`
into its declared service configuration; it does **not** automatically pass every
variable to every container. Helm derives container environments from chart values.
Use this reference alongside `internal/config/config.go`, `docker-compose.yml`,
and the chart templates for your checkout.

For a first installation, follow [Getting Started](/guide/getting-started).
Before connecting an account, configure token encryption and review the
[Compose environment overrides](/deployment/docker#required-environment-overrides).
Never paste resolved `docker compose config` output into an issue: it may contain secrets.

## Required Tesla settings

| Variable               | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `TESLA_CLIENT_ID`      | Tesla Developer application client ID                                  |
| `TESLA_CLIENT_SECRET`  | Tesla Developer application secret                                     |
| `TESLA_REDIRECT_URI`   | OAuth callback URL (`https://your-domain/api/v1/auth/callback` in prod)|
| `TESLA_API_BASE_URL`   | Tesla Fleet API region endpoint (NA / EU / CN — see [Tesla Fleet API](/guide/tesla-fleet-api#step-2-pick-a-region)) |

The six OAuth scopes TeslaSync requests are fixed in code (`internal/tesla/client_auth.go`): `openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds`. Missing permissions can prevent the corresponding features from working; reauthorize after changing granted access.

## Authentication & identity

TeslaSync delegates user identity to a reverse-proxy auth provider (Authentik, Authelia, oauth2-proxy, Keycloak proxy, Cloudflare Access, Tailscale Funnel, etc.). It does **not** ship a built-in login form.

| Variable                | Default                              | Purpose                                                                                                                            |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `FORWARD_AUTH_HEADER`   | empty (open mode)                    | Name of the request header the proxy injects (e.g. `X-Forwarded-User`, `X-Authentik-Username`, `Remote-User`, `X-Auth-Request-User`) |
| `AUTH_PROVIDER_HINT`    | empty                                | Display label surfaced in `/api/v1/system/auth-mode` so the UI can describe the provider                                            |
| `AUTHENTIK_URL`         | empty                                | Authentik JWKS URL for direct SSE JWT validation (production-only)                                                                  |
| `AUTHENTIK_HMAC_KEY`    | empty                                | HMAC key used when the Authentik bypass IngressRoute mints signed SSE cookies                                                       |

### Behaviour matrix

| `FORWARD_AUTH_HEADER` | What happens on a request                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty / unset         | **Open mode.** Anonymous requests pass through. Identity-required endpoints (settings export, audit log, RBAC, API keys, impersonation, TOTP, scheduled exports) return `501` with code `AUTH_MODE_OPEN`. |
| Set to a header name  | **Forward-auth mode.** Every `/api/v1/*` request must carry that header. Missing → `401` with code `MISSING_IDENTITY`. Present → subject debounce-recorded into `auth_subjects` (60s window).            |

Open mode is intended for local trials on `localhost`. **Never expose an open-mode install to the public internet** — there is no enforcement on read paths and any caller can browse vehicle state.

Reference: `internal/api/forward_auth_middleware.go`, `internal/auth/subject.go`, `internal/auth/subject_recorder.go`.

## Token encryption

Tesla OAuth tokens (access + refresh) are stored in the `users` table. `ENCRYPTION_KEY` controls whether they are encrypted with AES-GCM at rest.

| Variable          | Default | Behaviour                                                                                                                                                |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`  | empty   | base64-encoded key used to derive the AES-GCM wrapping key. Generate with `openssl rand -base64 32`.                                                     |
| `APP_ENV`         | empty   | When `production` (or `prod`), an empty `ENCRYPTION_KEY` causes the API to `log.Fatal` at startup. Source: `internal/crypto/crypto.go`.                  |
| `GO_ENV`          | empty   | Alias for `APP_ENV`. Same production-startup guard applies.                                                                                              |

| Environment                                            | `ENCRYPTION_KEY` unset                                          | `ENCRYPTION_KEY` set                  |
| ------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------- |
| Development (`APP_ENV`/`GO_ENV` unset or not production) | API logs a warning; tokens stored in **plaintext** in Postgres   | AES-GCM encryption applied            |
| Production (`APP_ENV=production` or `GO_ENV=production`) | API **refuses to start** (`ENCRYPTION_KEY is required`)         | AES-GCM encryption applied            |

Rotating `ENCRYPTION_KEY` makes existing encrypted tokens unreadable — every Tesla account on the install needs to re-run **Connect Tesla** after a rotation.

## Core service settings

| Variable                          | Default                       | Purpose                                            |
| --------------------------------- | ----------------------------- | -------------------------------------------------- |
| `TESLASYNC_PORT`                  | `4000` bare / `8080` compose  | API listen port                                    |
| `TESLASYNC_LOG_LEVEL`             | `info`                        | zerolog level (`debug`, `info`, `warn`, `error`)   |
| `CORS_ORIGINS`                    | empty                         | Allowed browser origins; empty = runtime default   |
| `WORKER_POLL_INTERVAL`            | `15s` bare / `30s` compose    | Polling interval when telemetry is not streaming   |
| `WORKER_SLEEP_POLL_MULT`          | `4`                           | Sleep-state polling backoff multiplier             |
| `DATABASE_HOST`                   | `postgres`                    | PostgreSQL / TimescaleDB host                      |
| `DATABASE_PORT`                   | `5432`                        | Database port                                      |
| `DATABASE_USER`                   | `teslasync`                   | Database user                                      |
| `DATABASE_PASS`                   | `teslasync`                   | Database password                                  |
| `DATABASE_NAME`                   | `teslasync`                   | Database name                                      |
| `DATABASE_SSLMODE`                | `disable`                     | PostgreSQL SSL mode                                |
| `DATABASE_MAX_CONNS`              | `12`                          | Maximum API pgx pool connections                   |
| `DATABASE_MIN_CONNS`              | `2`                           | Minimum warm API pgx connections                   |
| `DATABASE_STATEMENT_TIMEOUT`      | `30000`                       | Query timeout in milliseconds                      |
| `DATABASE_HEALTH_CHECK_PERIOD`    | `30s`                         | pgx pool health-check interval                     |
| `MQTT_ENABLED`                    | `true`                        | Enable MQTT integration                            |
| `MQTT_HOST`                       | `mosquitto`                   | MQTT broker host                                   |
| `MQTT_PORT`                       | `1883`                        | MQTT broker port                                   |
| `MQTT_CLIENT_ID`                  | `teslasync`                   | MQTT client ID                                     |
| `MQTT_PREFIX`                     | `teslasync`                   | MQTT topic prefix                                  |
| `REDIS_ENABLED`                   | `false` bare / `true` compose | Enable Redis-backed runtime cache                  |
| `REDIS_HOST`                      | `redis`                       | Redis host                                         |
| `REDIS_PORT`                      | `6379`                        | Redis port                                         |
| `REDIS_DB`                        | `0`                           | Redis logical database                             |
| `LIVE_SIGNAL_STORE_MODE`          | `hybrid`                      | `hybrid` (L1+L2 Redis) or `local` (L1-only)        |

## Fleet Telemetry settings

| Variable                                  | Default                       | Purpose                                            |
| ----------------------------------------- | ----------------------------- | -------------------------------------------------- |
| `FLEET_TELEMETRY_ENABLED`                 | `false`                       | Enable Fleet Telemetry ingestion                   |
| `FLEET_TELEMETRY_HOST`                    | empty                         | Public telemetry hostname (must have valid TLS)    |
| `FLEET_TELEMETRY_PORT`                    | `4443`                        | Telemetry server port                              |
| `FLEET_TELEMETRY_TOPIC_BASE`              | `telemetry`                   | MQTT topic prefix                                  |
| `FLEET_TELEMETRY_BATCH_MS`                | `100`                         | Per-vehicle persistence batching window            |
| `FLEET_TELEMETRY_BATCH_MAX_MESSAGES`      | `256`                         | Maximum messages in one persistence batch          |
| `FLEET_TELEMETRY_PERSISTENCE_CONCURRENCY` | `2`                           | Maximum concurrent telemetry persistence workers   |
| `FLEET_TELEMETRY_PERSISTENCE_QUEUE_CAPACITY` | `64`                        | Bounded telemetry admission queue capacity         |
| `FLEET_TELEMETRY_PERSISTENCE_TIMEOUT`       | `30s`                         | Timeout for one coalesced persistence batch        |
| `FLEET_TELEMETRY_STALE_TIMEOUT`           | `15m`                         | Staleness threshold before polling fallback        |
| `FLEET_TELEMETRY_FALLBACK_POLL_INTERVAL`  | `5m`                          | Polling fallback interval when stream is stale     |
| `FLEET_TELEMETRY_SNAPSHOT_WRITE_INTERVAL` | `10s`                         | Session snapshot write throttle                    |
| `FLEET_TELEMETRY_CLEANUP_INTERVAL`        | `2m`                          | Stale session cleanup interval                     |
| `FLEET_TELEMETRY_STALE_SESSION_TIMEOUT`   | `5m`                          | Close idle drive/charge sessions after this        |

## Vehicle Command Proxy

| Variable                  | Default | Purpose                                                                                              |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `TESLA_COMMAND_PROXY_URL` | empty   | URL of the Tesla Vehicle Command proxy. Required for vehicles that need signed commands (Model 3/Y from 2021+, Model S/X refresh, Cybertruck). `wake_up` always goes direct. |

In Compose, the proxy is in the `commands` profile as `vehicle-command-proxy`. In Helm use `commandProxy.enabled` or `commandProxy.external.url`. See [Remote Commands](/guide/remote-commands) for routing details and the full 65-endpoint reference.

## Helix AI settings

Helix AI ships **off by default per feature** (registry contract in `internal/ai/features/registry.go`). These variables only enable the infrastructure — each feature is still independently toggled in **Settings → Helix** in the UI.

| Variable                       | Default                            | Purpose                                                    |
| ------------------------------ | ---------------------------------- | ---------------------------------------------------------- |
| `AI_PROVIDER`                  | `ollama`                           | Active provider: `ollama`, `openai`, `azure`, `anthropic`  |
| `AI_MODEL`                     | provider-default                   | Override the chat model                                    |
| `AI_DAILY_BUDGET_USD`          | `0` (unlimited)                    | Hard daily spend cap; rejects calls when exceeded          |
| `AI_RATE_LIMIT_PER_MIN`        | `60`                               | Per-user rate limit on AI routes                           |
| `AI_REDACTION_ENABLED`         | `true`                             | Strip PII (VINs, locations, emails) before sending to LLM  |
| `OLLAMA_HOST`                  | `http://ollama:11434`              | Ollama base URL                                            |
| `OLLAMA_MODEL`                 | `llama3.1:8b`                      | Ollama chat model                                          |
| `OLLAMA_HEALTH_INTERVAL`       | `30s`                              | Health-prober interval (suspends provider on failure)      |
| `OPENAI_API_KEY`               | empty                              | OpenAI API key                                             |
| `OPENAI_MODEL`                 | `gpt-4o-mini`                      | OpenAI chat model                                          |
| `OPENAI_BASE_URL`              | `https://api.openai.com/v1`        | Override for compatible endpoints                          |
| `AZURE_OPENAI_ENDPOINT`        | empty                              | Azure OpenAI / Foundry endpoint                            |
| `AZURE_OPENAI_API_KEY`         | empty                              | Azure API key                                              |
| `AZURE_OPENAI_DEPLOYMENT`      | empty                              | Azure deployment name                                      |
| `AZURE_OPENAI_API_VERSION`     | `2024-08-01-preview`               | Azure API version                                          |
| `ANTHROPIC_API_KEY`            | empty                              | Anthropic API key                                          |
| `ANTHROPIC_MODEL`              | `claude-3-5-haiku-latest`          | Anthropic chat model                                       |
| `RAG_EMBED_MODEL`              | `text-embedding-3-small`           | Embedding model for the docs/help RAG corpus (pgvector)    |

See [Helix AI](/guide/helix-ai) for the full feature list, decorator chain, and provider matrix.

## Optional raw telemetry capture

| Variable           | Default                       | Purpose                                       |
| ------------------ | ----------------------------- | --------------------------------------------- |
| `MONGODB_ENABLED`  | `false`                       | Enable optional MongoDB raw signal capture    |
| `MONGODB_URI`      | `mongodb://localhost:27017`   | MongoDB connection URI                        |
| `MONGODB_DATABASE` | `teslasync`                   | MongoDB database name                         |
| `MONGODB_TTL_DAYS` | `7`                           | Raw telemetry retention TTL                   |

## Observability

| Variable             | Default                                | Purpose                              |
| -------------------- | -------------------------------------- | ------------------------------------ |
| `OTEL_ENABLED`       | `false`                                | Enable OpenTelemetry tracing         |
| `OTEL_ENDPOINT`      | `localhost:4317` / `jaeger:4317`       | OTLP gRPC collector endpoint         |
| `OTEL_SERVICE_NAME`  | `teslasync`                            | Service name for traces              |
| `OTEL_INSECURE`      | `true`                                 | Use insecure OTLP transport          |

## Maps and cost analysis

| Variable                  | Default | Purpose                                       |
| ------------------------- | ------- | --------------------------------------------- |
| `GOOGLE_MAPS_API_KEY`     | empty   | Optional Google Maps geocoding/tiles          |
| `AZURE_MAPS_API_KEY`      | empty   | Optional Azure Maps geocoding/tiles           |
| `GAS_PRICE_ENABLED`       | `false` | Enable gas price polling for cost comparisons |
| `GAS_PRICE_POLL_INTERVAL` | `7d`    | Gas price polling interval                    |
| `GAS_PRICE_API_KEY`       | empty   | EIA API key for gas price data                |

## Helm web/API routing values

For the default same-origin deployment, browsers call `/api/v1/...` on the web host. Nginx inside the web pod proxies that path to the internal API service.

```yaml
config:
  apiEndpoint: "http://teslasync-dev-api.teslasync-dev.svc.cluster.local:8080"
  browserApiBase: ""
  webEndpoint: "https://teslasync.example.com"
  forwardAuthHeader: "X-Authentik-Username"
```

| Value                       | Meaning                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `config.apiEndpoint`        | Internal URL used by web/Nginx `proxy_pass`; safe to use `svc.cluster.local`.                    |
| `config.browserApiBase`     | Public browser API base. Leave empty for relative `/api/v1` paths. Never set to a K8s DNS name.  |
| `config.webEndpoint`        | Public web origin for CORS / auth redirects.                                                     |
| `config.forwardAuthHeader`  | Header set by Authentik, Authelia, oauth2-proxy, or another ForwardAuth provider.                |

## Frontend runtime preferences

User-level preferences — theme, display mode, units (km/mi, °C/°F, kWh, bar/psi), date/time format, timezone, locale, currency, decimal precision, gas-comparison settings, and dashboard layout — are managed in the in-app **Settings** page and persisted through `/api/v1/settings`. Do not hardcode units in pages; the frontend converts SI source units to user preferences via `useUnits()` / `useFormatting()` at the React render boundary only.

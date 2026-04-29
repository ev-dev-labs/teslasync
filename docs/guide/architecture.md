# Architecture

TeslaSync is a self-hosted telemetry platform with a Go API, React SPA, Nginx web proxy, TimescaleDB/PostgreSQL storage, Redis cache, MQTT broker, optional MongoDB raw signal capture, and optional Fleet Telemetry server.

## Request flow

```mermaid
graph LR
    Browser[Browser / PWA] --> Traefik[Ingress / reverse proxy]
    Traefik --> Web[teslasync-web<br/>Nginx + static React]
    Web -->|/api/* proxy| API[teslasync-api<br/>Go + Chi]
    API --> PG[(TimescaleDB / PostgreSQL)]
    API --> Redis[(Redis live cache)]
    API --> MQTT[(Mosquitto MQTT)]
    API --> Tesla[Tesla Fleet API]
```

The recommended production path exposes only the web service at the public hostname. `/api` still works because Nginx in the web container proxies to `config.apiEndpoint` on the cluster network.

## Telemetry flow

```mermaid
graph TB
    TeslaVehicle[Tesla vehicle] -->|Fleet Telemetry stream| FleetTelemetry[Fleet Telemetry server]
    FleetTelemetry --> MQTT[MQTT broker]
    MQTT --> API[Telemetry subscriber in Go API]
    TeslaAPI[Tesla Fleet API polling] --> API
    API --> SignalStore[In-memory SignalStore]
    API --> Redis[Redis live state]
    API --> LiveState[(vehicle_live_state)]
    API --> SignalLog[(signal_log / raw history)]
    API --> Sessions[(drives + charging_sessions)]
    API --> SSE[SSE event hub]
    SSE --> Browser[React hooks]
```

Fleet Telemetry is preferred for high-frequency state. The current runtime uses both an in-memory SignalStore and Redis: SignalStore is per-process for FSM/CEP/session evaluation, while Redis mirrors live signals for cross-process reads, Pub/Sub fanout, and restart recovery. Polling remains available for setup, commands, refresh operations, and fallback when streaming is stale.

## Backend layers

| Layer | Package area | Responsibility |
|---|---|---|
| HTTP/router | `internal/api` | Chi router, middleware, handlers, rate limits, response helpers |
| Database | `internal/database` | pgx pool, repositories, migrations, query helpers |
| Models | `internal/models` | JSON/db structs with snake_case JSON tags |
| Tesla integration | `internal/tesla` | Fleet API client and command integrations |
| Telemetry | `internal/api/telemetry*`, MQTT packages | Signal ingestion, state flushing, session tracking, CEP evaluation |
| Workers | `internal/worker`, worker commands | Polling, notifications, exports, automations |
| Platform | resilience, tracing, metrics, crypto | Circuit breakers, OpenTelemetry, Prometheus, encryption |

## Frontend layers

| Layer | Directory | Responsibility |
|---|---|---|
| Routes | `web/src/App.tsx` | Lazy-loaded route declarations wrapped in Suspense + ErrorBoundary |
| Features | `web/src/features/*` | Domain pages and feature-local components |
| API hooks | `web/src/api/hooks/*` | TanStack Query hooks and mutations |
| Shared UI | `web/src/components/*` | UI, layout, charts, maps, feedback, forms, data display |
| Utilities | `web/src/lib/*` | formatting, units, resilience, signal catalog, exports, geospatial helpers |
| App hooks | `web/src/hooks/*` | SSE, settings, page title, shortcuts, virtual lists, notifications |

## Authentication model

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant Proxy as Ingress / ForwardAuth
    participant Web as Web Nginx
    participant API as Go API
    participant Tesla as Tesla OAuth

    User->>Browser: Open TeslaSync
    Browser->>Proxy: HTTPS request
    Proxy->>Proxy: Authenticate user if ForwardAuth is configured
    Proxy->>Web: Forward app/API request
    Browser->>API: /api/v1/auth/login or /auth/url
    API->>Tesla: OAuth authorization flow
    Tesla-->>API: Callback with code
    API->>API: Encrypt and persist tokens
    API-->>Browser: Auth status and app data
```

ForwardAuth protects the main `/api/v1` group when `FORWARD_AUTH_HEADER` is configured. Public token routes such as shared drive reports and automation webhooks use token/rate-limit protection.

## Frontend real-time model

```mermaid
graph LR
    SSEManager[sseManager singleton] --> Hooks[useRealtimeEvents / feature hooks]
    Hooks --> Components[Dashboard, live map, vehicle pages]
    API[Go SSE endpoints] --> SSEManager
    Hooks -->|fallback| Query[TanStack Query polling]
    Query --> API
```

The browser should not create one EventSource per component. The shared manager fans out events and hooks fall back to adaptive polling when the stream is disconnected.

## Graceful shutdown

```mermaid
sequenceDiagram
    participant Kube as Kubernetes / OS
    participant API as Go API
    participant Workers as Workers
    participant DB as Database
    participant MQTT as MQTT

    Kube->>API: SIGTERM / PreStop /internal/flush
    API->>Workers: Stop intake and flush pending telemetry
    API->>DB: Finish in-flight writes
    API->>MQTT: Disconnect subscriber/client
    API-->>Kube: Exit after graceful drain
```

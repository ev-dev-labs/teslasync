# Architecture

TeslaSync follows a clean, modular architecture with clear separation between the API layer, business logic, data access, and external integrations.

## High-Level Overview

```mermaid
graph TB
    subgraph Frontend["React Frontend (Port 3000)"]
        UI["Vite + TypeScript + Tailwind + Leaflet"]
    end

    subgraph Backend["Go Backend (Port 8080)"]
        direction TB
        Router["Chi Router + Middleware"]
        subgraph Services
            API["API Handlers"]
            Worker["Worker Poller"]
            Tesla["Tesla Client"]
            MQTT["MQTT Client"]
        end
        DB_Layer["Database Layer (pgx) — 19 Repositories"]
        Router --> Services
        Services --> DB_Layer
    end

    subgraph External["External Services"]
        PG["PostgreSQL + TimescaleDB (Port 5432)"]
        Mosquitto["Mosquitto MQTT (Port 1883)"]
        Redis["Redis Cache (Port 6379)"]
        Grafana["Grafana (Port 3001)"]
        TeslaAPI["Tesla Fleet API"]
    end

    Frontend -- "HTTP / SSE" --> Backend
    DB_Layer --> PG
    MQTT --> Mosquitto
    Tesla --> TeslaAPI
    Backend --> Redis
    Grafana --> PG
```

## Component Architecture

### Backend Components

The Go backend is organized into well-defined packages under `internal/`:

```
internal/
├── api/          # HTTP handlers, middleware, routing
├── config/       # Environment-based configuration
├── database/     # PostgreSQL repositories (data access layer)
├── models/       # Domain models and types
├── mqtt/         # MQTT telemetry publisher
├── resilience/   # Circuit breaker, health checks
├── tesla/        # Tesla Fleet API client
└── worker/       # Background polling and maintenance jobs
```

### Request Flow

A typical API request flows through these layers:

```mermaid
sequenceDiagram
    participant Client as Browser
    participant Router as Chi Router
    participant MW as Middleware Chain
    participant Handler as API Handler
    participant Repo as Repository (pgx)
    participant DB as PostgreSQL

    Client->>Router: HTTP Request
    Router->>MW: Route Match
    MW->>MW: RequestID → RealIP → Logger → Recovery → Compress → Timeout → CORS → Security → RateLimit
    MW->>Handler: Validated Request
    Handler->>Repo: Query / Mutation
    Repo->>DB: SQL (prepared statement)
    DB-->>Repo: Rows
    Repo-->>Handler: Domain Model
    Handler-->>MW: JSON Response
    MW-->>Client: HTTP Response + Security Headers
```

### Middleware Stack

The middleware chain is applied in order, wrapping each request:

1. **RequestID** — Assigns a unique ID to each request for tracing
2. **RealIP** — Extracts the real client IP from proxy headers
3. **Logger** — Structured JSON logging with zerolog (method, path, status, duration)
4. **Recovery** — Catches panics, logs stack trace, returns 500
5. **Compress** — Gzip compression at level 5
6. **Timeout** — 30-second request deadline
7. **CORS** — Cross-origin resource sharing (configurable origins)
8. **Security Headers** — X-Content-Type-Options, X-Frame-Options, HSTS, CSP
9. **Rate Limiting** — 100 requests per minute per IP (httprate)

## Data Flow

### Vehicle Polling Loop

The worker continuously polls the Tesla Fleet API for vehicle data:

```mermaid
graph LR
    Worker["Worker Poll Loop<br/>(every 15s)"] --> TeslaAPI["Tesla Fleet API<br/>GetVehicles / GetData"]
    TeslaAPI --> Process["Process Response"]
    Process --> DB["Database<br/>Persist Positions"]
    Process --> MQTT_PUB["MQTT<br/>Publish Metrics"]
    Process --> SSE["SSE<br/>Broadcast to Clients"]
```

**Polling behavior:**
- **Active vehicles:** Polled every `WORKER_POLL_INTERVAL` (default 15s)
- **Sleeping vehicles:** Polled at `interval × WORKER_SLEEP_POLL_MULT` (default 60s)
- **Failed polls:** Exponential backoff with circuit breaker protection
- **Self-healing:** Automatically recovers when the Tesla API becomes available

### Real-Time Updates (SSE)

Server-Sent Events provide real-time updates to connected browsers:

```mermaid
sequenceDiagram
    participant Browser
    participant SSE as SSE Endpoint
    participant Hub as EventHub
    participant Worker

    Browser->>SSE: GET /api/v1/events
    SSE-->>Browser: SSE Connection (keep-alive)

    Worker->>Hub: Vehicle polled
    Hub->>SSE: Fan-out
    SSE-->>Browser: event: vehicle_update

    Worker->>Hub: Alert triggered
    Hub->>SSE: Fan-out
    SSE-->>Browser: event: alert

    Worker->>Hub: Charging started
    Hub->>SSE: Fan-out
    SSE-->>Browser: event: charging_update
```

The `EventHub` pattern broadcasts events to all connected clients using goroutines. Each client gets its own channel, and the hub fans out events to all subscribers.

### MQTT Telemetry

MQTT provides a lightweight pub/sub interface for integrating with home automation systems:

```
Topic Structure:
  teslasync/vehicles/{VIN}/battery_level    → 85
  teslasync/vehicles/{VIN}/rated_range      → 320
  teslasync/vehicles/{VIN}/latitude         → 37.7749
  teslasync/vehicles/{VIN}/longitude        → -122.4194
  teslasync/vehicles/{VIN}/speed            → 0
  teslasync/vehicles/{VIN}/power            → -1.2
  teslasync/vehicles/{VIN}/inside_temp      → 21.5
  teslasync/vehicles/{VIN}/outside_temp     → 18.2
  teslasync/vehicles/{VIN}/is_charging      → false
  teslasync/vehicles/{VIN}/is_locked        → true
  teslasync/vehicles/{VIN}/sentry_mode      → true
  teslasync/vehicles/{VIN}/vehicle_data     → { full JSON }
```

## Database Design

### TimescaleDB Hypertables

The `positions` table is a TimescaleDB hypertable, which automatically partitions data by time for efficient range queries:

```sql
-- Created in migration 001
SELECT create_hypertable('positions', 'created_at');
```

This means queries like "get positions for vehicle X between date A and B" are extremely fast, even with millions of rows.

### Schema Overview

```mermaid
erDiagram
    vehicles ||--o{ positions : has
    vehicles ||--o{ drives : has
    vehicles ||--o{ charging_sessions : has
    vehicles ||--o{ vehicle_states : has
    vehicles ||--o{ battery_snapshots : has
    vehicles ||--o{ tire_pressure_snapshots : has
    vehicles ||--o{ vampire_drain_events : has
    vehicles ||--o{ daily_mileage : has
    vehicles ||--o{ software_updates : has
    vehicles ||--o{ alerts : has
    vehicles ||--o{ command_logs : has
    trips ||--o{ trip_drives : contains
    trip_drives }o--|| drives : references
    drives }o--o| addresses : "start/end"
    charging_sessions }o--o| addresses : location
    geofences ||--o{ geofence_electricity_rates : has
    notification_channels ||--o{ notification_logs : sends
    alerts ||--o{ notification_logs : triggers

    vehicles {
        int id PK
        bigint vehicle_id
        string vin
        string display_name
        string model
        string state
    }
    positions {
        int vehicle_id FK
        float lat
        float lng
        float speed
        float power
        float battery_level
        timestamp created_at
    }
    drives {
        int id PK
        int vehicle_id FK
        timestamp start_date
        float distance_km
        float duration_min
        float start_battery
        float end_battery
    }
    charging_sessions {
        int id PK
        int vehicle_id FK
        float energy_added_kwh
        float cost
        float charger_power_kw
        string charger_type
    }
```

### Data Retention

A background maintenance worker periodically cleans up old data:

- **General data** (drives, charging, etc.): Retained for `DATA_RETENTION_DAYS` (default 365)
- **GPS positions:** Retained for `POSITION_RETENTION_DAYS` (default 90)

## Resilience Patterns

### Circuit Breaker (Tesla API)

The Tesla API client uses the Sony gobreaker circuit breaker to prevent cascading failures:

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Closed: Success (reset counter)
    Closed --> Open: 5 consecutive failures
    Open --> Open: Reject request immediately
    Open --> HalfOpen: After 60s cooldown
    HalfOpen --> Closed: 3 successful requests
    HalfOpen --> Open: Any failure
```

### Health Monitoring

Four components are continuously monitored:

| Component | Check Method | Interval |
|-----------|-------------|----------|
| `database` | `SELECT 1` with 5s timeout | 60s |
| `mqtt` | Connection status | 60s |
| `tesla_api` | Circuit breaker state | 60s |
| `worker` | Goroutine alive check | 60s |

Degraded components are logged as warnings and reported via `/api/v1/system/status`.

### Graceful Shutdown

On receiving SIGINT or SIGTERM, TeslaSync performs an ordered shutdown:

1. Cancel the root context (signals all goroutines to stop)
2. HTTP server: 30-second drain period for in-flight requests
3. Close database connection pool
4. Disconnect MQTT client
5. Stop worker goroutines

## Frontend Architecture

### Component Hierarchy

```mermaid
graph TB
    App["App"] --> ThemeProvider["ThemeProvider<br/>5 themes × 4 modes"]
    ThemeProvider --> QueryClient["QueryClientProvider<br/>TanStack React Query"]
    QueryClient --> Router["BrowserRouter"]
    Router --> Layout["Layout<br/>Sidebar + TopNav + CommandPalette"]
    Layout --> Suspense["Suspense<br/>Lazy-load fallback"]
    Suspense --> ErrorBound["ErrorBoundary<br/>Per-page isolation"]
    ErrorBound --> Pages["29 Lazy-Loaded Pages"]

    Pages --> Dashboard
    Pages --> LiveMap
    Pages --> Analytics
    Pages --> Drives
    Pages --> Charging
    Pages --> MorePages["...24 more"]
```

### State Management

- **Server state:** TanStack React Query (automatic caching, refetching, deduplication)
- **Real-time state:** `useRealtimeEvents` hook with SSE auto-reconnect
- **UI state:** React `useState` / `useReducer` (local component state)
- **Theme state:** React Context with localStorage persistence

### Build Pipeline

```mermaid
graph LR
    TS["TypeScript Source"] --> TSC["tsc (type check)"]
    TSC --> Vite["Vite (bundle)"]
    Vite --> Dist["dist/"]
    Dist --> Nginx["Nginx<br/>SPA routing<br/>Gzip compression"]
```

Vite produces an optimized SPA bundle with:
- Code splitting (per-route lazy loading)
- Tree shaking (unused code elimination)
- Asset hashing (cache busting)
- Gzip-ready output

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

## Database Tables

The schema spans 5 migrations and 21+ tables. Column names, types, and constraints are taken directly from the migration SQL files.

### Core Tables

#### `vehicles`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Internal auto-increment ID |
| `vehicle_id` | `BIGINT UNIQUE` | Tesla API vehicle ID |
| `vin` | `VARCHAR(17) UNIQUE` | Vehicle Identification Number |
| `display_name` | `VARCHAR(255)` | User-set vehicle name |
| `model` | `VARCHAR(50)` | Model S / 3 / X / Y / Cybertruck |
| `trim_badging` | `VARCHAR(50)` | Trim level (e.g. Long Range, Performance) |
| `exterior_color` | `VARCHAR(50)` | Exterior paint color |
| `wheel_type` | `VARCHAR(50)` | Wheel variant (Aero, Sport, etc.) |
| `state` | `VARCHAR(20)` | online / asleep / driving / charging / offline |
| `healthy` | `BOOLEAN` | Whether the vehicle is reachable |
| `created_at` | `TIMESTAMPTZ` | First sync timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last update timestamp |

#### `positions` *(TimescaleDB Hypertable)*

Partitioned by `created_at` for fast time-range queries over millions of rows.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL` | Row ID (composite PK with `created_at`) |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `latitude` | `DOUBLE PRECISION` | GPS latitude |
| `longitude` | `DOUBLE PRECISION` | GPS longitude |
| `speed` | `DOUBLE PRECISION` | Speed in km/h |
| `power` | `DOUBLE PRECISION` | Power draw in kW (negative = regen) |
| `heading` | `INTEGER` | Compass heading 0–360° |
| `elevation` | `DOUBLE PRECISION` | Elevation in meters |
| `odometer` | `DOUBLE PRECISION` | Odometer reading in km |
| `ideal_range` | `DOUBLE PRECISION` | Ideal range estimate in km |
| `rated_range` | `DOUBLE PRECISION` | Rated range estimate in km |
| `battery_level` | `INTEGER` | Battery % (0–100) |
| `inside_temp` | `DOUBLE PRECISION` | Cabin temperature °C |
| `outside_temp` | `DOUBLE PRECISION` | Ambient temperature °C |
| `fan_status` | `INTEGER` | HVAC fan speed |
| `is_climate_on` | `BOOLEAN` | Climate control active |
| `created_at` | `TIMESTAMPTZ` | Timestamp (hypertable partition key) |

#### `drives`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Drive ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `start_date` | `TIMESTAMPTZ` | Drive start timestamp |
| `end_date` | `TIMESTAMPTZ` | Drive end timestamp (NULL if in progress) |
| `start_position_id` | `BIGINT` | Starting position row ID |
| `end_position_id` | `BIGINT` | Ending position row ID |
| `start_address_id` | `BIGINT` | Starting address FK |
| `end_address_id` | `BIGINT` | Ending address FK |
| `distance` | `DOUBLE PRECISION` | Distance driven in km |
| `duration_min` | `DOUBLE PRECISION` | Duration in minutes |
| `start_range_km` | `DOUBLE PRECISION` | Rated range at start |
| `end_range_km` | `DOUBLE PRECISION` | Rated range at end |
| `speed_max` | `DOUBLE PRECISION` | Maximum speed in km/h |
| `power_max` | `DOUBLE PRECISION` | Peak power draw in kW |
| `power_min` | `DOUBLE PRECISION` | Max regen power in kW (negative) |
| `start_battery_level` | `INTEGER` | Battery % at start |
| `end_battery_level` | `INTEGER` | Battery % at end |
| `inside_temp_avg` | `DOUBLE PRECISION` | Average cabin temp °C |
| `outside_temp_avg` | `DOUBLE PRECISION` | Average ambient temp °C |

#### `charging_sessions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Session ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `start_date` | `TIMESTAMPTZ` | Charging start |
| `end_date` | `TIMESTAMPTZ` | Charging end (NULL if active) |
| `address_id` | `BIGINT` | Location FK |
| `charge_energy_added` | `DOUBLE PRECISION` | Energy added in kWh |
| `charge_energy_used` | `DOUBLE PRECISION` | Total energy drawn (incl. losses) |
| `start_battery_level` | `INTEGER` | Battery % at start |
| `end_battery_level` | `INTEGER` | Battery % at end |
| `start_range_km` | `DOUBLE PRECISION` | Range at start |
| `end_range_km` | `DOUBLE PRECISION` | Range at end |
| `charger_phases` | `INTEGER` | AC phases (1 or 3) |
| `charger_voltage` | `INTEGER` | Charger voltage (V) |
| `charger_actual_current` | `INTEGER` | Actual current (A) |
| `charger_power` | `DOUBLE PRECISION` | Charger power in kW |
| `fast_charger_type` | `VARCHAR(100)` | DC fast charger type |
| `fast_charger_brand` | `VARCHAR(100)` | Supercharger / CCS / CHAdeMO brand |
| `conn_charge_cable` | `VARCHAR(100)` | Cable type (SAE, IEC, etc.) |
| `cost` | `DOUBLE PRECISION` | Estimated cost |
| `duration_min` | `DOUBLE PRECISION` | Session duration in minutes |

#### `addresses`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Address ID |
| `display_name` | `TEXT` | Human-readable label |
| `latitude` | `DOUBLE PRECISION` | Latitude |
| `longitude` | `DOUBLE PRECISION` | Longitude |
| `name` | `VARCHAR(255)` | Place name |
| `house_number` | `VARCHAR(50)` | Street number |
| `road` | `VARCHAR(255)` | Street name |
| `city` | `VARCHAR(255)` | City |
| `county` | `VARCHAR(255)` | County / district |
| `state` | `VARCHAR(255)` | State / province |
| `country` | `VARCHAR(255)` | Country |
| `postcode` | `VARCHAR(50)` | Postal code |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

#### `geofences`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Geofence ID |
| `name` | `VARCHAR(255)` | Geofence label |
| `latitude` | `DOUBLE PRECISION` | Center latitude |
| `longitude` | `DOUBLE PRECISION` | Center longitude |
| `radius` | `DOUBLE PRECISION` | Radius in meters (default 50) |
| `cost_per_kwh` | `DOUBLE PRECISION` | Current electricity rate (added in migration 4) |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last update timestamp |

#### `geofence_electricity_rates`

Temporal versioning — when `cost_per_kwh` changes, old rates are preserved so historical charging costs remain accurate.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Rate ID |
| `geofence_id` | `BIGINT FK` | References `geofences.id` |
| `cost_per_kwh` | `DOUBLE PRECISION` | Rate in local currency per kWh |
| `effective_from` | `TIMESTAMPTZ` | Rate start date |
| `effective_to` | `TIMESTAMPTZ` | Rate end date (NULL = current) |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

### State & Telemetry Tables

#### `vehicle_states`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | State record ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `state` | `VARCHAR(20)` | online / asleep / driving / charging / updating / offline |
| `start_date` | `TIMESTAMPTZ` | State start time |
| `end_date` | `TIMESTAMPTZ` | State end time (NULL if current) |
| `duration_min` | `DOUBLE PRECISION` | Duration in minutes |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

#### `battery_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Snapshot ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `health_score` | `DOUBLE PRECISION` | Battery health 0–100 |
| `capacity_kwh` | `DOUBLE PRECISION` | Current usable capacity |
| `degradation_pct` | `DOUBLE PRECISION` | Degradation percentage |
| `est_range_km` | `DOUBLE PRECISION` | Estimated range |
| `cycle_count` | `INTEGER` | Charge cycle count |
| `avg_cell_temp_c` | `DOUBLE PRECISION` | Average cell temperature °C |
| `created_at` | `TIMESTAMPTZ` | Snapshot timestamp |

#### `tire_pressure_snapshots` *(TimescaleDB Hypertable)*

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Snapshot ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `front_left` | `DOUBLE PRECISION` | Front-left pressure (bar) |
| `front_right` | `DOUBLE PRECISION` | Front-right pressure (bar) |
| `rear_left` | `DOUBLE PRECISION` | Rear-left pressure (bar) |
| `rear_right` | `DOUBLE PRECISION` | Rear-right pressure (bar) |
| `created_at` | `TIMESTAMPTZ` | Timestamp (hypertable partition key) |

#### `vampire_drain_events`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Event ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `start_date` | `TIMESTAMPTZ` | Drain period start |
| `end_date` | `TIMESTAMPTZ` | Drain period end |
| `start_battery` | `INTEGER` | Battery % at start |
| `end_battery` | `INTEGER` | Battery % at end |
| `battery_lost` | `INTEGER` | Percentage points lost |
| `range_lost_km` | `DOUBLE PRECISION` | Range lost in km |
| `duration_hours` | `DOUBLE PRECISION` | Parked duration in hours |
| `drain_rate_pct_per_hour` | `DOUBLE PRECISION` | Drain rate %/hr |
| `outside_temp_avg` | `DOUBLE PRECISION` | Average ambient temp °C |
| `sentry_mode` | `BOOLEAN` | Whether Sentry Mode was active |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

### Mileage & Trip Tables

#### `daily_mileage`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Row ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `date` | `DATE` | Calendar date (unique per vehicle) |
| `distance_km` | `DOUBLE PRECISION` | Total distance driven |
| `odometer_start` | `DOUBLE PRECISION` | Odometer at start of day |
| `odometer_end` | `DOUBLE PRECISION` | Odometer at end of day |
| `drive_count` | `INTEGER` | Number of drives |
| `energy_used_kwh` | `DOUBLE PRECISION` | Energy consumed |

#### `visited_locations`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Row ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `address_id` | `BIGINT FK` | References `addresses.id` |
| `visit_count` | `INTEGER` | Total visits |
| `total_duration_min` | `DOUBLE PRECISION` | Total time spent (min) |
| `last_visited` | `TIMESTAMPTZ` | Most recent visit |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

#### `trips`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Trip ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `name` | `VARCHAR(255)` | Trip label |
| `start_date` | `TIMESTAMPTZ` | Trip start |
| `end_date` | `TIMESTAMPTZ` | Trip end |
| `total_distance_km` | `DOUBLE PRECISION` | Total distance |
| `total_energy_kwh` | `DOUBLE PRECISION` | Total energy used |
| `total_cost` | `DOUBLE PRECISION` | Total charging cost |
| `drive_count` | `INTEGER` | Drives in trip |
| `charge_count` | `INTEGER` | Charging stops |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

#### `trip_drives`

Join table linking trips to their constituent drives.

| Column | Type | Description |
|--------|------|-------------|
| `trip_id` | `BIGINT FK PK` | References `trips.id` |
| `drive_id` | `BIGINT FK PK` | References `drives.id` |

### Software & System Tables

#### `software_updates`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Update ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `version` | `VARCHAR(100)` | Software version string |
| `status` | `VARCHAR(50)` | available / downloading / installing / installed |
| `scheduled_at` | `TIMESTAMPTZ` | Scheduled install time |
| `installed_at` | `TIMESTAMPTZ` | Actual install time |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

#### `alerts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Alert ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` (SET NULL on delete) |
| `type` | `VARCHAR(50)` | Alert type (battery_low, speed, geofence, etc.) |
| `severity` | `VARCHAR(20)` | info / warning / critical |
| `title` | `VARCHAR(500)` | Alert title |
| `message` | `TEXT` | Detailed message |
| `is_read` | `BOOLEAN` | Read status |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

#### `alert_rules`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Rule ID |
| `name` | `VARCHAR(255)` | Rule name |
| `type` | `VARCHAR(50)` | Rule type (battery_low, battery_full, sentry, speed, geofence, software) |
| `enabled` | `BOOLEAN` | Whether the rule is active |
| `threshold` | `DOUBLE PRECISION` | Trigger threshold value |
| `vehicle_id` | `BIGINT FK` | Optional vehicle scope (NULL = all vehicles) |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last update |

#### `command_logs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Log ID |
| `vehicle_id` | `BIGINT FK` | References `vehicles.id` |
| `command` | `VARCHAR(100)` | Command name (flash_lights, honk_horn, etc.) |
| `params` | `TEXT` | JSON-encoded parameters |
| `status` | `VARCHAR(20)` | pending / success / failed |
| `error` | `TEXT` | Error message if failed |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

### Notification Tables

#### `notification_channels`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Channel ID |
| `name` | `TEXT` | Channel label |
| `type` | `TEXT` | discord / email / slack / telegram / webhook / ntfy / pushover |
| `config` | `JSONB` | Type-specific configuration (webhook URLs, tokens, etc.) |
| `enabled` | `BOOLEAN` | Whether channel is active |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last update |

#### `notification_logs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Log ID |
| `channel_id` | `BIGINT FK` | References `notification_channels.id` |
| `alert_id` | `BIGINT FK` | References `alerts.id` (SET NULL on delete) |
| `title` | `TEXT` | Notification title |
| `message` | `TEXT` | Notification body |
| `status` | `TEXT` | pending / sent / failed |
| `error` | `TEXT` | Error details if failed |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |
| `sent_at` | `TIMESTAMPTZ` | Delivery timestamp |

#### `chatbot_messages`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `BIGSERIAL PK` | Message ID |
| `session_id` | `TEXT` | Conversation session identifier |
| `role` | `TEXT` | user / assistant |
| `content` | `TEXT` | Message content |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

### Authentication & Config Tables

#### `tokens`

Single-row table (enforced by `CHECK (id = 1)`) storing the Tesla OAuth2 credentials.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `INTEGER PK` | Always 1 |
| `access_token` | `TEXT` | Tesla API access token |
| `refresh_token` | `TEXT` | Tesla API refresh token |
| `expires_at` | `TIMESTAMPTZ` | Token expiration |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last refresh timestamp |

#### `settings`

Single-row table for global application preferences.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `INTEGER PK` | Always 1 |
| `unit_of_length` | `VARCHAR(5)` | `km` or `mi` |
| `unit_of_temp` | `VARCHAR(5)` | `C` or `F` |
| `preferred_range` | `VARCHAR(10)` | `rated` or `ideal` |
| `language` | `VARCHAR(10)` | Language code (e.g. `en`) |
| `base_cost_per_kwh` | `DOUBLE PRECISION` | Default electricity cost |

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

# Diagrams

Visual diagrams documenting the TeslaSync architecture, data flows, and deployment topology.

## Deployment Architecture

```mermaid
graph TB
    subgraph Docker["Docker Compose Stack"]
        direction TB
        subgraph App["Application Layer"]
            Web["teslasync-web<br/>Nginx + React SPA<br/>:3000"]
            API["teslasync<br/>Go Backend<br/>:8080"]
        end
        subgraph Data["Data Layer"]
            PG["PostgreSQL 17<br/>:5432"]
            Redis["Redis 7<br/>Cache / Sessions<br/>:6379"]
        end
        subgraph Integration["Integration Layer"]
            Grafana["Grafana 10.4<br/>Dashboards<br/>:3001"]
            Mosquitto["Mosquitto 2<br/>MQTT Broker<br/>:1883 / :9001"]
        end
    end

    User["👤 User Browser"] --> Web
    Web --> API
    API --> PG
    API --> Redis
    API --> Mosquitto
    Grafana --> PG
    API --> TeslaAPI["🚗 Tesla Fleet API"]
    HomeAuto["🏠 Home Automation"] --> Mosquitto

    style Web fill:#0ea5e9,color:#fff
    style API fill:#10b981,color:#fff
    style PG fill:#3b82f6,color:#fff
    style Redis fill:#ef4444,color:#fff
    style Grafana fill:#f59e0b,color:#000
    style Mosquitto fill:#8b5cf6,color:#fff
```

## Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as React Frontend
    participant API as Go Backend
    participant Tesla as Tesla OAuth2

    User->>UI: Click "Connect Tesla"
    UI->>API: GET /api/v1/auth/login
    API-->>UI: Redirect URL (Tesla OAuth)
    UI->>Tesla: Redirect to Tesla auth page
    User->>Tesla: Grant access
    Tesla->>API: Callback with auth code
    API->>Tesla: Exchange code for tokens
    Tesla-->>API: Access + Refresh tokens
    API->>API: Store tokens (encrypted)
    API-->>UI: Redirect to dashboard
    UI->>API: GET /api/v1/auth/status
    API-->>UI: { authenticated: true }
```

## Vehicle Data Collection Pipeline

```mermaid
graph LR
    subgraph Polling["Background Worker"]
        Timer["Poll Timer<br/>(15s active, 60s sleep)"]
        CB["Circuit Breaker<br/>(gobreaker)"]
    end

    subgraph Processing["Data Processing"]
        Parse["Parse Response"]
        Detect["Detect State Changes"]
        Geo["Reverse Geocode"]
    end

    subgraph Storage["Persistence"]
        Positions["positions<br/>(partitioned)"]
        Drives["drives<br/>charging_sessions"]
        States["vehicle_states"]
        Metrics["battery_snapshots<br/>tire_pressure"]
    end

    subgraph Broadcast["Real-Time"]
        SSE["SSE Events"]
        MQTT["MQTT Topics"]
        Alerts["Alert Engine"]
    end

    Timer --> CB --> TeslaAPI["Tesla API"]
    TeslaAPI --> Parse
    Parse --> Detect
    Detect --> Geo
    Geo --> Positions & Drives & States & Metrics
    Parse --> SSE & MQTT
    Detect --> Alerts
```

## Notification Delivery

```mermaid
graph TD
    AlertRule["Alert Rule Triggered"] --> Engine["Notification Engine"]
    Engine --> Discord["Discord Webhook"]
    Engine --> Email["Email (SMTP)"]
    Engine --> Slack["Slack Webhook"]
    Engine --> Telegram["Telegram Bot"]
    Engine --> Webhook["Custom Webhook"]
    Engine --> Ntfy["ntfy Push"]
    Engine --> Pushover["Pushover"]

    Discord --> Log["notification_logs"]
    Email --> Log
    Slack --> Log
    Telegram --> Log
    Webhook --> Log
    Ntfy --> Log
    Pushover --> Log
```

## Frontend Data Flow

```mermaid
graph TB
    subgraph Hooks["React Hooks"]
        RQ["useQuery<br/>(TanStack)"]
        RT["useRealtimeEvents<br/>(SSE)"]
        Theme["useTheme<br/>(Context)"]
    end

    subgraph Transport["Network Layer"]
        Resilient["resilientFetch<br/>+ Circuit Breaker"]
        SSE_Client["EventSource<br/>Auto-Reconnect"]
    end

    subgraph Cache["Client Cache"]
        QCache["Query Cache<br/>(stale-while-revalidate)"]
        LS["localStorage<br/>(theme, settings)"]
    end

    RQ --> Resilient --> API["Go Backend API"]
    Resilient --> QCache
    RT --> SSE_Client --> API
    Theme --> LS

    QCache --> Components["React Components"]
    SSE_Client --> Components
    LS --> Components
```

## Database Table Relationships

```mermaid
erDiagram
    vehicles ||--o{ positions : "GPS telemetry"
    vehicles ||--o{ drives : "drive sessions"
    vehicles ||--o{ charging_sessions : "charge events"
    vehicles ||--o{ vehicle_states : "state timeline"
    vehicles ||--o{ battery_snapshots : "health tracking"
    vehicles ||--o{ tire_pressure_snapshots : "tire PSI"
    vehicles ||--o{ vampire_drain_events : "parasitic drain"
    vehicles ||--o{ daily_mileage : "daily stats"
    vehicles ||--o{ software_updates : "OTA updates"
    vehicles ||--o{ alerts : "alert history"
    vehicles ||--o{ command_logs : "command audit"

    trips ||--o{ trip_drives : "journey legs"
    trip_drives }o--|| drives : references

    drives }o--o| addresses : "start/end location"
    charging_sessions }o--o| addresses : "charge location"

    geofences ||--o{ geofence_electricity_rates : "cost history"
    notification_channels ||--o{ notification_logs : "delivery log"
    alerts ||--o{ notification_logs : "triggers"

    vehicles {
        int id PK
        bigint vehicle_id UK
        string vin UK
        string display_name
        string model
        string state
        float health_score
    }
    positions {
        int vehicle_id FK
        float latitude
        float longitude
        float speed
        float power
        float battery_level
        float inside_temp
        float outside_temp
        timestamp created_at
    }
    drives {
        int id PK
        int vehicle_id FK
        int start_address_id FK
        int end_address_id FK
        timestamp start_date
        timestamp end_date
        float distance_km
        float duration_min
        float avg_speed
        float max_speed
        float start_battery
        float end_battery
    }
    charging_sessions {
        int id PK
        int vehicle_id FK
        int address_id FK
        float energy_added_kwh
        float cost
        float charger_power_kw
        float charger_voltage
        string charger_type
        float duration_min
    }
```

## Graceful Shutdown Sequence

```mermaid
sequenceDiagram
    participant OS as Operating System
    participant Main as main()
    participant HTTP as HTTP Server
    participant Worker as Poll Worker
    participant DB as Database Pool
    participant MQTT as MQTT Client

    OS->>Main: SIGINT / SIGTERM
    Main->>Main: Cancel root context
    Main->>HTTP: Shutdown(30s deadline)
    HTTP->>HTTP: Drain in-flight requests
    HTTP-->>Main: Done
    Main->>Worker: Stop goroutines
    Worker-->>Main: Stopped
    Main->>MQTT: Disconnect
    MQTT-->>Main: Disconnected
    Main->>DB: Close pool
    DB-->>Main: Closed
    Main->>OS: Exit 0
```

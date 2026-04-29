# Diagrams

Visual diagrams for the current TeslaSync architecture, data flows, and deployment topology. Click diagrams to zoom using the custom VitePress theme overlay.

## Production traffic

```mermaid
graph TB
    User[User Browser / PWA] --> DNS[Public DNS]
    DNS --> Traefik[Traefik / Ingress]
    Traefik --> Web[teslasync-web<br/>Nginx + React build]
    Web -->|static assets| User
    Web -->|/api proxy| API[teslasync-api<br/>Go 1.25]
    API --> PG[(TimescaleDB/PostgreSQL 17)]
    API --> Redis[(Redis 7)]
    API --> MQTT[(Mosquitto)]
    API --> Mongo[(MongoDB optional raw signals)]
    API --> Tesla[Tesla Fleet API]

    style Web fill:#0ea5e9,color:#fff
    style API fill:#10b981,color:#fff
    style PG fill:#3b82f6,color:#fff
    style Redis fill:#ef4444,color:#fff
    style MQTT fill:#8b5cf6,color:#fff
```

## Fleet Telemetry ingestion

```mermaid
sequenceDiagram
    participant Vehicle as Tesla Vehicle
    participant FT as Fleet Telemetry Server
    participant MQTT as Mosquitto
    participant API as TeslaSync API
    participant DB as TimescaleDB/PostgreSQL
    participant UI as React SPA

    Vehicle->>FT: WSS telemetry stream
    FT->>MQTT: Publish decoded signals
    MQTT->>API: Subscribe and process batch
    API->>API: Normalize units and update SignalStore
    API->>Redis: Mirror live signals
    API->>DB: Flush live state, sessions, positions, signal history
    API-->>UI: SSE events for live pages
```

## Polling fallback

```mermaid
graph LR
    Timer[Adaptive poll timer] --> Breaker[Circuit breaker]
    Breaker --> Tesla[Tesla Fleet API]
    Tesla --> Parser[Response parser]
    Parser --> State[Runtime live state]
    Parser --> DB[(PostgreSQL)]
    Parser --> SSE[SSE hub]
    SSE --> UI[React hooks]
```

## Frontend data flow

```mermaid
graph TB
    subgraph Browser
        Routes[Lazy React routes]
        Query[TanStack Query cache]
        SSE[sseManager singleton]
        Theme[Theme/settings providers]
        PWA[Service worker]
    end

    Routes --> Query
    Routes --> SSE
    Routes --> Theme
    Query --> Client[request() API client]
    Client --> API[/api/v1]
    SSE --> Events[/api/v1 events]
    PWA --> Assets[Static assets, fonts, map tiles]
```

## Database relationship sketch

```mermaid
erDiagram
    vehicles ||--o{ drives : records
    vehicles ||--o{ charging_sessions : records
    vehicles ||--o{ positions : tracks
    vehicles ||--o{ vehicle_live_state : current
    vehicles ||--o{ alerts : triggers
    vehicles ||--o{ command_logs : audits
    drives ||--o{ drive_telemetry_readings : samples
    drives ||--o{ trip_drives : groups
    trips ||--o{ trip_drives : contains
    charging_sessions ||--o{ charging_telemetry : samples
    notification_channels ||--o{ notification_logs : delivers
    alert_rules ||--o{ alerts : fires
```

## Deployment modes

```mermaid
graph LR
    Compose[Docker Compose] --> Local[Local self-hosted stack]
    Helm[Helm chart] --> K8s[Kubernetes]
    K8s --> Traefik[Traefik IngressRoute]
    K8s --> StandardIngress[Standard Ingress]
    K8s --> ExternalDB[External Postgres/Redis/Mongo optional]
    Compose --> Profiles[tracing and telemetry profiles]
```

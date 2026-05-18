# Diagrams

Visual diagrams for the current TeslaSync architecture, data flows, and deployment topology. Click diagrams to zoom using the VitePress theme overlay.

## Production traffic

```mermaid
graph TB
    User[User Browser / PWA] --> DNS[Public DNS]
    DNS --> Traefik[Traefik / Ingress]
    Traefik --> Web[teslasync-web<br/>Nginx + React build]
    Web -->|static assets| User
    Web -->|/api proxy| API[teslasync-api<br/>Go 1.25]
    API --> PG[(TimescaleDB / PostgreSQL 17)]
    API --> Redis[(Redis 7)]
    API --> MQTT[(Mosquitto)]
    API --> Mongo[(MongoDB optional raw signals)]
    API --> Tesla[Tesla Fleet API]
    API --> Helix[Helix AI providers]

    style Web fill:#0ea5e9,color:#fff
    style API fill:#10b981,color:#fff
    style PG fill:#3b82f6,color:#fff
    style Redis fill:#ef4444,color:#fff
    style MQTT fill:#8b5cf6,color:#fff
    style Helix fill:#06b6d4,color:#fff
```

## Fleet Telemetry ingestion

```mermaid
sequenceDiagram
    participant Vehicle as Tesla Vehicle
    participant FT as Fleet Telemetry Server
    participant MQTT as Mosquitto
    participant API as teslasync-api
    participant L1 as signal.Store (L1)
    participant L2 as Redis (L2)
    participant DB as TimescaleDB
    participant UI as React SPA

    Vehicle->>FT: WSS telemetry stream
    FT->>MQTT: Publish decoded signals
    MQTT->>API: Subscribe + decode
    API->>L1: Write-through
    API->>L2: Mirror + Pub/Sub
    API->>DB: Append signal_log + flush sessions
    API-->>UI: SSE deltas
```

## Polling fallback

```mermaid
graph LR
    Timer[Adaptive poll timer] --> Breaker[Circuit breaker]
    Breaker --> Tesla[Tesla Fleet API]
    Tesla --> Parser[Response parser]
    Parser --> L1[L1 signal.Store]
    Parser --> DB[(PostgreSQL)]
    Parser --> SSE[SSE hub]
    SSE --> UI[React hooks]
```

## Remote-command routing

```mermaid
graph TB
    UI[Web UI / API call] --> Handler["POST /api/v1/vehicles/{id}/command"]
    Handler --> Client["internal/tesla/client_commands.go"]
    Client --> Check{Command name?}
    Check -->|wake_up| Direct[Tesla Fleet API direct]
    Check -->|other 64 commands| ProxyCheck{TESLA_COMMAND_PROXY_URL set?}
    ProxyCheck -->|yes| Proxy[Vehicle Command Proxy<br/>signed commands]
    ProxyCheck -->|no| DirectUnsigned[Tesla Fleet API direct<br/>may fail on newer vehicles]
    Proxy --> Tesla[Tesla Fleet API]
    Direct --> Tesla
    DirectUnsigned --> Tesla
```

See [Remote Commands](/guide/remote-commands) for the full 65-endpoint reference.

## Helix AI request

```mermaid
sequenceDiagram
    participant UI as React AIFeatureCard
    participant Route as "/api/v1/ai/{feature}/run"
    participant Wrap as g.Wrap (feature toggle)
    participant Strat as Strategy
    participant Disp as Dispatcher
    participant Dec as Decorator chain
    participant Prov as Provider adapter
    participant LLM as LLM (Ollama / OpenAI / Azure / Anthropic)
    participant Log as ai_call_log

    UI->>Route: POST input
    Route->>Wrap: Check feature on
    Wrap->>Strat: Build prompt + tools
    Strat->>Disp: Dispatch with tool loop
    Disp->>Dec: trace -> audit -> cost -> ratelimit -> redact
    Dec->>Prov: Chat request
    Prov->>LLM: Wire request
    LLM-->>Prov: Response (+ tool calls)
    Prov-->>Dec: Decoded message
    Dec->>Log: Insert audit row
    Dec-->>Disp: Return to dispatcher
    Disp-->>UI: SSE deltas
```

## Frontend data flow

```mermaid
graph TB
    subgraph Browser
        Routes[Lazy React routes]
        Query[TanStack Query cache]
        SSE[sseManager singleton]
        Theme[Theme / settings providers]
        AI[withAiFeature HOC]
        PWA[Service worker]
    end

    Routes --> Query
    Routes --> SSE
    Routes --> Theme
    Routes --> AI
    Query --> Client[request API client]
    Client --> API["/api/v1"]
    SSE --> Events["/api/v1/events"]
    AI --> AIAPI["/api/v1/ai/*"]
    PWA --> Assets["Static assets, fonts, map tiles"]
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
    users ||--o{ ai_call_log : audits
    users ||--o{ ai_feature_state : toggles
```

## Deployment modes

```mermaid
graph LR
    Compose[Docker Compose] --> Local[Local self-hosted stack]
    Helm[Helm chart] --> K8s[Kubernetes]
    K8s --> Traefik[Traefik IngressRoute]
    K8s --> StandardIngress[Standard Ingress]
    K8s --> ExternalDB[External Postgres/Redis/Mongo optional]
    Compose --> Profiles[tracing / telemetry / commands profiles]
```

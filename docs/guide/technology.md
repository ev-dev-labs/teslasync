# Technology Stack

## Backend

| Technology | Role |
|---|---|
| Go 1.25 | API, workers, integrations |
| Chi v5 | HTTP router and middleware |
| pgx v5 | PostgreSQL connection pool and queries |
| zerolog | Structured logging |
| Prometheus | Metrics endpoint and scraping |
| OpenTelemetry | Optional distributed tracing |
| gobreaker / resilience helpers | Circuit breakers and guarded external calls |
| Eclipse Paho MQTT | MQTT telemetry integration |
| go-redis v9 | Redis live-state cache |

## Frontend

| Technology | Role |
|---|---|
| React 18 | SPA UI |
| TypeScript 5 | Type safety |
| Vite 5 | Dev/build pipeline and code splitting |
| TanStack Query 5 | API data cache and mutations |
| Tailwind CSS 3 | Utility styling and theme variables |
| Framer Motion | Animations |
| Recharts | Charts through shared chart barrels |
| Leaflet / React Leaflet | Maps through shared map barrels |
| i18next / react-i18next | Localization |
| vite-plugin-pwa | PWA manifest and service worker |

## Data and infrastructure

| Technology | Role |
|---|---|
| TimescaleDB/PostgreSQL 17 | Relational, time-series, live-state, analytics storage |
| pgvector | Embedding/search support |
| Redis 7 | Live cache and fast state reads |
| Mosquitto | MQTT broker |
| MongoDB 7 | Optional raw signal capture |
| Grafana 10.4 | Dashboards |
| Prometheus | Metrics storage/scraping |
| Docker Compose | Local/self-hosted stack |
| Helm | Kubernetes packaging |
| Traefik IngressRoute | Common production ingress option |
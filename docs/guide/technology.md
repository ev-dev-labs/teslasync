# Technology Stack

## Backend

| Technology                      | Role                                                    |
| ------------------------------- | ------------------------------------------------------- |
| Go 1.25.0                       | API, four worker binaries, Tesla + AI integrations      |
| Chi v5                          | HTTP router and middleware                              |
| pgx v5                          | PostgreSQL connection pool and queries                  |
| zerolog                         | Structured JSON logging                                 |
| Prometheus client               | `/metrics` endpoint                                     |
| OpenTelemetry SDK               | Optional distributed tracing                            |
| `golang-migrate`                | Database migration runner (197 numbered SQL files)      |
| `gobreaker` + resilience pkg    | Circuit breakers around external calls                  |
| Eclipse Paho MQTT v5            | Mosquitto telemetry integration                         |
| `go-redis` v9                   | Redis live-state cache + Pub/Sub                        |
| `crypto/aes` GCM                | At-rest encryption for Tesla tokens                     |

## Helix AI

| Component             | Role                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| Provider adapters     | `internal/ai/adapters/{ollama,openai,azure,anthropic,mock}`                   |
| Decorator chain       | `trace → audit → cost → ratelimit → redact` (outermost first)                 |
| Strategies            | 53 `internal/ai/strategies/<feature>/strategy.go` — per-feature prompts/tools |
| Tools                 | 50+ `internal/ai/tools/*.go` — context lookups invoked via tool-calls          |
| Feature registry      | `internal/ai/features/registry.go` — 54 user + 3 ops features, off-by-default |
| RAG                   | pgvector embeddings + `internal/ai/rag/docs_indexer.go`                       |
| Audit                 | `ai_call_log` table (provider, feature, tokens, cost, latency, error)         |

## Frontend

| Technology                | Role                                                       |
| ------------------------- | ---------------------------------------------------------- |
| React 18.3                | SPA UI                                                     |
| TypeScript 5              | Type safety                                                |
| Vite 5                    | Dev server, build, code splitting                          |
| TanStack Query 5          | API data cache and mutations                               |
| Tailwind CSS 3            | Utility styling with CSS-variable theme tokens             |
| Framer Motion 12          | Animations                                                 |
| Recharts 2                | Charts (via `@/components/charts` barrel)                  |
| Leaflet / React Leaflet   | Maps (via `@/components/maps` barrel)                      |
| i18next + react-i18next 25| Localization (en, more pluggable)                          |
| lucide-react              | Icon system                                                |
| OpenTelemetry Web SDK 2.7 | Frontend traces (optional)                                 |
| vite-plugin-pwa           | PWA manifest, service worker, offline app shell            |
| Vitest + Testing Library  | Unit / component tests                                     |

## Data & infrastructure

| Technology                   | Role                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| TimescaleDB / PostgreSQL 17  | Relational, time-series, live-state, RAG (pgvector), analytics    |
| pgvector                     | Embedding storage for the RAG help chatbot                        |
| Redis 7                      | L2 live-signal cache, Pub/Sub fanout, AI rate-limit counters      |
| Mosquitto                    | MQTT broker for Fleet Telemetry                                   |
| MongoDB 7                    | Optional raw signal capture (debugging)                           |
| Grafana 10.4                 | Operator dashboards (SQL-backed)                                  |
| Prometheus                   | Metrics scraping + alerting                                       |
| Jaeger                       | Trace UI (`--profile tracing`)                                    |
| Docker Compose               | Local + small self-hosted deployments (13 services)               |
| Helm                         | Kubernetes packaging (chart in `helm/teslasync`)                  |
| Traefik IngressRoute         | Common production ingress                                         |
| Tesla Fleet Telemetry server | Vendored proto; runs as a sidecar service                         |
| Tesla Vehicle Command proxy  | Required for signed commands on newer vehicles                    |
| Ollama                       | Local LLM inference for Helix AI                                  |

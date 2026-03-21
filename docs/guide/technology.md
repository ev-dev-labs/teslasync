# Technology Stack

A comprehensive overview of the technologies powering TeslaSync, including rationale for each choice.

## Backend

| Technology | Version | Purpose | Why |
|-----------|---------|---------|-----|
| **Go** | 1.22 | Application language | Compiles to a single binary, low memory footprint (~30 MB RSS), excellent concurrency with goroutines, strong standard library for HTTP/JSON |
| **Chi** | v5 | HTTP router | Lightweight, idiomatic Go, supports middleware chains, compatible with `net/http` |
| **pgx** | v5 | PostgreSQL driver | High-performance pure Go driver with connection pooling, prepared statements, batch queries, and native PostgreSQL type support |
| **zerolog** | latest | Structured logging | Zero-allocation JSON logger — no garbage collection pressure during high-throughput logging |
| **gobreaker** | latest | Circuit breaker | Sony's battle-tested implementation for protecting against cascading failures from the Tesla API |
| **httprate** | latest | Rate limiting | Configurable per-IP rate limiting middleware for Chi |

## Frontend

| Technology | Version | Purpose | Why |
|-----------|---------|---------|-----|
| **React** | 18 | UI framework | Component-based architecture, large ecosystem, concurrent rendering with Suspense |
| **TypeScript** | 5.x | Type safety | Catches errors at compile time, improves IDE autocomplete, self-documenting code |
| **Vite** | 5 | Build tool | Lightning-fast HMR (~50ms), optimized production builds with tree-shaking, native ESM |
| **Tailwind CSS** | 3.4 | Utility styles | Rapid prototyping, consistent design system, tiny production CSS with purging |
| **Recharts** | 2.12 | Data visualization | Built on D3.js, composable React components, responsive charts out of the box |
| **TanStack Query** | 5 | Data fetching | Automatic caching, background refetching, stale-while-revalidate, request deduplication |
| **React Leaflet** | latest | Maps | Open-source map rendering for vehicle tracking, drive routes, and geofence visualization |
| **Framer Motion** | latest | Animations | Declarative animations with spring physics, layout transitions, gesture support |
| **Lucide** | latest | Icons | 1000+ consistent, tree-shakeable SVG icons |

## Data Layer

| Technology | Version | Purpose | Why |
|-----------|---------|---------|-----|
| **PostgreSQL** | 17 | Primary database | ACID compliance, JSONB support, native partitioning for time-series data, excellent query optimizer, mature ecosystem |
| **Redis** | 7 | Cache & sessions | Sub-millisecond reads, LRU eviction, append-only persistence for durability |

## Integration

| Technology | Version | Purpose | Why |
|-----------|---------|---------|-----|
| **Mosquitto** | 2 | MQTT broker | Lightweight pub/sub messaging for home automation integration (Home Assistant, Node-RED) |
| **Grafana** | 10.4 | Dashboards | 16 pre-built dashboards with PostgreSQL datasource, alerting, and annotations |

## Infrastructure

| Technology | Purpose | Why |
|-----------|---------|-----|
| **Docker Compose** | Local/production deployment | Single-command deployment of all 6 services with health checks, resource limits, and volume persistence |
| **Nginx** | Frontend reverse proxy | Serves SPA with gzip compression, SPA fallback routing, and static asset caching |
| **GitHub Actions** | CI/CD | Automated builds, tests, and documentation deployment |
| **Prometheus** | Metrics collection | Exposes `/metrics` endpoint with Go runtime metrics, HTTP request metrics, and custom business metrics |

## Documentation

| Technology | Purpose | Why |
|-----------|---------|-----|
| **VitePress** | Documentation site | Fast static site generator, Markdown + Vue components, built-in search, Mermaid diagram support |
| **Mermaid** | Architecture diagrams | Text-based diagram syntax that renders in VitePress and GitHub markdown |

## Security

| Feature | Implementation |
|---------|---------------|
| **HTTPS** | TLS termination at reverse proxy |
| **CORS** | Configurable origin whitelist |
| **Rate Limiting** | 100 req/min per IP |
| **Security Headers** | X-Content-Type-Options, X-Frame-Options, HSTS, CSP |
| **OAuth2** | Tesla API authentication via authorization code flow |
| **Token Encryption** | Access/refresh tokens encrypted at rest |
| **Input Validation** | Request body validation on all mutation endpoints |

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Backend memory | ~30 MB RSS (idle), ~50 MB under load |
| Frontend bundle | ~350 KB gzipped (code-split per route) |
| API response time | <10ms for cached, <50ms for DB queries |
| SSE latency | <100ms from poll to client update |
| Cold start | <2s (Go binary + DB connection pool) |
| Docker image (backend) | ~25 MB (scratch base) |
| Docker image (frontend) | ~30 MB (Nginx alpine) |

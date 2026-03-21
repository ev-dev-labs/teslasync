# Changelog

All notable changes to TeslaSync are documented here.

## [0.1.0] - 2026-03-21

### 🚀 Features
- **29 interactive dashboard pages** with glassmorphism UI
- **5 color themes** × 4 display modes (dark, light, OLED, midnight)
- **Real-time SSE streaming** with auto-reconnect and event buffering
- **14 remote vehicle commands** (lock, unlock, climate, sentry, charge, frunk, trunk, horn, flash)
- **Smart Insights Engine** — auto-generated recommendations from driving/charging data
- **Drive Score** rating system (0-100 animated gauge)
- **16 Grafana dashboards** with verified SQL queries
- **Futuristic tire pressure visualization** with animated car SVG
- **Smart charging optimizer** with cost comparison by charger type
- **Monthly statistics tables** with inline spark bars
- **Charging cost analytics** — cost per kWh tracking, location comparison
- **State timeline bars** — Gantt-style vehicle state visualization
- **Software update timeline** — version progression chart
- **Projected range calculator** with weather/driving condition adjustments
- **Vehicle comparison page** — side-by-side metrics with radar chart
- **Total cost of ownership calculator** — EV vs gas comparison
- **Trip planner** with range estimation and charging stop calculation
- **PDF report generation** for drives and monthly summaries
- **Global search** across vehicles, drives, locations in command palette
- **Fleet efficiency leaderboard** with rankings
- **Onboarding wizard** — 4-step first-time setup
- **API key management** with HMAC-SHA256 authentication
- **Inbound webhook API** for external system integration
- **7-channel notifications** (Discord, Slack, Telegram, Email, Webhook, ntfy, Pushover)
- **12 configurable alert types** with quiet hours and digest mode
- **Data privacy controls** — anonymize locations, GDPR export
- **Unit preferences** — km/mi, °C/°F applied across all pages

### 🔧 Infrastructure
- **PostgreSQL 17** with native partitioning (replaced TimescaleDB)
- **Helm chart v0.3.0** — embedded/external services, IngressRoute, HPA, PDB
- **14 GitHub Actions workflows** — CI, Docker, security, quality, release
- **Tesla Fleet API billing optimization** — adaptive polling ($3/month vs $192)
- **Docker Compose** — 6 services (API, Web, PostgreSQL, Redis, MQTT, Grafana)
- **127 automated tests** (84 Go + 43 frontend)
- **E2E test suite** with 25+ endpoint checks
- **SBOM generation** + container image signing
- **Dependabot** for Go, npm, Docker, Actions dependencies

### 📝 Documentation
- **VitePress docs site** with Mermaid diagrams and automotive animations
- **54-endpoint API reference** with JSON examples
- **Complete database schema** documentation (21 tables)
- **Technology stack** rationale
- **Troubleshooting guide** + FAQ
- **Roadmap** with 4 release tiers

### 🔒 Security
- **CodeQL** SAST for Go + JavaScript
- **govulncheck** for Go CVE scanning
- **HMAC webhook signatures**
- **API key auth middleware**
- **Rate limiting** (100 req/min per IP)
- **Security headers** (HSTS, CSP, X-Frame-Options)

# Roadmap

TeslaSync is already a broad platform. This roadmap avoids stale promised dates and focuses on active product directions.

## Stable foundation

- Go 1.25 API with Chi router, pgx, zerolog, Prometheus, and optional OpenTelemetry
- React 18 SPA with lazy-loaded feature pages, shared components, themes, PWA install, and command palette
- Docker Compose and Helm deployment paths
- Fleet Telemetry + MQTT ingestion with polling fallback
- TimescaleDB/PostgreSQL storage with pgvector support
- Alerting, notifications, automations, exports, backups, and diagnostics surfaces

## Current focus areas

| Area | Direction |
|---|---|
| Documentation | Keep docs aligned with code and deployment reality. |
| Telemetry reliability | Better stale-stream detection, signal coverage audits, and live-state recovery. |
| Frontend consistency | Shared components, theme readability, mobile navigation, and PWA polish. |
| Analytics | More verified chart data, better empty states, and clearer unit handling. |
| Operations | Safer Helm defaults, clearer ingress/auth patterns, and backup/restore validation. |
| Automation | Stronger rule testing, scheduling, and notification observability. |

## Backlog candidates

- More guided setup checks for Tesla OAuth and Fleet Telemetry
- Stronger API hook/backend route verification tooling
- Expanded test coverage for critical pages and worker flows
- More Grafana dashboards backed by continuous aggregates
- Better diagnostics for Authentik/ForwardAuth and SSE behavior
- More offline-friendly PWA affordances without caching live API responses

## How to contribute

See [Adding Features](/contributing/adding-features) and [Code Structure](/contributing/code-structure). Keep docs updates in the same change when behavior, configuration, or routes change.
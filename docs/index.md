---
layout: home

hero:
  name: TeslaSync
  text: Tesla fleet intelligence — with Helix AI built in
  tagline: Self-hosted telemetry, analytics, automation, remote control, and an opt-in AI assistant for one car or a fleet. Runs entirely on your own infrastructure.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Helix AI
      link: /guide/helix-ai
    - theme: alt
      text: Remote commands
      link: /guide/remote-commands

features:
  - icon: 🧠
    title: Helix AI
    details: 54 opt-in user features — chatbot with tool-use, NL builders for alerts and dashboards, narratives, predictions, ML clustering, voice mode, and more. Off by default, audited per call, with PII redaction at the network edge.
  - icon: 🎮
    title: 65 remote commands
    details: Every Tesla Fleet API command — wake, lock, climate, sentry, charging, schedules, valet, sunroof, sound system, navigation, software updates — routed through the Vehicle Command Proxy when signing is required.
  - icon: 📡
    title: Real-time telemetry
    details: Tesla Fleet Telemetry gRPC streaming, MQTT publish/subscribe, SSE to browsers, two-layer signal store (in-process L1 + Redis L2), TimescaleDB hypertable for durable history.
  - icon: 🚗
    title: Fleet command center
    details: Dashboard, live map with 6 tile layers, vehicle detail, command history, state-machine timeline, trip replay, 21 frontend feature areas across 69 pages.
  - icon: 🔋
    title: Battery & charging intelligence
    details: Battery health with degradation projection, cell voltage spread, pack voltage / current, BMS, charging curve, cost analysis, 7×24 charging heatmap, Tesla billing history.
  - icon: 📊
    title: Analytics & diagnostics
    details: True cost of ownership, sleep efficiency, temperature impact, weekly digest, year-in-review, projected range, fleet comparison. Plus a full diagnostics suite — live signal monitor, signal explorer, MQTT inspector, DB health.
  - icon: 🔔
    title: Alerts & automation
    details: Alert Studio with visual rule builder, CEP rule engine with recursive condition trees and temporal sustain, 50+ templates, quiet hours, per-rule cooldown, multi-channel dispatch, automation builder.
  - icon: 🛠️
    title: Operations built in
    details: Admin pages, API logs, API playground, Redis signal viewer, DB health dashboard, scheduled backups (Local / S3 / Azure / GCS), data repair, 25+ Tesla developer tools.
  - icon: 🎨
    title: Modern responsive UI
    details: Glass panels, 5 dynamic themes × 4 display modes, command palette, PWA installable, mobile bottom tabs, SI canonical with units converted only at the render boundary.
---

## What TeslaSync is

A self-hosted **Tesla Fleet Intelligence Platform**. A Go 1.25 backend, a
React 18 SPA, TimescaleDB / PostgreSQL 17 storage, Redis, MQTT, Grafana,
Prometheus, optional Tesla Fleet Telemetry streaming, and an optional AI
layer called **Helix** — all bundled into a Docker Compose stack or a
production-ready Helm chart.

The platform is designed for owners and small fleets that want to keep
Tesla data under their own control while still getting a polished dashboard,
live state, long-term analytics, notifications, automation, deployment-friendly
operations, and an AI assistant they can audit and turn off feature by feature.

## Current architecture at a glance

| Layer | Implementation |
|---|---|
| Backend | Go 1.25 · Chi v5 · pgx v5 · zerolog · Prometheus · OpenTelemetry · circuit breakers |
| Frontend | React 18 · TypeScript · Vite 5 · TanStack Query 5 · Tailwind · Framer Motion · i18next |
| Data | TimescaleDB / PostgreSQL 17 · pgvector · Redis 7 |
| Streaming | Tesla Fleet Telemetry (gRPC) · MQTT · SSE · polling fallback |
| Vehicle control | 65 command endpoints · optional Vehicle Command Proxy |
| AI | **Helix** — 54 opt-in user features · pluggable provider chain (OpenAI · Azure OpenAI · Anthropic · Ollama) |
| Deployment | Docker Compose (13 services) · Helm chart · Traefik IngressRoute · Authentik / ForwardAuth · PWA web container |
| Observability | Prometheus `/metrics` · 28 Grafana dashboards · OpenTelemetry traces (Jaeger profile) |

## Quick start

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env
# Edit .env with Tesla Developer credentials and deployment URLs
docker compose up -d --build
```

Open the web UI at `http://localhost:3000`. The API listens on
`http://localhost:8080`, Grafana on `http://localhost:3001`, Prometheus on
`http://localhost:9099`. With the `tracing` profile, Jaeger is at
`http://localhost:16686`.

Continue to [Getting Started](/guide/getting-started) for Tesla Developer
registration and partner-key flow.

## Where to next

- 🧠 **[Helix AI](/guide/helix-ai)** — features, providers, safety model
- 🎮 **[Remote commands](/guide/remote-commands)** — the full 65-endpoint reference
- 🏛 **[Architecture](/guide/architecture)** — services, data flow, schema
- ⚙ **[Configuration](/guide/configuration)** — every environment variable
- 📡 **[Fleet Telemetry](/guide/fleet-telemetry)** — gRPC streaming setup
- 🐳 **[Docker deployment](/deployment/docker)** · ☸ **[Kubernetes](/deployment/kubernetes)**

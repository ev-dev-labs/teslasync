---
layout: home

hero:
  name: TeslaSync
  text: Tesla Fleet Intelligence Platform
  tagline: Self-hosted Tesla telemetry, analytics, automation, and operations in one Go + React platform.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Deployment
      link: /deployment/docker

features:
  - icon: 🚗
    title: Fleet command center
    details: Dashboard, vehicle detail, live map, digital twin, trip replay, and command history for one car or a fleet.
  - icon: 📡
    title: Real-time telemetry
    details: Tesla Fleet Telemetry, MQTT ingestion, SSE streaming, Redis live state, and polling fallback when streaming is unavailable.
  - icon: 🔋
    title: Battery and charging intelligence
    details: Battery health, cell voltage, projected range, charging sessions, charging curve, heatmaps, and Tesla billing history.
  - icon: 📊
    title: Analytics and diagnostics
    details: Cost of ownership, efficiency, speed profile, route efficiency, sleep/vampire drain, signal explorer, anomaly views, and Grafana.
  - icon: 🔔
    title: Alerts and automation
    details: Typed Alert Studio rules, notification channels, automation builder, webhooks, scheduled checks, guard mode, and command workflows.
  - icon: 🧭
    title: Location and trips
    details: Live map, geofences, navigation routes, locations, trips, route replay, and map-tile caching for PWA installs.
  - icon: 🛠️
    title: Operations built in
    details: Admin pages, API logs, API playground, Redis signal viewer, database health, data repair, backups, exports, and system status.
  - icon: 🎨
    title: Modern responsive UI
    details: Vite-powered React SPA with glass panels, dynamic themes, command palette, mobile bottom tabs, PWA install, and offline shell caching.
---

## What TeslaSync is

TeslaSync is a self-hosted Tesla Fleet Intelligence Platform. It combines a Go 1.25 backend, a React 18 SPA, TimescaleDB/PostgreSQL storage, Redis, MQTT, Grafana, Prometheus, and optional Tesla Fleet Telemetry streaming.

The app is designed for owners and small fleets that want to keep Tesla data under their own control while still getting a polished dashboard, live state, long-term analytics, notifications, automation, and deployment-friendly operations.

<div style="display: flex; justify-content: center; margin: 2rem 0;">
  <svg width="280" height="100" viewBox="0 0 280 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: 0.6;">
    <path d="M30 65 Q30 42 55 36 L90 28 Q115 18 145 18 Q175 18 200 28 L235 36 Q260 42 260 65 L260 70 Q260 75 254 75 L36 75 Q30 75 30 70 Z" fill="none" stroke="#00f0ff" stroke-width="1.5">
      <animate attributeName="stroke-dasharray" from="0 800" to="800 0" dur="2s" fill="freeze" />
    </path>
    <ellipse cx="80" cy="75" rx="16" ry="16" fill="none" stroke="#10b981" stroke-width="2">
      <animate attributeName="r" values="0;16" dur="0.5s" begin="0.5s" fill="freeze" />
    </ellipse>
    <ellipse cx="210" cy="75" rx="16" ry="16" fill="none" stroke="#10b981" stroke-width="2">
      <animate attributeName="r" values="0;16" dur="0.5s" begin="0.6s" fill="freeze" />
    </ellipse>
    <ellipse cx="258" cy="56" rx="4" ry="7" fill="#00f0ff" opacity="0.7">
      <animate attributeName="opacity" values="0;0.7;0.3;0.7" dur="2s" begin="1s" repeatCount="indefinite" />
    </ellipse>
    <rect x="28" y="52" width="4" height="14" rx="2" fill="#ef4444" opacity="0.6">
      <animate attributeName="opacity" values="0;0.6;0.2;0.6" dur="2s" begin="1.2s" repeatCount="indefinite" />
    </rect>
    <ellipse cx="145" cy="94" rx="100" ry="4" fill="#6b7280" opacity="0.1">
      <animate attributeName="rx" values="0;100" dur="0.8s" begin="0.3s" fill="freeze" />
    </ellipse>
  </svg>
</div>

## Current architecture at a glance

| Layer | Current implementation |
|---|---|
| Backend | Go 1.25, Chi v5, pgx v5, zerolog, Prometheus, OpenTelemetry, circuit breakers |
| Frontend | React 18, TypeScript, Vite 5, TanStack Query 5, Tailwind, Framer Motion, i18next |
| Data | TimescaleDB/PostgreSQL 17, pgvector, Redis 7, optional MongoDB raw signal capture |
| Streaming | Tesla Fleet Telemetry, MQTT, Redis live state, SSE to browser, polling fallback |
| Deployment | Docker Compose, Helm, Traefik IngressRoute, Authentik/ForwardAuth, PWA web container |

## Quick start

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env
# Edit .env with Tesla Developer credentials and deployment URLs
docker compose up -d --build
```

Open the web UI at `http://localhost:3000`. The API listens on `http://localhost:8080`, Grafana on `http://localhost:3001`, and Prometheus on `http://localhost:9099` unless you override ports.

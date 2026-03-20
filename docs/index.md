---
layout: home

hero:
  name: TeslaSync
  text: Tesla Fleet Intelligence Platform
  tagline: Real-time monitoring, advanced analytics, and remote control for your Tesla fleet — built with Go & React.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/teslasync-labs/TeslaSync

features:
  - icon: 🚗
    title: Real-Time Vehicle Tracking
    details: Live GPS tracking on an interactive Leaflet map with SSE streaming, heatmaps, and drive route replay.
  - icon: ⚡
    title: Charging & Energy Analytics
    details: Detailed charging session history, cost tracking per kWh, energy consumption patterns, and efficiency metrics.
  - icon: 🔋
    title: Battery Health Monitoring
    details: Track battery degradation over time, charge cycles, projected range, and vampire drain analysis.
  - icon: 📊
    title: Fleet-Wide Analytics
    details: Cross-vehicle comparisons, daily/monthly mileage reports, cost breakdowns, and Grafana dashboards.
  - icon: 🔔
    title: Smart Alerts & Notifications
    details: Configurable alert rules with multi-channel delivery — Discord, Slack, Telegram, Email, Webhooks, and more.
  - icon: 🎮
    title: Remote Vehicle Commands
    details: Lock/unlock, climate control, charge management, sentry mode, frunk/trunk, horn, and flash — all from the web UI.
---

## Why TeslaSync?

TeslaSync is a next-generation Tesla fleet intelligence platform built from the ground up with a modern, lightweight architecture:

- **10x lower memory footprint** — Go backend with efficient connection pooling
- **Modern glassmorphism UI** — React 18 with 5 dynamic themes and a command palette
- **Real-time streaming** — Server-Sent Events for instant vehicle updates
- **Enterprise observability** — Prometheus metrics, Grafana dashboards, structured logging
- **One-command deploy** — Docker Compose with 6 pre-configured services

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Go 1.22 · Chi router · pgx · zerolog |
| **Frontend** | React 18 · TypeScript · Vite · Tailwind CSS |
| **Database** | PostgreSQL 16 + TimescaleDB |
| **Messaging** | MQTT (Mosquitto) |
| **Cache** | Redis 7 |
| **Monitoring** | Grafana 10.4 · Prometheus |
| **Deployment** | Docker Compose · Kubernetes (Helm) |

## Quick Start

```bash
git clone https://github.com/teslasync-labs/TeslaSync.git
cd TeslaSync
cp .env.example .env
# Edit .env with your Tesla API credentials
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) for the web UI, or [http://localhost:3001](http://localhost:3001) for Grafana dashboards.

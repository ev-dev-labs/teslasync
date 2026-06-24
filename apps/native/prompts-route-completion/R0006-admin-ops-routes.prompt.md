---
description: "Route completion R0006 — admin and ops routes"
---

# R0006 — Admin, power user, telemetry, diagnostics, and system ops route parity

Goal: Complete deletion-ready parity for admin/ops/power-user native-summary routes.

Target route ids include: `admin`, `admin-dlq`, `api-logs`, `dev-tools`, `power-sql`, `power-grafana`, `power-dashboards`, `signal-log`, `data-repair`, `backup`, `exports`, `chatbot`, `system-status-incidents-id`, `docs-status-api`, `roadmap`, `api-keys`, `admin-feedback`, `admin-flags`, `admin-ingest-xray`, `admin-schema-drift`, `admin-slow-queries`, `admin-vehicle-cost`, `admin-disk-forecast`, `admin-secret-rotation`, `admin-gdpr-exports`, `fleet-api`, `tesla-features`, `tesla-region`, `tesla-orders`, `gas-price`, `api-playground`, `redis-signals`, `state-debugger`, `signal-diff`, `signal-gaps`, `db-health`, `mqtt-inspector`, `anomaly-detection`, `analytics-anomalies`.

Rules: dangerous/admin actions must be visible but disabled or guarded unless fully implemented; no fake success; no WebView.

Gate: typecheck, lint, Jest, Windows Jest, Android/Windows bundles, web build.

Commit: `feat(apps): complete universal admin ops parity`



STATUS=DONE

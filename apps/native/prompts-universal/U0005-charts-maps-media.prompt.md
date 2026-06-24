---
description: "Universal RN U0005 — charts maps media parity"
---

# U0005 — Charts, maps, and media parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Build cross-platform React Native chart/map/media primitives that work on RN web and native. Use native/cross-platform libraries or accessible summaries; do not use web-only Recharts/Leaflet in RN surfaces.

## Rules

- No WebView.
- No direct Recharts/Leaflet.
- No chart with no accessible data alternative.
- No map claimed as final if only a placeholder exists.

## Required work

1. Add chart primitives and data-table alternatives.
2. Add map/route summary primitives with visible native parity status.
3. Port first dashboard/driving/energy chart usages to those primitives.
4. Add tests and web build validation.

## Gate

Run typecheck, lint, Jest, Windows Jest, Android/Windows bundles, and web build.

## Commit

Commit message: `feat(apps): add universal chart map primitives`


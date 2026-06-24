---
description: "Route completion R0003 — charging and energy routes"
---

# R0003 — Charging, energy, battery, and power route parity

Goal: Complete deletion-ready React Native parity for charging and energy native-summary routes.

Target route ids include: `charging-curve`, `charging-curves`, `charging-vampire-drain`, `cost-analysis`, `charging-costs`, `tesla-charging-history`, `tesla-charging-sessions`, `smart-charge`, `charging-schedule`, `powershare`, `charging-heatmap`, `energy-flow`, `power-flow`, `energy-products`, `battery-cells`, `vampire-drain`, `projected-range`, `analytics-range`.

Rules: SI display conversion at render boundary, no fake analytics, charts must have accessible data alternatives, no WebView.

Gate: typecheck, lint, Jest, Windows Jest, Android/Windows bundles, web build.

Commit: `feat(apps): complete universal charging energy parity`


---
description: "Route completion R0004 — driving and analytics routes"
---

# R0004 — Driving, trips, maps, and analytics route parity

Goal: Complete deletion-ready React Native parity for driving/analytics native-summary routes.

Target route ids include: `sharing-trips`, `analytics-lifetime`, `compare`, `analytics-compare`, `timeline`, `mileage`, `trip-planner`, `statistics`, `lifetime-stats`, `period-compare`, `driving-dynamics`, `drive-score`, `weekly-digest`, `drivetrain-health`, `navigation`, `vehicle-comparison`, `geofences`, `locations`.

Rules: no map WebView, route/map screens must render native summaries and accessible data, no fake trip data.

Gate: typecheck, lint, Jest, Windows Jest, Android/Windows bundles, web build.

Commit: `feat(apps): complete universal driving analytics parity`


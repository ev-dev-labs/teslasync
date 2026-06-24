---
description: "Route completion R0002 — vehicles and vehicle systems"
---

# R0002 — Vehicles and vehicle systems route parity

Goal: Complete deletion-ready React Native parity for vehicle/system native-summary routes.

Target route ids include: `vehicles-id-access`, `digital-twin`, `safety-settings`, `tire-pressure`, `software-updates`, `vehicle-systems-software`, `climate-control`, `climate`, `media-player`, `guard-mode`, `security-access`, `maintenance`.

Rules: use typed API hooks where available, render unavailable action states honestly, no hidden sections on null data, no WebView.

Gate: typecheck, lint, Jest, Windows Jest, Android/Windows bundles, web build.

Commit: `feat(apps): complete universal vehicle systems parity`


---
description: "Visual parity V0003 — dashboard and fleet visuals"
---

# V0003 — Dashboard, vehicles, charging, and driving visual parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Make RN Web visually match old web for dashboard widgets, vehicles, charging, and driving route families.

## Required work

1. Compare old web vs RN Web screenshots for dashboard, vehicles, charging, drives, trip/detail summaries.
2. Rebuild RN cards, widget grid, list rows, metric cards, charging panels, and drive/trip summaries to match old web’s premium visual language.
3. Keep loading/error/empty states visible and visually consistent.
4. Add/extend visual evidence JSON.

## Gate

Run typecheck, lint, Jest, RN web build, Android/Windows bundles, and visual comparison for these route families.

## Commit

Commit message: `feat(apps): align fleet visual parity`


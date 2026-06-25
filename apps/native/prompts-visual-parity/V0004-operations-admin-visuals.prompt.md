---
description: "Visual parity V0004 — operations admin visuals"
---

# V0004 — Energy, alerts, system, auth, settings, and admin visual parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Make RN Web visually match old web for operations and platform/admin route families: energy, alerts, system, auth/account/settings, notifications, admin, telemetry, diagnostics, and power-user surfaces.

## Required work

1. Compare representative screenshots for every operations/platform group.
2. Rebuild RN sections/cards/tables/forms/unavailable states to match old web.
3. Preserve honest disabled/unavailable states for dangerous admin actions.
4. Add visual evidence JSON with route-level status.

## Gate

Run typecheck, lint, Jest, RN web build, Android/Windows bundles, and visual comparison for these route families.

## Commit

Commit message: `feat(apps): align operations visual parity`


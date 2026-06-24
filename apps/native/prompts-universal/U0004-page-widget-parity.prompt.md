---
description: "Universal RN U0004 — pages/widgets parity"
---

# U0004 — Pages and dashboard widgets parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Move all current native route/page/widget work toward a single React Native implementation that renders on web and native. Cover dashboard widgets, vehicles, charging, driving, energy, alerts, system, auth, settings, maps, analytics, and admin/system placeholders with visible parity status.

## Rules

- No fake data.
- No hiding panels when data is null.
- No deleting `web/`.
- No claiming final parity if route/widget status is pending.

## Required work

1. Expand implemented route screens and widget registry.
2. Add native components for repeated sections.
3. Add tests for representative pages and widgets.
4. Ensure RN web build renders the same screens.

## Gate

Run typecheck, lint, Jest, Windows Jest, Android/Windows bundles, and web build.

## Commit

Commit message: `feat(apps): expand universal page widget parity`


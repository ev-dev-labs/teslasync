---
description: "Universal RN U0006 — auth notifications platform"
---

# U0006 — Auth, notifications, and platform parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Implement cross-platform auth/session flows, notifications, deep links, and platform lifecycle status for RN web and native targets.

## Rules

- No token localStorage in native.
- No fake notification success.
- No committed signing secrets.
- No deleting `web/`.

## Required work

1. Add auth/session screens and secure/unavailable states.
2. Add notification inbox/rules/channel parity.
3. Add deep link parsing for web and native.
4. Add platform lifecycle/status tests.

## Gate

Run typecheck, lint, Jest, Windows Jest, Android/Windows bundles, and web build.

## Commit

Commit message: `feat(apps): add universal auth notification parity`


---
description: "Native parity N0007 — notifications and platform integrations"
---

# N0007 — Notifications and platform integrations

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/src/**`, `apps/native/android/**`, `apps/native/ios/**`, `apps/native/windows/**`, `apps/native/__tests__/**` |
| Goal | Add native notification surfaces plus platform hooks for push, deep links, taskbar/jump-list equivalents, and lifecycle. |

## Honesty Covenant

1. No red-as-green.
2. No fake notification success.
3. No committed secrets/certs.
4. No WebView.
5. No platform feature claimed done without gate evidence.
6. No deleting manifest routes.
7. No missing unavailable states.
8. No unsafe token persistence.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Implement native notification inbox/rules/channel surfaces.
2. Add deep-link route parsing and platform lifecycle status.
3. Add platform-specific placeholders only when honest, typed, and visible in parity status.
4. Add tests and gate.

## Gate

From `apps/native`, run typecheck, lint, Jest, Android/Windows bundle validation, and available platform config checks.

## Commit

Commit message: `feat(apps): add native notification platform parity`


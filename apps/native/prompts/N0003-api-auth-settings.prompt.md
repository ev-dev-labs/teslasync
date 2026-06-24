---
description: "Native parity N0003 — API, auth, settings"
---

# N0003 — API hooks, production auth flows, and settings

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/src/api/**`, `apps/native/src/screens/AuthScreen.tsx`, `apps/native/src/screens/SettingsScreen.tsx`, `apps/native/src/lib/**`, `apps/native/__tests__/**` |
| Goal | Expand typed native API hooks and implement production auth/settings surfaces without insecure token storage. |

## Honesty Covenant

1. No red-as-green.
2. No `/api/v1` prefix in hook calls; client adds it.
3. Query params are snake_case.
4. No token persistence in insecure storage.
5. No fake success-shaped auth.
6. No broad catch that hides auth failures.
7. No WebView login shortcuts claimed as native auth.
8. No untyped `any`.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Port typed hooks for settings, auth mode, sessions, TOTP, notifications, vehicles, charging, drives, energy, and system.
2. Implement native auth/settings screens with open-mode/forward-auth states and explicit unavailable states.
3. Add tests for URL construction and auth mode rendering.
4. Gate and commit.

## Gate

From `apps/native`, run typecheck, lint, Jest, and Android/Windows bundle validation.

## Commit

Commit message: `feat(apps): add native auth and settings parity`


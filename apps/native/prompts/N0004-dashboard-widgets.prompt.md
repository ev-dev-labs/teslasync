---
description: "Native parity N0004 — dashboard widgets"
---

# N0004 — Dashboard widgets parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/src/screens/DashboardScreen.tsx`, `apps/native/src/widgets/**`, `apps/native/src/components/**`, `apps/native/src/api/**`, `apps/native/__tests__/**` |
| Goal | Port dashboard widget concepts from `web/src/features/dashboard/**` into native cards and widget registry. |

## Honesty Covenant

1. No red-as-green.
2. No deleting/hiding dashboard regions.
3. No skeleton-only widgets.
4. No fake API data.
5. No WebView.
6. No direct web component copy that cannot run in React Native.
7. No untyped widget registry.
8. No missing empty/error/loading states.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Survey dashboard widgets in `web/src/features/dashboard/widgets`.
2. Add a native widget registry with implemented/pending status.
3. Implement native widgets for vehicle hero, battery/health, alerts, quick nav, recent drives, charging summary, and system status.
4. Add tests and gate.

## Gate

From `apps/native`, run typecheck, lint, Jest, and Android/Windows bundle validation.

## Commit

Commit message: `feat(apps): add native dashboard widgets`


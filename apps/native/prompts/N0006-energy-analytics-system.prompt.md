---
description: "Native parity N0006 — energy, analytics, system"
---

# N0006 — Energy, analytics, and system parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/src/screens/**`, `apps/native/src/features/operations/**`, `apps/native/src/api/**`, `apps/native/src/components/**`, `apps/native/__tests__/**` |
| Goal | Port battery/energy, analytics, system/ops, telemetry, and diagnostics route groups into native parity surfaces. |

## Honesty Covenant

1. No red-as-green.
2. No fake analytics.
3. No deleted/hidden web route parity entries.
4. No direct chart/web map libraries.
5. No missing loading/error/empty states.
6. No SI unit mistakes.
7. No untyped dynamic data where a type can be declared.
8. No WebView.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Add energy/battery/analytics/system native sections and route manifest status.
2. Add typed hooks for the backend routes used.
3. Add native chart summaries and accessible table alternatives.
4. Add tests and gate.

## Gate

From `apps/native`, run typecheck, lint, Jest, and Android/Windows bundle validation.

## Commit

Commit message: `feat(apps): add native operations parity screens`


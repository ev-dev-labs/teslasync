---
description: "Native parity N0005 — vehicles, charging, driving"
---

# N0005 — Vehicles, charging, and driving parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/src/screens/**`, `apps/native/src/features/fleet/**`, `apps/native/src/api/**`, `apps/native/src/components/**`, `apps/native/__tests__/**` |
| Goal | Implement native parity for vehicle list/detail shells, charging sessions, drives, trips, and route/replay summaries. |

## Honesty Covenant

1. No red-as-green.
2. No fake vehicle/drive/charge data.
3. No SI unit mistakes; display conversion happens at render boundary.
4. No map WebView.
5. No hidden sections on null data.
6. No raw untyped API payload usage where types are known.
7. No deleting route manifest entries.
8. No missing loading/error/empty states.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Expand vehicles, charging, and driving screens into section components.
2. Add typed detail/readiness surfaces for represented routes.
3. Implement charts/maps as native summary/route components where full native map is not ready, marking parity status honestly.
4. Add tests and gate.

## Gate

From `apps/native`, run typecheck, lint, Jest, and Android/Windows bundle validation.

## Commit

Commit message: `feat(apps): add native fleet parity screens`


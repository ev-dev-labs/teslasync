---
description: "Native parity N0002 — design, icons, charts, maps"
---

# N0002 — Design system, icons, charts, and maps primitives

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Allowed files | `apps/native/src/components/**`, `apps/native/src/theme/**`, `apps/native/src/lib/**`, `apps/native/src/screens/**`, `apps/native/__tests__/**` |
| Goal | Build native premium primitives for glass UI, semantic icons, chart summaries, and map route summaries without WebView. |

## Honesty Covenant

1. No red-as-green.
2. No scope narrowing.
3. No direct web-only chart/map libraries.
4. No WebView/Electron/browser embedding.
5. No fake charts/maps claimed as final parity.
6. No inaccessible icon-only controls.
7. No platform-only styling that breaks Android/iOS/Windows.
8. No TODO placeholders.
9. No uncommitted product changes on DONE.
10. Final output must include EXIT and STATUS markers.

## Action Steps

1. Create typed semantic icon mapping matching web intent labels.
2. Add premium native components for section headers, cards, metric grids, list rows, chart summaries, and map route summaries.
3. Add tests for primitives and icon map coverage.
4. Gate and commit.

## Gate

From `apps/native`, run typecheck, lint, Jest, and Android/Windows bundle validation.

## Commit

Commit message: `feat(apps): add native design primitives`


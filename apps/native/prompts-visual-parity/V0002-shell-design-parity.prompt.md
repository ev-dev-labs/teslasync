---
description: "Visual parity V0002 — shell and design tokens"
---

# V0002 — Shell and design-token visual parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Make the RN Web shell visually match the existing premium `web/` shell: dark background, glass panels, spacing, side navigation, top/header regions, typography, neon accents, density, responsive behavior, and visual hierarchy.

## Rules

- Compare screenshots before and after.
- Do not claim parity from subjective eyeballing only.
- No WebView/Electron.
- Do not delete old `web/`.

## Required work

1. Capture old web shell/dashboard screenshots.
2. Capture RN Web shell/dashboard screenshots.
3. Update RN tokens/components/shell until visual score meets the loop threshold or the exact remaining delta is logged.
4. Add tests for shell visual status.
5. Commit only after gates pass.

## Gate

Run typecheck, lint, Jest, RN web build, Android/Windows bundles, and visual comparison for shell/dashboard.

## Commit

Commit message: `feat(apps): align universal shell visual parity`

STATUS=DONE

Shell/dashboard visual gate: `root-layout` score `0.986893` at threshold `0.985`.

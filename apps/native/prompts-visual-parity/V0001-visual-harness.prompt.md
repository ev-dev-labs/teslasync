---
description: "Visual parity V0001 — screenshot harness"
---

# V0001 — Screenshot harness for old web vs React Native Web

> **Severity:** Feature/Gate | **Delegation:** FORBIDDEN

## Goal

Create a repeatable visual parity harness that compares the existing `web/` app against `apps/native` React Native Web. This loop must not stop at route/API parity; visual parity is required.

## Non-negotiable rules

1. Do not delete old `web/`.
2. Do not claim parity without screenshots or machine-readable evidence.
3. Do not compare only the home page.
4. Do not use WebView/Electron.
5. Do not fake screenshots or visual scores.
6. Do not touch unrelated web EOL dirty files.
7. Keep artifacts out of Git unless they are small JSON/text evidence files intentionally committed.
8. If old web cannot run, fix/run it or produce a BLOCKED log and keep looping.
9. If RN Web cannot run, fix/run it or produce a BLOCKED log and keep looping.
10. Final response must include EXIT and STATUS markers.

## Required work

1. Add visual parity scripts under `apps/native/scripts/visual-parity/`.
2. Ensure scripts can start or validate:
   - old web app (`web/`) on a non-conflicting port
   - RN Web app (`apps/native`) on a non-conflicting port
3. Add Playwright or equivalent screenshot tooling to `apps/native` if needed.
4. Capture baseline screenshot metadata for representative route groups.
5. Emit JSON with route, old screenshot path, RN screenshot path, score/diff status, and blocker.
6. Add package scripts for visual parity: `visual:survey`, `visual:capture`, `visual:compare`.
7. Gate with typecheck, lint, Jest, web build, and the new visual script.

## Commit

Commit message: `test(apps): add universal visual parity harness`


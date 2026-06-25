---
description: "Visual parity V0006 — final old-web visual replacement gate"
---

# V0006 — Final old-web visual replacement gate

> **Severity:** Gate | **Delegation:** FORBIDDEN

## Goal

Prove React Native Web is visually ready to replace the old `web/` app. Do not delete old `web/`; only mark deletion-ready if visual parity evidence is complete.

## Required work

1. Run visual comparison across all representative route groups.
2. Verify route parity, widget parity, platform parity, and visual parity evidence.
3. Verify there are no pending/native-summary visual blockers.
4. Run typecheck, lint, Jest, RN web build, Android/Windows bundles, and host-available package/device gates.
5. If anything remains visually off, produce STATUS=BLOCKED with exact route/component deltas and keep the loop running.
6. If all pass, commit deletion-readiness evidence only. Do not delete old `web/` until the user explicitly approves.

## Commit

Commit message: `test(apps): pass universal visual parity gate`

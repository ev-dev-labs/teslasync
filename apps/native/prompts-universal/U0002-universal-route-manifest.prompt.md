---
description: "Universal RN U0002 — route manifest for web and native"
---

# U0002 — Universal route manifest for web and native

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Create a typed route manifest that maps every existing `web/src/App.tsx` route to a React Native route/screen and tracks web/native implementation status. This is the source of truth for eventual old-web deletion readiness.

## Rules

- Do not delete `web/`.
- Route coverage must include every `<Route path=...>` from `web/src/App.tsx`.
- Pending routes must be visible and honest.
- No WebView/Electron.

## Required work

1. Generate or maintain typed route records for all web paths.
2. Add route coverage tests.
3. Render route status in RN web/native shell.
4. Add deletion-readiness fields, but keep deletion blocked until final parity gate.

## Gate

Run typecheck, lint, Jest, Windows Jest, Android/Windows bundles, and web build.

## Commit

Commit message: `feat(apps): add universal route parity manifest`


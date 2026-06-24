---
description: "Universal RN U0001 — React Native Web target"
---

# U0001 — Add React Native Web target

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Make `apps/native` run as a browser app using React Native Web while preserving Android, iOS, Windows, and macOS native targets. Do not delete or modify the existing `web/` app; it remains the parity reference until the RN web target proves full parity.

## Honesty Covenant

1. No red-as-green.
2. No deleting old `web/`.
3. No Electron/WebView.
4. No browser-only code that breaks native.
5. No untyped app bootstrap.
6. No fake parity claims.
7. No production API calls in tests.
8. No committed secrets.
9. No unrelated web EOL edits.
10. Commit only after gates pass.

## Required work

1. Add React Native Web dependencies and web build tooling.
2. Add `apps/native/index.web.tsx`, `apps/native/index.html`, and web config that aliases `react-native` to `react-native-web`.
3. Add scripts: `web`, `web:dev`, `web:build`, and `web:preview` or equivalent.
4. Ensure the RN app shell renders in browser and native bundle paths still work.
5. Add tests or smoke checks for web bootstrap.

## Gate

Run from `apps/native`: typecheck, lint, Jest, Windows Jest, Android bundle, Windows bundle, and web build.

## Commit

Commit message: `feat(apps): add React Native Web target`


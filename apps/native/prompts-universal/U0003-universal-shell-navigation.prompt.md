---
description: "Universal RN U0003 — shell/navigation parity"
---

# U0003 — Universal shell/navigation parity

> **Severity:** Feature | **Delegation:** FORBIDDEN

## Goal

Build the React Native shell so it works as the new browser target and native app shell: navigation groups, search/command entry, route status, responsive layout, keyboard/focus behavior, and premium TeslaSync glass UI.

## Rules

- No DOM-only components unless isolated behind `.web.tsx` with native fallback.
- No WebView/Electron.
- Keep old `web/` untouched.
- Every shell section needs loading/empty/error/unavailable states where relevant.

## Required work

1. Add responsive shell behavior for browser width and native desktop/mobile.
2. Add route search or route index.
3. Add keyboard/focus-friendly navigation.
4. Add tests for shell, route switching, and web render.

## Gate

Run typecheck, lint, Jest, Windows Jest, Android/Windows bundles, and web build.

## Commit

Commit message: `feat(apps): add universal native shell navigation`


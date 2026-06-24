---
description: "Route completion R0005 — notification auth settings routes"
---

# R0005 — Notifications, auth, account, settings, and integrations route parity

Goal: Complete deletion-ready parity for notification/account/settings native-summary routes.

Target route ids include: `automations`, `automations-list`, `automations-new`, `automations-id-edit`, `alert-studio`, `alert-rules`, `notifications-browser`, `notifications-rules`, `notifications-studio`, `settings`, `settings-safety`, `account-2fa`, `account-sessions`, `account-privacy`, `integrations-helix`.

Rules: no insecure token persistence, no fake notification success, no destructive action without disabled/unavailable state and confirmation contract.

Gate: typecheck, lint, Jest, Windows Jest, Android/Windows bundles, web build.

Commit: `feat(apps): complete universal notification auth parity`


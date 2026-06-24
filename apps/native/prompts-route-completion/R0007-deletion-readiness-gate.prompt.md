---
description: "Route completion R0007 — deletion readiness gate"
---

# R0007 — Old web deletion-readiness gate after route completion

Goal: Re-run the old-web deletion-readiness evidence after route-completion prompts. Do not delete `web/`; only mark readiness if every route/widget is implemented and gates pass.

Required checks:
1. `oldWebDeletionReadiness.canDeleteOldWeb` must be true only if 157/157 routes are implemented and there are zero `native-summary`/`pending` route statuses.
2. All widgets must be implemented or have exact blocker evidence.
3. Run typecheck, lint, Jest, Windows Jest, Android/Windows bundles, web build, and host-available package/device gates.

If blocked, commit evidence explaining remaining route ids. If done, commit readiness evidence only; do not delete old `web/` until explicit user approval.

Commit: `test(apps): pass universal route deletion readiness gate`

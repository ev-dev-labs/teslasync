---
description: "Route completion R0001 — command and dashboard routes"
---

# R0001 — Command, dashboard, search, onboarding, watch, and shared routes

Goal: Convert command/dashboard native-summary routes in `apps/native/src/navigation/routes.ts` into deletion-ready implemented routes by adding real RN Web/native surfaces under `apps/native/src/**`.

Target route ids include: `quick-stats`, `glance`, `year-review-year`, `shared-drive-token`, `watch`, `onboarding`, `root-layout`, `explore`, `live`, `search`, `not-found-layout`, `not-found-root`.

Rules: no WebView/Electron, no deleting `web/`, no fake data, no claiming implemented without visible route evidence and tests.

Gate: from `apps/native`, run typecheck, lint, Jest, Windows Jest, Android bundle, Windows bundle, and web build.

Commit: `feat(apps): complete universal command route parity`


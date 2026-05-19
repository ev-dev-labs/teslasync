# Playwright E2E suite

Phase: **P1 #9** — bootstrap end-to-end testing for the SPA.

## What's here

`smoke.spec.ts` runs a minimum-viable smoke suite against the running
dev server with the backend stubbed via Playwright `page.route()`
interception. Goal: catch regressions where the SPA fails to mount,
the title is wrong, or a route navigation throws.

Two seed tests:

1. `home route mounts without uncaught errors` — proves the React root
   renders, the title is set, and no `pageerror` / `console.error`
   fires during boot (filtering known SW-dev-mode noise).
2. `404 route renders without crash` — proves React Router handles
   unknown routes without crashing.

The shared `stubBackend(page)` helper returns deterministic payloads
for `/api/v1/vehicles`, `/api/v1/system/health`, `/api/v1/system/status`
and a generic empty-success fallback for any other `/api/*` call.
Extend this helper as more page-level tests get added.

## Running locally

```bash
cd web
npm ci --legacy-peer-deps
npx playwright install --with-deps chromium
npm run test:e2e          # headless, in-process
npm run test:e2e:headed   # visible browser, for debugging
npm run test:e2e:ui       # Playwright's UI mode
```

The config (`playwright.config.ts`) auto-starts `vite` on port 5173
via the `webServer` block, so you don't need a separate `npm run dev`
shell open.

## Adding new tests

Per-page smoke tests should live alongside `smoke.spec.ts` (e.g.
`vehicles.spec.ts`, `drives.spec.ts`). Keep the network-stubbed
pattern — full-stack E2E (against a real backend + TimescaleDB +
Redis) belongs in a separate CI job with testcontainers wiring.

When you add a new test, also expand `stubBackend()` to cover any
new API hook the page calls. Returning `{}` for unknown routes
prevents tests from breaking on accidental hook additions, but
shape-specific stubs catch more regressions.

## Why network-stubbed (not full-stack)?

The existing `ci.yml` `frontend` job runs in ~1m. Adding Playwright
on top of vitest with a stubbed backend adds ~30s. A full-stack E2E
suite would need:

- TimescaleDB + Redis + MQTT spun up as services
- the Go API server built + started
- migrations applied
- seed data loaded

That's a 4–5min job by itself, and it's worth doing — but it's a
follow-up because it's structurally different from "boot the SPA
and click around". The stubbed suite catches the highest-frequency
regressions at near zero cost.

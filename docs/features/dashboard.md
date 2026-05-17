# Dashboard

The TeslaSync dashboard is the screen you'll spend the most time on. It's a single, scrollable canvas that answers the four questions you probably opened the app to ask:

1. Where are my vehicles right now?
2. What changed since I last looked?
3. Is anything wrong?
4. What should I do next?

Every other page in the product is a deeper dive into one of those questions.

## Anatomy of the page

The dashboard is composed from a fixed set of widgets. The widgets are not pluggable — they are the curated set we believe answers the four questions above without overwhelming a phone screen.

| Widget                    | Pulls from                                          | Updates via               |
| ------------------------- | --------------------------------------------------- | ------------------------- |
| Fleet header              | `GET /api/v1/vehicles`                              | TanStack Query + SSE invalidation |
| Per-vehicle live card     | `GET /api/v1/vehicles/{id}/state` + live signals    | SSE deltas, polling fallback |
| Recent activity rail      | `GET /api/v1/drives`, `/charging`, `/alerts`, `/api-logs` (latest 5 each) | Hook revalidation on SSE event |
| Today at a glance         | `GET /api/v1/analytics/daily?date=today`            | Refetch on focus          |
| System health strip       | `GET /healthz`, `/readyz`, `/api/v1/system/status`  | 30s interval              |
| Quick actions             | client-only (deep links into Commands, Alert Studio, etc.) | n/a                |
| Helix "Daily brief"       | `POST /api/v1/ai/daily-brief/run` (off by default)  | Manual or auto on first load |

If a widget has no data — a brand-new install with zero drives, for example — it renders an empty state with a one-click path to the first thing you can do. We never collapse the widget away. Hiding empty widgets makes the product feel "broken on day one", which is the worst onboarding experience we can ship.

## How real-time works in practice

The dashboard does **not** open a fresh `EventSource` per widget. There is a single shared `sseManager` singleton (`web/src/lib/sseManager.ts`) that maintains one connection to `/api/v1/events`. Hooks subscribe to event topics and the manager fans them out.

When a `vehicle.state.changed` event arrives, the relevant TanStack Query keys are invalidated and the per-vehicle card re-renders from the local cache. There is no full page reload, no flicker, no spinner — the value just changes.

If the SSE connection drops (network blip, proxy timeout, server restart), every subscriber transparently flips to adaptive polling. The widgets don't know the difference. You'll see a small connection indicator in the system-health strip turn yellow ("Polling"), then back to green when the stream recovers.

## How layout adapts

| Viewport          | Behaviour                                                          |
| ----------------- | ------------------------------------------------------------------ |
| Phone (≤640 px)   | Single column, bottom tab bar, condensed live card                 |
| Tablet (641–1023) | Two columns, sidebar collapses to icon rail                        |
| Desktop (≥1024)   | Three columns, sidebar expanded with section grouping              |
| Print             | Single column, all panels open, sidebar + chrome stripped (see [Printing](/guide/printing)) |

The breakpoints are Tailwind defaults. The layout doesn't use a grid library; it's composed from semantic `<section>` elements with utility classes and CSS variables for theme tokens.

## Units, dates, currency

Nothing on the dashboard is hardcoded with a unit. Every value is stored in SI inside the API and converted at the React render boundary via `useUnits()`, `useFormatting()`, and `useDateFormat()`. The user's preferences (km vs mi, °C vs °F, ISO vs locale dates, currency symbol, decimal precision, timezone, locale) are honoured everywhere — including inside chart tick formatters, tooltip callbacks, and CSV exports launched from the dashboard's quick-action menu.

If you ever see "km" on a UI that's set to imperial, that's a bug — file it. The contract is enforced by lint and by the Phase-42 final-gate test suite.

## Where Helix fits

Helix AI is opt-in. Until you enable a Helix feature in **Settings → Helix**, the dashboard renders without any AI affordance — the widget simply does not exist in the layout. This is enforced at two layers:

- **Backend**: `g.Wrap("daily-brief", handler)` in `internal/api/ai_routes.go` returns `404` when the feature is off
- **Frontend**: `withAiFeature('daily-brief')` HOC renders `null` when the feature is off

Once enabled, the **Daily brief** widget joins the dashboard. It writes a short narrative paragraph using the prior 24 hours of drives, charging sessions, alerts, and Tesla notifications, then proposes a "next thing" — usually a recommended automation, a charge-limit tweak, or an alert that's firing too often.

Other dashboard-adjacent Helix features (off by default, each independently toggled):

- **`anomaly-spotlight`** — surfaces the single most interesting anomaly from the past day with an explanation
- **`charging-cost-trend`** — narration on the cost trend you see in the Today panel
- **`fleet-readiness`** — predicts which vehicles will need attention in the next week

## Performance budget

- First Contentful Paint < 1.0 s on a cached visit (typical fibre + desktop Chrome)
- Largest Contentful Paint < 2.5 s on cold cache
- The dashboard JS bundle is code-split: the page route, each widget, and the optional Helix surfaces are separate chunks
- SSE reconnect with exponential backoff capped at 30 s; manual refresh always wins

## When to use other pages instead

| If you want…                                  | Open…                                  |
| --------------------------------------------- | -------------------------------------- |
| To see one vehicle in depth                   | **Fleet → vehicle detail**             |
| To replay a specific drive                    | **Drives → trip replay**               |
| To investigate a noisy alert                  | **Alerts → alert detail / Alert Studio** |
| To ask Helix a free-form question             | **Helix** sidebar entry (chatbot)      |
| To export anything for a spreadsheet          | **Settings → Data export**             |
| To check why telemetry is stale               | **System → Telemetry pipeline**        |

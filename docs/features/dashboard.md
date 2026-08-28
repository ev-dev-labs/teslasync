# Dashboard

The TeslaSync dashboard is the screen you'll spend the most time on. It's a single, scrollable canvas that answers the four questions you probably opened the app to ask:

1. Where are my vehicles right now?
2. What changed since I last looked?
3. Is anything wrong?
4. What should I do next?

Every other page in the product is a deeper dive into one of those questions.

## Anatomy of the page

The dashboard is a customizable canvas built from a catalogue of 118 widgets organised into 16 categories. Drag widgets to arrange them, or use each widget's **Arrange** menu for one-click and keyboard move/resize controls. Dashboard tabs likewise provide **Move earlier** and **Move later** actions, so layout editing never requires dragging.

Open the widget catalogue from the floating **+** button (the dashboard's "Add widget" affordance). The dialog lists every widget grouped by category, with a search box that matches against name, description, or category — so typing `battery` jumps you to the 10-widget Battery & Range bucket, and typing `range estimate` jumps you straight to that single widget.

| Category        | Widgets | Examples                                                                  |
| --------------- | -------:| ------------------------------------------------------------------------- |
| Vehicle         | 16      | Vehicle Hero Card, Digital Twin, Software Update, Drivetrain Health       |
| Analytics       | 14      | Daily Summary, Year in Review, Cost Trend, Efficiency Index               |
| Charging        | 13      | Charge Status, Charging Curve, Cost Analysis, 7×24 heatmap                |
| Driving         | 13      | Recent Drives, Live Drive, Efficiency, Sleep Efficiency                   |
| System          | 12      | Health Strip, SSE Status, Cache Stats, Background Job Queue               |
| Battery & range | 10      | Battery Level, Battery Radial Gauge, Range Bar, Degradation Trend         |
| Energy          | 9       | Energy Flow, Wall Charger, Solar Production, Powerwall                    |
| Security        | 7       | Sentry Status, Door & Lock State, Cabin Camera, Recent Sentry Events      |
| Maps            | 5       | Live Location, Recent Routes, Charger Map, Geofence Map                   |
| Telemetry       | 5       | Live Signal Monitor, Anomaly Spotlight, Signal Catalog, Stream Health     |
| Climate         | 4       | Climate Status, HVAC History, Seat Heaters, Cabin Comfort                 |
| Alerts          | 2       | Recent Alerts, Alert Heatmap                                              |
| Automations     | 2       | Active Automations, Run History                                           |
| Commands        | 2       | Quick Actions, Recently Sent Commands                                     |
| Media           | 2       | Now Playing, Volume History                                               |
| Tires           | 2       | Tire Pressure, Tire Temperature                                           |

Every widget that's already on the active dashboard is badged **Added** in the catalogue, and the picker disables it — so you can't accidentally add the same widget twice. Removing a widget from the dashboard re-enables it in the catalogue.

Widgets are self-rendering: each one declares which signals it depends on, and if the underlying signal isn't reporting (for example, a fleet without solar will never publish a Powerwall reading), the widget renders an empty state with a one-click path to the first thing you can do. We never collapse the widget away — hiding empty widgets makes the product feel "broken on day one", which is the worst onboarding experience we can ship.

## Multiple dashboards

The dashboard switcher in the page header lets you create, rename, duplicate, and switch between an unlimited number of dashboards. Each one has its own widget layout and its own grid arrangement. Common patterns we've seen:

- **Daily** — Vehicle Hero, Battery Level, Quick Actions, Recent Alerts
- **Long trip** — Live Drive, Charger Map, Range Bar, Tire Pressure, Energy Flow
- **Garage / diagnostics** — Drivetrain Health, Cell Voltage Spread, SSE Status, Cache Stats
- **Family** — Vehicle Hero (per car) × N, Quick Actions

There is no per-account limit. Layouts are stored locally and synced to the API so they roam across devices.

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

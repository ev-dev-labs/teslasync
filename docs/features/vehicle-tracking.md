# Vehicle Tracking

Vehicle tracking is the part of TeslaSync that answers "where is my car, what is it doing right now, and where has it been?". It spans the live map, the Fleet list, vehicle detail, the Digital Twin visualisation, drives, trips, trip replay, geofences, locations, and navigation routes.

This page explains how those pieces fit together. For setup, see [Getting Started](/guide/getting-started). For the underlying data contract, see [Fleet Telemetry](/guide/fleet-telemetry).

## The three layers of "where"

TeslaSync tracks position at three time scales, each backed by a different data path:

| Layer    | Time horizon      | Source                                                      | Use case                                  |
| -------- | ----------------- | ----------------------------------------------------------- | ----------------------------------------- |
| **Now**  | Last few seconds  | L1 `signal.Store` + L2 Redis (`/api/v1/signals/{id}/live`)  | Live map dot, Digital Twin, sentry status |
| **Recent** | Last 24–72 hours | `positions` hypertable (`/api/v1/vehicles/{id}/positions`) | Today's drive trails, last-known location |
| **Historical** | Forever      | `drives` + `drive_telemetry_readings` + `signal_log`       | Trip replay, route analytics, sharing     |

Pages that show "now" never read from the historical layer — that's the contract enforced in the live-state architecture (see [Architecture](/guide/architecture#telemetry-flow)). Pages that replay a finished drive never poll the live API. Crossing those wires is a source of confusion and stale data, so the codebase keeps them strictly separated.

## Live Map

The Live Map is a single Leaflet map with markers for every vehicle and an optional layer for geofences. It is the only page that aggregates live position across the fleet.

How it works:

- The page subscribes to the `vehicle.position` SSE topic via `sseManager` (one connection, fanned out to every marker subscriber).
- Each marker reads from the per-vehicle live cache so a marker can re-render without forcing the whole map to redraw.
- Map tiles are served by the configured tile provider (OSM by default, Google or Azure if you've set the matching API key) and may be cached by the PWA service worker for offline panning.
- Polylines for the active drive (if any) are drawn from the `drives.{id}/positions` endpoint and updated incrementally as new positions arrive.

The map never imports Leaflet directly. The shared `@/components/maps` barrel wraps Leaflet + React-Leaflet so we can swap providers (or add a static-image fallback for print mode) without touching every page.

## Fleet & Vehicle Detail

Fleet is the list view. It loads `GET /api/v1/vehicles` once, then receives SSE deltas as state changes. Each row is a clickable card with current battery, online state, location name (reverse-geocoded), and a per-vehicle quick-action menu.

Vehicle Detail is the most heavily-trafficked deep page. It's organised into stacked sections that lazy-load on scroll so the initial render stays fast:

1. **Hero state** — display name, model, VIN (redacted to last 4 by default), live battery, location, last-seen
2. **Digital Twin** — vector illustration of the car with door/window/light/lock/climate state
3. **Commands** — the 65-endpoint command surface scoped to this vehicle (see [Remote Commands](/guide/remote-commands))
4. **Battery & energy** — current SoC, projected range, charging session summary, per-cell health if available
5. **Location & navigation** — last-known address, current navigation route from Tesla, geofence membership
6. **Activity** — recent drives, charging sessions, commands, alerts (paginated)
7. **Diagnostics** — FSM state, signal coverage, last-error from the Tesla Fleet Telemetry error feed

Sub-resources include drivers, invitations, mobile access, options, specs, subscription / upgrades, guard mode, and the weekly digest — each backed by its own endpoint under `/api/v1/vehicles/{vehicle_id}/...`.

## Digital Twin

The Digital Twin is a stylised SVG of the car that animates as state changes. Every visible element (doors, windows, frunk, trunk, charge port, mirrors, sentry pulse, headlights) is wired to a live signal. The illustration is drawn from a set of body-style-aware vector parts in `web/src/components/vehicle-systems/digital-twin/` so a Model 3 doesn't render with a Cybertruck silhouette.

The twin is deliberately not photorealistic. We chose the stylised look because (a) it lets the same illustration represent every body style without per-model artwork, and (b) it makes state changes legible at a glance — an open door is unambiguous, not a subtle highlight on a photo.

## Drives, Trips, Trip Replay

A **drive** is a single Tesla driving session — start time, end time, route, telemetry. Drives are detected automatically from the `shift_state` signal transition in the telemetry pipeline and persisted to the `drives` table the moment they end.

A **trip** is a higher-level grouping of one or more drives that share a purpose — your daily commute, a weekend road trip, a service-centre visit. Trips are created by you (manually or via automation rules) and linked through the `trip_drives` join table.

**Trip Replay** plays back any single drive as a timed animation on the map. The replay scrubber uses sampled positions from `drives.{id}/positions` and overlays telemetry from `drives.{id}/telemetry` so you can see speed, power, and battery as the dot moves. It's a useful tool for insurance evidence, coaching, or just nostalgia.

## Geofences

Geofences are circular or polygon boundaries with a name. They are first-class citizens in the platform — every position write is matched against the active geofence set and an event is emitted on enter / exit.

Geofence events power:

- Automations (`when vehicle enters Home → set charge limit to 80%`)
- Alerts (`notify me when vehicle exits a geofence between midnight and 6am`)
- Location names shown on the dashboard ("Charging at Home" instead of a raw address)
- Drive grouping (drives that start and end inside the same geofence collapse into "errand" trips)

Geofences are not Tesla-side. They live entirely in TeslaSync's database and evaluate locally. You can create thousands of them; the matcher uses an R-tree index for sub-millisecond lookups.

## Sharing

Any drive can be shared via a tokenised public link: `POST /api/v1/drives/{drive_id}/share` returns a `token`, and `GET /api/v1/share/{token}` serves a read-only public page. The page renders the route, summary stats, and a few selected telemetry charts.

Tokens are revocable (`DELETE /api/v1/shares/{token}`). They are also rate-limited at the ingress layer so a leaked token can't be used to scrape your data. We treat shared URLs as public-by-token — assume anyone with the URL can see the drive, and revoke when you're done.

## How Helix helps tracking (opt-in)

Each of these is off by default and individually toggled in **Settings → Helix**:

- **`drive-coaching`** — Helix reads the drive's telemetry and writes a short coaching narrative on the drive-detail page ("Heavy regen use on the descent kept you efficient; the 0–60 in the parking lot cost 4 % range")
- **`route-efficiency-explainer`** — explains why a specific route was efficient or inefficient compared to your baseline for the same origin / destination pair
- **`geofence-aware-automation`** — Helix proposes geofence + trigger pairs from your historical position data ("You arrive at 'Work' at 8:45 am on weekdays — want an automation that pre-cools the car at 8:30?")
- **`pii-redaction-shared-exports`** — runs every share / export payload through a redaction pass that strips VINs, GPS, driver names, and free-text emails before the file is generated

## Common gotchas

- **The marker doesn't move**: the SSE connection probably dropped. Check the system-health strip. If it shows "Polling", the marker is still updating on the polling cadence (slower, but it works).
- **The address is wrong**: reverse-geocoding uses your configured provider. If `GOOGLE_MAPS_API_KEY` and `AZURE_MAPS_API_KEY` are both empty, addresses fall back to coordinates.
- **The drive didn't get recorded**: Tesla's telemetry sometimes drops `shift_state` transitions. The recovery worker scans the position history nightly and stitches missed drives. They appear retroactively.
- **The replay is choppy**: position sampling rate depends on how the drive was captured. Fleet Telemetry drives have ~1 Hz samples; pure polling drives are sparser.

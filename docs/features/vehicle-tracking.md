# Vehicle Tracking

Vehicle tracking covers live map, vehicle detail, trip replay, geofences, navigation routes, locations, and drive history.

## Main pages

| Page | Purpose |
|---|---|
| Live Map | Current fleet positions and status |
| Fleet | Vehicle list, vehicle state, access, and detail navigation |
| Vehicle Detail | State, telemetry, commands, battery, location, and recent activity |
| Digital Twin | Visual vehicle state for doors, windows, lights, locks, climate, and sensors |
| Drives | Drive sessions, scores, positions, telemetry, and sharing |
| Trip Replay | Route playback for recorded drives |
| Trips | Grouped journeys and trip details |
| Geofences | Location boundaries and related automation/alert context |
| Navigation | Route planning and navigation-related Tesla data |

## Data sources

- `/vehicles`
- `/vehicles/{vehicle_id}/state`
- `/vehicles/{vehicle_id}/positions`
- `/drives`
- `/drives/{drive_id}/positions`
- `/drives/{drive_id}/telemetry`
- `/geofences`
- `/locations`
- `/trips`

## Map behavior

Map features use shared map components from `@/components/maps`. Pages should not import Leaflet directly. Map tiles may be cached by the PWA service worker, but API and live-state traffic are not cached as static assets.

## Sharing

Drive share links use tokenized public routes. Treat shared URLs as public-by-token and revoke them when they are no longer needed.
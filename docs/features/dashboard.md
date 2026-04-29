# Dashboard

The dashboard is TeslaSync's operational home screen. It combines fleet summary, live status, quick actions, recent activity, charts, and navigation into a responsive layout.

## What it shows

| Area | Purpose |
|---|---|
| Fleet summary | Vehicle count, online/asleep states, battery and charging overview |
| Live vehicle cards | Current state from `/vehicles/{id}/state` and telemetry updates |
| Recent activity | Drives, charging, commands, alerts, and notifications |
| Analytics snapshots | Efficiency, energy, cost, mileage, and battery trends |
| System awareness | Service status, SSE state, API health, and update prompts |

## Real-time behavior

The dashboard subscribes to the shared SSE manager and falls back to TanStack Query polling when the live stream is disconnected. Current vehicle state should come from the live-state API, not stale historical snapshot tables.

## Navigation and discovery

- Sidebar sections can be expanded/collapsed individually or all at once.
- Mobile uses a bottom tab bar plus a theme-aware drawer.
- Command palette search covers route names and keywords.
- Pinned and recent navigation help frequent workflows.

## Theme and layout

The UI uses shared glass panels, cards, badges, skeletons, and charts. Light and dark modes use CSS variables for readability; neon colors are accents rather than primary readable text.

## PWA

The dashboard can run as an installed PWA. Static assets, fonts, and map tiles may cache; live API data remains network-backed.
# Dashboard

The TeslaSync dashboard is the central hub for monitoring your entire Tesla fleet at a glance. It provides real-time statistics, live vehicle states, and key metrics — all rendered with a modern glassmorphism UI.

## Overview

When you open TeslaSync, the Dashboard is the first page you see. It displays:

- **Fleet summary cards** — Total vehicles, active drives, charging sessions, and alerts
- **Live vehicle status** — Each vehicle's current state (online, asleep, driving, charging)
- **Key metrics** — Battery levels, total mileage, energy consumed, estimated costs
- **Recent activity** — Latest drives, charging sessions, and alerts

## Fleet Summary Cards

At the top of the dashboard, stat cards provide a quick snapshot:

| Card | Description |
|------|-------------|
| **Vehicles** | Total number of tracked vehicles and how many are currently online |
| **Active Drives** | Number of vehicles currently driving, with total distance today |
| **Charging** | Vehicles currently charging, with energy being added |
| **Alerts** | Unread alerts count with severity breakdown |

Each card uses the `StatCard` glass component with animated counters.

## Vehicle Status Grid

Below the summary cards, each vehicle is displayed as a card showing:

- **Display name** and model (e.g., "My Model 3 — Long Range")
- **Current state** — Online (green), Asleep (gray), Driving (blue), Charging (amber)
- **Battery level** — Visual gauge with percentage
- **Rated range** — Estimated range in km or miles (based on settings)
- **Location** — Last known address or GPS coordinates
- **Temperature** — Inside and outside temps

Click any vehicle card to navigate to the [Vehicle Detail](/features/vehicle-tracking) page.

## Real-Time Updates

The dashboard uses **Server-Sent Events (SSE)** to receive live updates without polling:

```
Browser ←── SSE ←── Backend ←── Tesla API (polled every 15s)
```

When the worker polls new vehicle data, it broadcasts events to all connected dashboard clients. You'll see:

- Battery levels update in real time
- Vehicle states change as cars wake, sleep, drive, or charge
- New alerts appear immediately
- Charging progress updates live

The connection indicator in the top-right shows whether the SSE connection is active (green dot) or disconnected (red dot). Auto-reconnect happens within 3 seconds.

## Themes

The dashboard supports 5 visual themes, selectable from Settings or the theme picker:

| Theme | Primary Color | Style |
|-------|--------------|-------|
| **Neon Cyan** | `#00f0ff` | Default — electric blue/cyan glassmorphism |
| **Tesla Red** | `#e82127` | Tesla brand red |
| **Matrix Green** | `#00ff41` | Hacker/matrix green |
| **Royal Purple** | `#7c3aed` | Deep purple elegance |
| **Solar Amber** | `#f59e0b` | Warm amber/gold |

Themes are applied via CSS custom properties and stored in localStorage for persistence.

## Command Palette

Press **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux) to open the command palette. This provides instant navigation to any page or vehicle:

- Type "Model 3" to jump to that vehicle's detail page
- Type "charging" to open the charging history page
- Type "settings" to go to application settings

The command palette searches across page names, vehicle names, and VINs.

## Responsive Design

The dashboard is fully responsive:

- **Desktop** (1280px+): 4-column grid for stat cards, 3-column vehicle grid
- **Tablet** (768–1279px): 2-column grid layout
- **Mobile** (< 768px): Single-column stacked layout with collapsible sidebar

## API Endpoints Used

The dashboard fetches data from these backend endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/vehicles` | GET | List all vehicles with current state |
| `/api/v1/events` | GET (SSE) | Real-time event stream |
| `/api/v1/alerts` | GET | Unread alerts count |
| `/api/v1/analytics/fleet` | GET | Fleet-wide summary statistics |

## Widgets

The dashboard is composed of reusable widget components from `Widgets.tsx`:

- **BatteryGauge** — Circular progress indicator for battery level
- **RangeBar** — Horizontal bar showing rated vs. ideal range
- **SpeedIndicator** — Current speed display (0 when parked)
- **TempDisplay** — Inside/outside temperature with icons
- **AlertBadge** — Badge showing unread alert count by severity

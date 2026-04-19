---
description: "Automation presets: 5 home & garage templates — Arrive Home, Leave Home, Garage Auto-Close, Porch Light, Departure Routine"
---

# Presets: Home & Garage (5 templates)

### 1. Arrive Home — Enter home geofence → HomeLink trigger (open garage)
### 2. Leave Home — Leave home geofence → Lock + Sentry ON + Close Windows
### 3. Garage Auto-Close — 5 min after arriving home → HomeLink trigger again (if garage still open)
### 4. Porch Light — Arrive home after sunset → Flash Lights (visual indicator)
### 5. Departure Routine — 10 min before calendar event + at home → Climate ON + HomeLink

## Implementation
Store in `internal/automation/presets/home.go`. All require home geofence to be configured.

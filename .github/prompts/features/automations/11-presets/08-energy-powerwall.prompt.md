---
description: "Automation presets: 4 energy/Powerwall templates — Storm Prep, Grid Outage Alert, Solar Export, Peak Shaving"
---

# Presets: Energy / Powerwall (4 templates)

### 1. Storm Prep — Storm mode activates → Set backup reserve to 100%
### 2. Grid Outage Alert — Grid status → Islanded → Notify all channels immediately
### 3. Solar Export — Battery > 90% + solar producing → Update TOU settings to export
### 4. Peak Shaving — Weekdays 4-9 PM → Discharge battery (TOU self-consumption), 9 PM-4 PM → Charge (off-peak)

## Implementation
Store in `internal/automation/presets/energy.go`. Requires Tesla energy endpoints to be implemented. Mark these presets as "requires Powerwall" in the gallery.

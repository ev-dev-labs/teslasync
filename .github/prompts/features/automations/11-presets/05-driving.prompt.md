---
description: "Automation presets: 6 driving templates — Drive Log, Speed Alert, Break Reminder, Efficiency Coach, Remote Start, Navigate to Work"
---

# Presets: Driving (6 templates)

### 1. Drive Start Log — Drive starts → Notify (fleet tracking)
### 2. Speed Alert — Speed > 85 MPH → Notify (configurable threshold)
### 3. Long Drive Break — Driving > 2h continuous → Notify "Time for a break"
### 4. Efficiency Coach — Drive ends + efficiency < 3 mi/kWh → Notify with tips
### 5. Remote Start Timer — Remote start → wait 5 min → if no drive started → Lock + Notify
### 6. Navigate to Work — Weekday 7:30 AM + at home → Send work address to nav

## Implementation
Store in `internal/automation/presets/driving.go`.

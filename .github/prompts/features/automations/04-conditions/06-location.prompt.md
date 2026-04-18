---
description: "Automation condition: location — only fire if vehicle is at/not at a specific geofence"
---

# Condition: Location

## Config
```json
{"type": "location", "geofence_id": 5, "operator": "inside"}
```
Operators: `inside`, `outside`.

## Implementation
Create `internal/automation/condition/location.go`. Get vehicle's last known position, check if inside/outside the specified geofence (haversine distance vs radius). Return `{met: bool, reason: "vehicle is inside Home geofence"}`.

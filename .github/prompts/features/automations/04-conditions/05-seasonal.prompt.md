---
description: "Automation condition: seasonal — only active during certain months of the year"
---

# Condition: Seasonal

## Config
```json
{"type": "seasonal", "start_month": 11, "end_month": 3}
```
Active November through March (winter). Handles year wrap (11→3 means Nov, Dec, Jan, Feb, Mar).

## Implementation
Create `internal/automation/condition/seasonal.go`. Check if current month is within the range. Handle wrap-around. Return `{met: bool, reason: "April is outside Nov-Mar season"}`.

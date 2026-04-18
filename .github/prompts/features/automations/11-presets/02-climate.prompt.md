---
description: "Automation presets: 8 climate templates — Morning Prep, Summer Cool, Winter Warm, Dog Mode, Camp Mode, Bioweapon, Pre-cool, Climate Saver"
---

# Presets: Climate (8 templates)

### 1. Morning Commute Prep
Weekdays 7:15 AM → Climate ON + Seat Heat Driver + Steering Heat. Condition: outside temp < 40°F.

### 2. Summer Cool Down
When inside temp > 100°F → Climate ON + Set temps 68°F. Cooldown 60 min.

### 3. Winter Warm Up
When outside temp < 32°F and drive starts → Climate ON + Seat Heat + Steering Heat. Seasonal Nov–Mar.

### 4. Dog Mode Auto
When parked + inside temp > 80°F → Dog Mode ON. Condition: vehicle parked for >5 min.

### 5. Camp Mode Night
Daily at 9 PM → Camp Mode ON. Condition: at campground geofence.

### 6. Bioweapon Defense
When air quality alert (via webhook from weather API) → Bioweapon ON. Priority 5.

### 7. Pre-cool Before Departure
30 min before calendar event → Climate ON + Set temps to preferred. Condition: summer months.

### 8. Climate Off Saver
Every 30 min check → if climate ON for 30+ min with no drive started → Climate OFF + notify. Prevents forgotten climate.

## Implementation
Store in `internal/automation/presets/climate.go`. Each preset includes full trigger_config, conditions, actions, and recommended priority/cooldown values.

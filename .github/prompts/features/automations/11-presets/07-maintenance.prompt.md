---
description: "Automation presets: 4 maintenance templates — Software Update, Tire Pressure, Range Degradation, Service Reminder"
---

# Presets: Maintenance (4 templates)

### 1. Software Update Night — Software update available → Schedule install at 2 AM
### 2. Tire Pressure Check — Weekly Sunday 9 AM → check tire pressure → Notify if low
### 3. Range Degradation Alert — Monthly → compare rated range to last month → Notify if >5% drop
### 4. Service Reminder — Odometer milestone (every 25K miles) → Notify "Schedule service"

## Implementation
Store in `internal/automation/presets/maintenance.go`. Some presets use variables to track previous values (e.g., last month's range).

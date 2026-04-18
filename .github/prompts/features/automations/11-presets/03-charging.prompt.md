---
description: "Automation presets: 8 charging templates — Smart Stop, Off-Peak, Trip Prep, Daily Reset, Low Alert, Complete Notify, Amp Saver, Solar Charging"
---

# Presets: Charging (8 templates)

### 1. Smart Charge Stop — Battery reaches 80% → Stop Charge
### 2. Off-Peak Charging — Start Charge at 11 PM, Stop at 6 AM
### 3. Trip Prep — Night before calendar trip → Set Charge Limit 100%
### 4. Daily Limit Reset — Every morning 6 AM → Set Charge Limit 80%
### 5. Low Battery Alert — Battery below 20% → Notify all channels
### 6. Charge Complete Notify — Charging completes → Notify with battery level
### 7. Amperage Saver — 4 PM–9 PM → Set Amps 16A, 9 PM–4 PM → Set Amps 32A (peak/off-peak)
### 8. Solar Charging — Solar production > 5kW → Start Charge (energy trigger, requires Powerwall)

## Implementation
Store in `internal/automation/presets/charging.go`.

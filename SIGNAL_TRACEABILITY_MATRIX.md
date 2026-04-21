# Tesla Signal Traceability Matrix

> **Single source of truth** for Tesla Fleet Telemetry signal mapping integrity in TeslaSync.
>
> Generated: 2026-04-21 | Audited: 230 signals across 13 categories

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total Signals Audited | 230 |
| 🟢 Match (correct end-to-end) | 137 |
| 🟡 Rounding Difference | 0 |
| 🔴 Critical Mismatch | 5 |
| ⚪ Orphaned (ingested, not displayed) | 88 |
| Fixes Required | 5 |

## Category Breakdown

| Category | Signals | 🟢 | 🟡 | 🔴 | ⚪ |
|----------|---------|-----|-----|-----|-----|
| Charging (numeric) | 41 | 19 | 0 | 0 | 22 |
| Charging (enums) | 11 | 6 | 0 | 1 | 4 |
| Powershare | 5 | 0 | 0 | 0 | 5 |
| Climate | 29 | 16 | 0 | 0 | 13 |
| Driving | 12 | 7 | 0 | 0 | 5 |
| Powertrain | 36 | 2 | 0 | 4 | 30 |
| Location | 13 | 11 | 0 | 0 | 2 |
| Media | 11 | 10 | 0 | 0 | 1 |
| Safety | 14 | 14 | 0 | 0 | 0 |
| TPMS | 10 | 10 | 0 | 0 | 0 |
| Vehicle State | 29 | 29 | 0 | 0 | 0 |
| Vehicle Config | 14 | 9 | 0 | 0 | 5 |
| User Preferences | 5 | 4 | 0 | 0 | 1 |
| **Total** | **230** | **137** | **0** | **5** | **88** |

---

## Master Traceability Matrix

### 1 · Charging — Numeric (41 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 1 | ACChargingEnergyIn | Float | direct | vehicle_live_state | ac_charging_energy_in | FLOAT8 | /charging-telemetry/latest | ac_charging_energy_in | useChargingTelemetryLatest | ChargingTelemetrySection, EnergyChargingPanel | `{value} kWh` | 🟢 |
| 2 | ACChargingPower | Float | direct (→charger_power fallback) | vehicle_live_state | charger_power | FLOAT8 | /vehicles/{id}/state | charger_power | useVehicleState | Dashboard, ChargeStatusWidget | `{value} kW` | 🟢 |
| 3 | BatteryLevel | Float | float→int cast | vehicle_live_state | battery_level | INT | /vehicles/{id}/state | battery_level | useVehicleState | Dashboard, ChargeStatusWidget, BatteryGaugeWidget | `{value}%` | 🟢 |
| 4 | BatteryHeaterOn | Bool | ParseEnumBool | vehicle_live_state | battery_heater_on | BOOLEAN | /charging-telemetry/latest | battery_heater_on | useChargingTelemetryLatest | EnergyChargingPanel, LiveTelemetry | Badge (Active/Off) | 🟢 |
| 5 | BmsFullchargecomplete | Bool | ParseEnumBool | vehicle_live_state | bms_fullchargecomplete | BOOLEAN | /charging-telemetry/latest | bms_fullchargecomplete | useChargingTelemetryLatest | — | — | ⚪ |
| 6 | BrickVoltageMax | Float | direct | vehicle_live_state | brick_voltage_max | FLOAT8 | /charging-telemetry/latest | brick_voltage_max | useChargingTelemetryLatest | EnergyChargingPanel | `{spread} mV` | 🟢 |
| 7 | BrickVoltageMin | Float | direct | vehicle_live_state | brick_voltage_min | FLOAT8 | /charging-telemetry/latest | brick_voltage_min | useChargingTelemetryLatest | EnergyChargingPanel | `{spread} mV` | 🟢 |
| 8 | ChargeAmps | Float | direct | vehicle_live_state | charge_amps | FLOAT8 | /charging-telemetry/latest | charge_amps | useChargingTelemetryLatest | ChargingTelemetrySection | `{value} A` | 🟢 |
| 9 | ChargeCurrentRequest | Float | direct | vehicle_live_state | charge_current_request | FLOAT8 | /charging-telemetry/latest | charge_current_request | useChargingTelemetryLatest | — | — | ⚪ |
| 10 | ChargeCurrentRequestMax | Float | direct | vehicle_live_state | charge_current_request_max | FLOAT8 | /charging-telemetry/latest | charge_current_request_max | useChargingTelemetryLatest | — | — | ⚪ |
| 11 | ChargeEnableRequest | Bool | ParseEnumBool | vehicle_live_state | charge_enable_request | BOOLEAN | /charging-telemetry/latest | charge_enable_request | useChargingTelemetryLatest | — | — | ⚪ |
| 12 | ChargeLimitSoc | Float | direct | vehicle_live_state | charge_limit_soc | INT | /signals/{id}/live | charge_limit_soc | useSignalGaps (live) | ChargingScheduleWidget | `{value}%` | 🟢 |
| 13 | ChargePortColdWeatherMode | Bool | ParseEnumBool | vehicle_live_state | charge_port_cold_weather_mode | BOOLEAN | /charging-telemetry/latest | charge_port_cold_weather_mode | useChargingTelemetryLatest | — | — | ⚪ |
| 14 | ChargePortDoorOpen | Bool | ParseEnumBool | vehicle_live_state | charge_port_door_open | BOOLEAN | /charging-telemetry/latest | charge_port_door_open | useChargingTelemetryLatest | DigitalTwinMiniWidget | Visual port indicator | 🟢 |
| 15 | ChargeRateMilePerHour | Float | direct | vehicle_live_state | charge_rate | FLOAT8 | /vehicles/{id}/state | charge_rate | useVehicleState | Dashboard | `{value} mi/h` | 🟢 |
| 16 | ChargerPhases | Float | direct | vehicle_live_state | charger_phases | FLOAT8 | /charging-telemetry/latest | charger_phases | useChargingTelemetryLatest | ChargingTelemetrySection | Phase count | 🟢 |
| 17 | ChargerVoltage | Float | direct | vehicle_live_state | charger_voltage | FLOAT8 | /charging-telemetry/latest | charger_voltage | useChargingTelemetryLatest | ChargingTelemetrySection | `{value} V` | 🟢 |
| 18 | DCChargingEnergyIn | Float | direct | vehicle_live_state | dc_charging_energy_in | FLOAT8 | /charging-telemetry/latest | dc_charging_energy_in | useChargingTelemetryLatest | ChargingTelemetrySection | `{value} kWh` | 🟢 |
| 19 | DCChargingPower | Float | direct | vehicle_live_state | charger_power | FLOAT8 | /vehicles/{id}/state | charger_power | useVehicleState | Dashboard, ChargingTelemetrySection | `{value} kW` | 🟢 |
| 20 | DCDCEnable | Bool | ParseEnumBool | vehicle_live_state | dcdc_enable | BOOLEAN | /charging-telemetry/latest | dcdc_enable | useChargingTelemetryLatest | — | — | ⚪ |
| 21 | EnergyRemaining | Float | direct | vehicle_live_state | energy_remaining | FLOAT8 | /charging-telemetry/latest | energy_remaining | useChargingTelemetryLatest | EnergyChargingPanel | `{value} kWh` | 🟢 |
| 22 | EstBatteryRange | Float | direct | vehicle_live_state | est_range | FLOAT8 | /charging-telemetry/latest | est_battery_range | useChargingTelemetryLatest | — | — | ⚪ |
| 23 | EstimatedHoursToChargeTermination | Float | direct | vehicle_live_state | estimated_hours_to_charge_termination | FLOAT8 | /charging-telemetry/latest | estimated_hours_to_charge_termination | useChargingTelemetryLatest | — | — | ⚪ |
| 24 | ExpectedEnergyPercentAtTripArrival | Float | direct | vehicle_live_state | expected_energy_percent_at_trip_arrival | FLOAT8 | /charging-telemetry/latest | expected_energy_percent_at_trip_arrival | useChargingTelemetryLatest | — | — | ⚪ |
| 25 | FastChargerPresent | Bool | ParseEnumBool | vehicle_live_state | fast_charger_present | BOOLEAN | /charging-telemetry/latest | fast_charger_present | useChargingTelemetryLatest | — | — | ⚪ |
| 26 | IdealBatteryRange | Float | direct | vehicle_live_state | ideal_range | FLOAT8 | /vehicles/{id}/state | ideal_range | useVehicleState | — (used internally) | — | ⚪ |
| 27 | LifetimeEnergyUsed | Float | direct | vehicle_live_state | lifetime_energy_used | FLOAT8 | /charging-telemetry/latest | lifetime_energy_used | useChargingTelemetryLatest | — | — | ⚪ |
| 28 | ModuleTempMax | Float | direct | vehicle_live_state | module_temp_max | FLOAT8 | /charging-telemetry/latest | module_temp_max | useChargingTelemetryLatest | — | — | ⚪ |
| 29 | ModuleTempMin | Float | direct | vehicle_live_state | module_temp_min | FLOAT8 | /charging-telemetry/latest | module_temp_min | useChargingTelemetryLatest | — | — | ⚪ |
| 30 | NotEnoughPowerToHeat | Bool | ParseEnumBool | vehicle_live_state | not_enough_power_to_heat | BOOLEAN | /charging-telemetry/latest | not_enough_power_to_heat | useChargingTelemetryLatest | — | — | ⚪ |
| 31 | NumBrickVoltageMax | Float | direct | vehicle_live_state | num_brick_voltage_max | FLOAT8 | /charging-telemetry/latest | num_brick_voltage_max | useChargingTelemetryLatest | — | — | ⚪ |
| 32 | NumBrickVoltageMin | Float | direct | vehicle_live_state | num_brick_voltage_min | FLOAT8 | /charging-telemetry/latest | num_brick_voltage_min | useChargingTelemetryLatest | — | — | ⚪ |
| 33 | NumModuleTempMax | Float | direct | vehicle_live_state | num_module_temp_max | FLOAT8 | /charging-telemetry/latest | num_module_temp_max | useChargingTelemetryLatest | — | — | ⚪ |
| 34 | NumModuleTempMin | Float | direct | vehicle_live_state | num_module_temp_min | FLOAT8 | /charging-telemetry/latest | num_module_temp_min | useChargingTelemetryLatest | — | — | ⚪ |
| 35 | PackCurrent | Float | direct | vehicle_live_state | pack_current | FLOAT8 | /charging-telemetry/latest | pack_current | useChargingTelemetryLatest | EnergyChargingPanel | `{value} A` | 🟢 |
| 36 | PackVoltage | Float | direct | vehicle_live_state | pack_voltage | FLOAT8 | /charging-telemetry/latest | pack_voltage | useChargingTelemetryLatest | ChargingTelemetrySection, EnergyChargingPanel | `{value} V` | 🟢 |
| 37 | PreconditioningEnabled | Bool | ParseEnumBool | vehicle_live_state | preconditioning_enabled | BOOLEAN | /charging-telemetry/latest | preconditioning_enabled | useChargingTelemetryLatest | — | — | ⚪ |
| 38 | RatedRange | Float | direct | vehicle_live_state | rated_range | FLOAT8 | /vehicles/{id}/state | rated_range | useVehicleState | — (used internally) | — | ⚪ |
| 39 | Soc | Float | direct | vehicle_live_state | soc | FLOAT8 | /charging-telemetry/latest | soc | useChargingTelemetryLatest | ChargingTelemetrySection | `{value}%` | 🟢 |
| 40 | SuperchargerSessionTripPlanner | Bool | ParseEnumBool | vehicle_live_state | supercharger_session_trip_planner | VARCHAR | /charging-telemetry/latest | supercharger_session_trip_planner | useChargingTelemetryLatest | — | — | ⚪ |
| 41 | TimeToFullCharge | Float | direct | vehicle_live_state | time_to_full_charge | FLOAT8 | /vehicles/{id}/state | time_to_full_charge | useVehicleState | ChargingTelemetrySection | `{value}h` | 🟢 |

### 2 · Charging — Enums (11 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 42 | BMSState | Enum | ParseBMSState (strip prefix) | vehicle_live_state | bms_state | VARCHAR | /charging-telemetry/latest | bms_state | useChargingTelemetryLatest | EnergyChargingPanel | Badge (Standby/Charge/Fault) | 🟢 |
| 43 | ChargePort | Enum | ParseChargePort (strip prefix) | vehicle_live_state | charge_port | VARCHAR | — | — | — | — | — | 🔴 |
| 44 | ChargePortLatch | Enum | ParseChargePortLatch (strip prefix) | vehicle_live_state | charge_port_latch | VARCHAR | /charging-telemetry/latest | charge_port_latch | useChargingTelemetryLatest | — | — | ⚪ |
| 45 | ChargeState | Enum | ParseChargeState (strip prefix) | vehicle_live_state | charge_state | VARCHAR | /charging-telemetry/latest | charge_state | useChargingTelemetryLatest | ChargingTelemetrySection | Direct string | 🟢 |
| 46 | ChargingCableType | Enum | direct (→ VARCHAR) | vehicle_live_state | charging_cable_type | VARCHAR | /charging-telemetry/latest | charging_cable_type | useChargingTelemetryLatest | — | — | ⚪ |
| 47 | DetailedChargeState | Enum | ParseDetailedChargeState (strip prefix) | vehicle_live_state | detailed_charge_state | VARCHAR | /charging-telemetry/latest | detailed_charge_state | useChargingTelemetryLatest | — (→is_charging bool internally) | — | ⚪ |
| 48 | FastChargerType | Enum | direct (→ VARCHAR) | vehicle_live_state | fast_charger_type | VARCHAR | /charging-telemetry/latest | fast_charger_type | useChargingTelemetryLatest | — | — | ⚪ |
| 49 | ScheduledChargingMode | Enum | ParseScheduledChargingMode (strip prefix) | vehicle_live_state | scheduled_charging_mode | VARCHAR | /signals/{id}/live | scheduled_charging_mode | useSignalGaps (live) | ChargingScheduleWidget | Mode label | 🟢 |
| 50 | ScheduledChargingPending | Bool | ParseEnumBool | vehicle_live_state | scheduled_charging_pending | BOOLEAN | /signals/{id}/live | scheduled_charging_pending | useSignalGaps (live) | ChargingScheduleWidget | Boolean badge | 🟢 |
| 51 | ScheduledChargingStartTime | Time | compound→"HH:MM:SS" | vehicle_live_state | scheduled_charging_start_time | VARCHAR | /signals/{id}/live | scheduled_charging_start_time | useSignalGaps (live) | ChargingScheduleWidget | Formatted time | 🟢 |
| 52 | ScheduledDepartureTime | Time | compound→"HH:MM:SS" | vehicle_live_state | scheduled_departure_time | VARCHAR | /signals/{id}/live | scheduled_departure_time | useSignalGaps (live) | ChargingScheduleWidget | Formatted time | 🟢 |

### 3 · Powershare (5 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 53 | PowershareHoursLeft | Float | direct | vehicle_live_state | powershare_hours_left | FLOAT8 | /charging-telemetry/latest | powershare_hours_left | useChargingTelemetryLatest | — | — | ⚪ |
| 54 | PowershareInstantaneousPowerKW | Float | direct | vehicle_live_state | powershare_instantaneous_power_kw | FLOAT8 | /charging-telemetry/latest | powershare_instantaneous_power_kw | useChargingTelemetryLatest | — | — | ⚪ |
| 55 | PowershareStatus | Enum | ParsePowershareStatus (strip prefix) | vehicle_live_state | powershare_status | VARCHAR | /charging-telemetry/latest | powershare_status | useChargingTelemetryLatest | — | — | ⚪ |
| 56 | PowershareStopReason | Enum | ParsePowershareStopReason (strip prefix) | vehicle_live_state | powershare_stop_reason | VARCHAR | /charging-telemetry/latest | powershare_stop_reason | useChargingTelemetryLatest | — | — | ⚪ |
| 57 | PowershareType | Enum | ParsePowershareType (strip prefix) | vehicle_live_state | powershare_type | VARCHAR | /charging-telemetry/latest | powershare_type | useChargingTelemetryLatest | — | — | ⚪ |

### 4 · Climate (29 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 58 | AutoSeatClimateLeft | Bool | ParseEnumBool | vehicle_live_state | auto_seat_climate_left | BOOLEAN | /climate/latest | auto_seat_climate_left | useClimate | — | — | ⚪ |
| 59 | AutoSeatClimateRight | Bool | ParseEnumBool | vehicle_live_state | auto_seat_climate_right | BOOLEAN | /climate/latest | auto_seat_climate_right | useClimate | — | — | ⚪ |
| 60 | CabinOverheatProtectionMode | Enum | ParseCabinOverheatMode (strip prefix) | vehicle_live_state | cabin_overheat_protection_mode | VARCHAR | /climate/latest | cabin_overheat_mode | useClimate | ClimatePanel | Badge (On/FanOnly/Off) | 🟢 |
| 61 | CabinOverheatProtectionTemperatureLimit | Enum | direct (→ VARCHAR) | vehicle_live_state | cabin_overheat_protection_temperature_limit | VARCHAR | /climate/latest | cabin_overheat_protection_temp_limit | useClimate | — | — | ⚪ |
| 62 | ClimateKeeperMode | Enum | ParseClimateKeeperMode (strip prefix) | vehicle_live_state | climate_keeper_mode | VARCHAR | /climate/latest | climate_keeper_mode | useClimate | ClimateControlPage, ClimatePanel | Badge (On/Dog Mode/Camp Mode/Off) | 🟢 |
| 63 | ClimateSeatCoolingFrontLeft | Float | direct | vehicle_live_state | climate_seat_cooling_front_left | FLOAT8 | /climate/latest | climate_seat_cooling_front_left | useClimate | — | — | ⚪ |
| 64 | ClimateSeatCoolingFrontRight | Float | direct | vehicle_live_state | climate_seat_cooling_front_right | FLOAT8 | /climate/latest | climate_seat_cooling_front_right | useClimate | — | — | ⚪ |
| 65 | DefrostForPreconditioning | Bool | ParseEnumBool | vehicle_live_state | defrost_for_preconditioning | BOOLEAN | /climate/latest | defrost_for_preconditioning | useClimate | — | — | ⚪ |
| 66 | DefrostMode | Enum | ParseDefrostMode (strip prefix) | vehicle_live_state | defrost_mode | VARCHAR | /climate/latest | defrost_mode | useClimate | ClimateControlPage, ClimatePanel, ClimateStatusWidget | Badge with ❄️ icon | 🟢 |
| 67 | HvacACEnabled | Bool | ParseEnumBool | vehicle_live_state | hvac_ac_enabled | BOOLEAN | /climate/latest | hvac_ac_enabled | useClimate | ClimateControlPage | Badge (On/Off) | 🟢 |
| 68 | HvacAutoMode | Enum | ParseHvacAutoMode (strip prefix) | vehicle_live_state | hvac_auto_mode | VARCHAR | /climate/latest | hvac_auto_mode | useClimate | ClimateControlPage | Badge (On/Off) | 🟢 |
| 69 | HvacFanSpeed | Float | direct (→fan_speed col) | vehicle_live_state | fan_speed | INT | /climate/latest | hvac_fan_speed | useClimate | ClimateControlPage, ClimatePanel | Level 0–6, bar indicators | 🟢 |
| 70 | HvacFanStatus | Float | direct | vehicle_live_state | hvac_fan_status | FLOAT8 | /climate/latest | hvac_fan_status | useClimate | — | — | ⚪ |
| 71 | HvacLeftTemperatureRequest | Float | direct | vehicle_live_state | hvac_left_temperature_request | FLOAT8 | /climate/latest | hvac_left_temp_request | useClimate | ClimatePanel, ClimateControlPage | `fmtNumber(convertTemp())` °C/°F | 🟢 |
| 72 | HvacPower | Enum | ParseHvacPower (→boolean) | vehicle_live_state | hvac_power | BOOLEAN | /climate/latest, /vehicles/{id}/state | hvac_power / is_climate_on | useClimate, useVehicleState | ClimateControlPage, Dashboard | kW bar or boolean | 🟢 |
| 73 | HvacRightTemperatureRequest | Float | direct | vehicle_live_state | hvac_right_temperature_request | FLOAT8 | /climate/latest | hvac_right_temp_request | useClimate | ClimatePanel, ClimateControlPage | `fmtNumber(convertTemp())` °C/°F | 🟢 |
| 74 | HvacSteeringWheelHeatAuto | Bool | ParseEnumBool | vehicle_live_state | hvac_steering_wheel_heat_auto | BOOLEAN | /climate/latest | hvac_steering_wheel_heat_auto | useClimate | — | — | ⚪ |
| 75 | HvacSteeringWheelHeatLevel | Float | direct | vehicle_live_state | hvac_steering_wheel_heat_level | FLOAT8 | /climate/latest | hvac_steering_wheel_heat_level | useClimate | — | — | ⚪ |
| 76 | InsideTemp | Float | direct | vehicle_live_state | inside_temp | FLOAT8 | /climate/latest, /vehicles/{id}/state | inside_temp | useClimate, useVehicleState | ClimateControlPage, ClimatePanel, ClimateStatusWidget, Dashboard | `fmtNumber(convertTemp(), 1)` °C/°F | 🟢 |
| 77 | OutsideTemp | Float | direct | vehicle_live_state | outside_temp | FLOAT8 | /climate/latest, /vehicles/{id}/state | outside_temp | useClimate, useVehicleState | ClimateControlPage, ClimatePanel, ClimateStatusWidget, Dashboard | `fmtNumber(convertTemp(), 1)` °C/°F | 🟢 |
| 78 | RearDefrostEnabled | Bool | ParseEnumBool | vehicle_live_state | rear_defrost_enabled | BOOLEAN | /climate/latest | rear_defrost_enabled | useClimate | — | — | ⚪ |
| 79 | RearDisplayHvacEnabled | Bool | ParseEnumBool | vehicle_live_state | rear_display_hvac_enabled | BOOLEAN | /climate/latest | rear_display_hvac_enabled | useClimate | — | — | ⚪ |
| 80 | SeatHeaterLeft | Float | direct | vehicle_live_state | seat_heater_left | FLOAT8 | /climate/latest | seat_heater_left | useClimate | ClimateControlPage | Level 0–3, color-coded badge | 🟢 |
| 81 | SeatHeaterRearCenter | Float | direct | vehicle_live_state | seat_heater_rear_center | FLOAT8 | /climate/latest | seat_heater_rear_center | useClimate | ClimateControlPage | Level 0–3, color-coded badge | 🟢 |
| 82 | SeatHeaterRearLeft | Float | direct | vehicle_live_state | seat_heater_rear_left | FLOAT8 | /climate/latest | seat_heater_rear_left | useClimate | ClimateControlPage | Level 0–3, color-coded badge | 🟢 |
| 83 | SeatHeaterRearRight | Float | direct | vehicle_live_state | seat_heater_rear_right | FLOAT8 | /climate/latest | seat_heater_rear_right | useClimate | ClimateControlPage | Level 0–3, color-coded badge | 🟢 |
| 84 | SeatHeaterRight | Float | direct | vehicle_live_state | seat_heater_right | FLOAT8 | /climate/latest | seat_heater_right | useClimate | ClimateControlPage | Level 0–3, color-coded badge | 🟢 |
| 85 | SeatVentEnabled | Bool | ParseEnumBool | vehicle_live_state | seat_vent_enabled | BOOLEAN | /climate/latest | seat_vent_enabled | useClimate | — | — | ⚪ |
| 86 | WiperHeatEnabled | Bool | ParseEnumBool | vehicle_live_state | wiper_heat_enabled | BOOLEAN | /climate/latest | wiper_heat_enabled | useClimate | — | — | ⚪ |

### 5 · Driving (12 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 87 | BrakePedal | Bool | ParseEnumBool | vehicle_live_state | brake_pedal | BOOLEAN | /motor/latest | brake_pedal | useMotorLatest | PedalUsage, PowertrainPanel, DrivetrainHealthPage | Badge (Active/Inactive) | 🟢 |
| 88 | BrakePedalPos | Float | direct | vehicle_live_state | brake_pedal_pos | FLOAT8 | /motor/latest | brake_pedal_pos | useMotorLatest | — | — | ⚪ |
| 89 | CruiseSetSpeed | Float | direct | vehicle_live_state | cruise_set_speed | FLOAT8 | /motor/latest | cruise_set_speed | useMotorLatest | — | — | ⚪ |
| 90 | DriveRail | Bool | ParseEnumBool | vehicle_live_state | drive_rail | BOOLEAN | /motor/latest | drive_rail | useMotorLatest | — | — | ⚪ |
| 91 | Gear | Enum | ParseGear (D/R/P/N) | vehicle_live_state | gear | VARCHAR | /motor/latest | gear | useMotorLatest | SpeedGearPanel, DrivetrainHealthPage, LiveSignalsWidget | Single char badge, color-coded | 🟢 |
| 92 | LateralAcceleration | Float | direct | vehicle_live_state | lateral_acceleration | FLOAT8 | /motor/latest | lateral_accel | useMotorLatest | GForcePanel, PowertrainPanel, MotorHistoryCharts | `fmtNumber(value, 2)` g | 🟢 |
| 93 | LifetimeEnergyGainedRegen | Float | direct | vehicle_live_state | lifetime_energy_gained_regen | FLOAT8 | /motor/latest | lifetime_energy_gained_regen | useMotorLatest | — | — | ⚪ |
| 94 | LifetimeEnergyUsedDrive | Float | direct | vehicle_live_state | lifetime_energy_used_drive | FLOAT8 | /motor/latest | lifetime_energy_used_drive | useMotorLatest | — | — | ⚪ |
| 95 | LongitudinalAcceleration | Float | direct | vehicle_live_state | longitudinal_acceleration | FLOAT8 | /motor/latest | longitudinal_accel | useMotorLatest | GForcePanel, PowertrainPanel, MotorHistoryCharts | `fmtNumber(value, 2)` g | 🟢 |
| 96 | PedalPosition | Float | direct | vehicle_live_state | pedal_position | FLOAT8 | /motor/latest | pedal_position | useMotorLatest | PedalUsage, MotorSection, PowertrainPanel | Percentage 0–100%, gauge | 🟢 |
| 97 | RouteTrafficMinutesDelay | Float | direct | vehicle_live_state | route_traffic_minutes_delay | FLOAT8 | /location-snapshots/latest | route_traffic_minutes_delay | useLocationSnapshotLatest | NavigationRoutePage | `{value} min` | 🟢 |
| 98 | VehicleSpeed | Float | direct | vehicle_live_state | speed | FLOAT8 | /vehicles/{id}/state, /motor/latest | speed / vehicle_speed | useVehicleState, useMotorLatest | SpeedGearPanel, Dashboard, DrivetrainHealthPage | `convertSpeed()` with unit | 🟢 |

### 6 · Powertrain (36 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 99 | DiAxleSpeedF | Float | direct | vehicle_live_state | di_axle_speed_f | FLOAT8 | /motor/latest | di_axle_speed_f | useMotorLatest | — | — | ⚪ |
| 100 | DiAxleSpeedR | Float | direct | vehicle_live_state | di_axle_speed_r | FLOAT8 | /motor/latest | — | useMotorLatest | — | Missing from MotorSnapshot TS type | 🔴 |
| 101 | DiAxleSpeedREL | Float | direct | vehicle_live_state | di_axle_speed_rel | FLOAT8 | /motor/latest | di_axle_speed_rel | useMotorLatest | — | — | ⚪ |
| 102 | DiAxleSpeedRER | Float | direct | vehicle_live_state | di_axle_speed_rer | FLOAT8 | /motor/latest | — | useMotorLatest | — | Missing from MotorSnapshot TS type | 🔴 |
| 103 | DiHeatsinkTF | Float | direct | vehicle_live_state | di_heatsink_tf | FLOAT8 | /motor/latest | di_heatsink_t_f | useMotorLatest | — | — | ⚪ |
| 104 | DiHeatsinkTR | Float | direct | vehicle_live_state | di_heatsink_tr | FLOAT8 | /motor/latest | di_heatsink_t_r | useMotorLatest | — | — | ⚪ |
| 105 | DiHeatsinkTREL | Float | direct | vehicle_live_state | di_heatsink_trel | FLOAT8 | /motor/latest | di_heatsink_t_rel | useMotorLatest | — | — | ⚪ |
| 106 | DiHeatsinkTRER | Float | direct | vehicle_live_state | di_heatsink_trer | FLOAT8 | /motor/latest | di_heatsink_t_rer | useMotorLatest | — | — | ⚪ |
| 107 | DiInverterTF | Float | direct | vehicle_live_state | di_inverter_tf | FLOAT8 | /motor/latest | di_inverter_t_f | useMotorLatest | — | — | ⚪ |
| 108 | DiInverterTR | Float | direct | vehicle_live_state | di_inverter_tr | FLOAT8 | /motor/latest | di_inverter_t_r | useMotorLatest | — | — | ⚪ |
| 109 | DiInverterTREL | Float | direct | vehicle_live_state | di_inverter_trel | FLOAT8 | /motor/latest | di_inverter_t_rel | useMotorLatest | — | — | ⚪ |
| 110 | DiInverterTRER | Float | direct | vehicle_live_state | di_inverter_trer | FLOAT8 | /motor/latest | di_inverter_t_rer | useMotorLatest | — | — | ⚪ |
| 111 | DiMotorCurrentF | Float | direct | vehicle_live_state | di_motor_current_f | FLOAT8 | /motor/latest | di_motor_current_f | useMotorLatest | — | — | ⚪ |
| 112 | DiMotorCurrentR | Float | direct | vehicle_live_state | di_motor_current_r | FLOAT8 | /motor/latest | di_motor_current_r | useMotorLatest | — | — | ⚪ |
| 113 | DiMotorCurrentREL | Float | direct | vehicle_live_state | di_motor_current_rel | FLOAT8 | /motor/latest | di_motor_current_rel | useMotorLatest | — | — | ⚪ |
| 114 | DiMotorCurrentRER | Float | direct | vehicle_live_state | di_motor_current_rer | FLOAT8 | /motor/latest | di_motor_current_rer | useMotorLatest | — | — | ⚪ |
| 115 | DiSlaveTorqueCmd | Float | direct | vehicle_live_state | di_slave_torque_cmd | FLOAT8 | /motor/latest | di_slave_torque_cmd | useMotorLatest | — | — | ⚪ |
| 116 | DiStateF | Enum | direct (→ VARCHAR) | vehicle_live_state | di_state_f | VARCHAR | /motor/latest | di_state_f | useMotorLatest | — | — | ⚪ |
| 117 | DiStateR | Enum | direct (→ VARCHAR) | vehicle_live_state | di_state_r | VARCHAR | /motor/latest | — | useMotorLatest | — | Missing from MotorSnapshot TS type | 🔴 |
| 118 | DiStateREL | Enum | direct (→ VARCHAR) | vehicle_live_state | di_state_rel | VARCHAR | /motor/latest | di_state_rel | useMotorLatest | — | — | ⚪ |
| 119 | DiStateRER | Enum | direct (→ VARCHAR) | vehicle_live_state | di_state_rer | VARCHAR | /motor/latest | di_state_rer | useMotorLatest | — | — | ⚪ |
| 120 | DiStatorTempF | Float | direct | vehicle_live_state | di_stator_temp_f | FLOAT8 | /motor/latest | di_stator_temp_f | useMotorLatest | — | — | ⚪ |
| 121 | DiStatorTempR | Float | direct | vehicle_live_state | di_stator_temp_r | FLOAT8 | /motor/latest | — | useMotorLatest | — | Missing from MotorSnapshot TS type | 🔴 |
| 122 | DiStatorTempREL | Float | direct | vehicle_live_state | di_stator_temp_rel | FLOAT8 | /motor/latest | di_stator_temp_rel | useMotorLatest | — | — | ⚪ |
| 123 | DiStatorTempRER | Float | direct | vehicle_live_state | di_stator_temp_rer | FLOAT8 | /motor/latest | di_stator_temp_rer | useMotorLatest | — | — | ⚪ |
| 124 | DiTorqueActualF | Float | direct | vehicle_live_state | di_torque_actual_f | FLOAT8 | /motor/latest | di_torque_actual_f | useMotorLatest | — | — | ⚪ |
| 125 | DiTorqueActualR | Float | direct | vehicle_live_state | di_torque_actual_r | FLOAT8 | /motor/latest | di_torque_actual_r | useMotorLatest | — | — | ⚪ |
| 126 | DiTorqueActualREL | Float | direct | vehicle_live_state | di_torque_actual_rel | FLOAT8 | /motor/latest | di_torque_actual_rel | useMotorLatest | — | — | ⚪ |
| 127 | DiTorqueActualRER | Float | direct | vehicle_live_state | di_torque_actual_rer | FLOAT8 | /motor/latest | di_torque_actual_rer | useMotorLatest | — | — | ⚪ |
| 128 | DiTorquemotor | Float | direct | vehicle_live_state | di_torquemotor | FLOAT8 | /motor/latest | di_torque | useMotorLatest | DrivingDynamicsPage, DrivetrainHealthPage, Dashboard | Radial gauge 0–500 Nm | 🟢 |
| 129 | DiVBatF | Float | direct | vehicle_live_state | di_v_bat_f | FLOAT8 | /motor/latest | di_v_bat_f | useMotorLatest | — | — | ⚪ |
| 130 | DiVBatR | Float | direct | vehicle_live_state | di_v_bat_r | FLOAT8 | /motor/latest | di_v_bat_r | useMotorLatest | — | — | ⚪ |
| 131 | DiVBatREL | Float | direct | vehicle_live_state | di_v_bat_rel | FLOAT8 | /motor/latest | di_v_bat_rel | useMotorLatest | — | — | ⚪ |
| 132 | DiVBatRER | Float | direct | vehicle_live_state | di_v_bat_rer | FLOAT8 | /motor/latest | di_v_bat_rer | useMotorLatest | — | — | ⚪ |
| 133 | Hvil | Enum | direct (→ VARCHAR) | vehicle_live_state | hvil | VARCHAR | /motor/latest | hvil | useMotorLatest | DrivetrainHealthPage | Text: Fault (red) / Normal (green) | 🟢 |
| 134 | IsolationResistance | Float | direct | vehicle_live_state | isolation_resistance | FLOAT8 | /motor/latest | — | useMotorLatest | — | Missing from MotorSnapshot TS type | ⚪ |

### 7 · Location (13 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 135 | DestinationLocation | Location | compound→lat/lon split | vehicle_live_state | destination_lat/lon | FLOAT8 | /location-snapshots/latest | destination_lat, destination_lon | useLocationSnapshotLatest | NavigationRoutePage, MapOverviewPage | Map marker | 🟢 |
| 136 | DestinationName | String | direct | vehicle_live_state | destination_name | VARCHAR | /location-snapshots/latest | destination_name | useLocationSnapshotLatest | NavigationRoutePage, MapOverviewPage, MediaNavigationPanel | Text | 🟢 |
| 137 | GpsHeading | Float | direct | vehicle_live_state | heading | FLOAT8 | /vehicles/{id}/state | heading | useVehicleState | Dashboard (GlancePage) | Cardinal direction | 🟢 |
| 138 | GpsState | String | direct | vehicle_live_state | gps_state | VARCHAR | /location-snapshots/latest | gps_state | useLocationSnapshotLatest | — | — | ⚪ |
| 139 | LocatedAtFavorite | Bool | ParseEnumBool | vehicle_live_state | located_at_favorite | BOOLEAN | /location-snapshots/latest | located_at_favorite | useLocationSnapshotLatest | NavigationRoutePage, MapOverviewPage | Badge "⭐ Favorite" | 🟢 |
| 140 | LocatedAtHome | Bool | ParseEnumBool | vehicle_live_state | located_at_home | BOOLEAN | /location-snapshots/latest | located_at_home | useLocationSnapshotLatest | NavigationRoutePage, MapOverviewPage, Dashboard | Badge "🏠 Home" | 🟢 |
| 141 | LocatedAtWork | Bool | ParseEnumBool | vehicle_live_state | located_at_work | BOOLEAN | /location-snapshots/latest | located_at_work | useLocationSnapshotLatest | NavigationRoutePage, MapOverviewPage | Badge "🏢 Work" | 🟢 |
| 142 | Location | Location | compound→lat/lon split | vehicle_live_state | latitude, longitude | FLOAT8 | /vehicles/{id}/state | latitude, longitude | useVehicleState | Dashboard, MapOverviewPage | Map coordinates | 🟢 |
| 143 | MilesToArrival | Float | direct | vehicle_live_state | miles_to_arrival | FLOAT8 | /location-snapshots/latest | miles_to_arrival | useLocationSnapshotLatest | NavigationRoutePage, MediaNavigationPanel, Dashboard | Numeric + unit conversion | 🟢 |
| 144 | MinutesToArrival | Float | direct | vehicle_live_state | minutes_to_arrival | FLOAT8 | /location-snapshots/latest | minutes_to_arrival | useLocationSnapshotLatest | NavigationRoutePage, MediaNavigationPanel, Dashboard | `{value} min` | 🟢 |
| 145 | OriginLocation | Location | compound→lat/lon split | vehicle_live_state | origin_lat/lon | FLOAT8 | /location-snapshots/latest | origin_lat, origin_lon | useLocationSnapshotLatest | NavigationRoutePage | Map marker | 🟢 |
| 146 | RouteLine | Route | encoded polyline string | vehicle_live_state | route_line | TEXT | /location-snapshots/latest | route_line | useLocationSnapshotLatest | NavigationRoutePage | Map polyline | 🟢 |
| 147 | RouteLastUpdated | String | direct | vehicle_live_state | route_last_updated | VARCHAR | /location-snapshots/latest | route_last_updated | useLocationSnapshotLatest | — | — | ⚪ |

### 8 · Media (11 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 148 | MediaAudioVolume | Float | direct | vehicle_live_state | media_audio_volume | FLOAT8 | /media/latest | audio_volume | useMediaLatest | MediaPlayerPage, Dashboard, MediaNowPlayingWidget | Progress bar + numeric | 🟢 |
| 149 | MediaAudioVolumeIncrement | Float | direct | vehicle_live_state | media_audio_volume_increment | FLOAT8 | /media/latest | audio_volume_increment | useMediaLatest | — | — | ⚪ |
| 150 | MediaAudioVolumeMax | Float | direct | vehicle_live_state | media_audio_volume_max | FLOAT8 | /media/latest | audio_volume_max | useMediaLatest | MediaPlayerPage, Dashboard, MediaNowPlayingWidget | Numeric denominator | 🟢 |
| 151 | MediaNowPlayingAlbum | String | direct | vehicle_live_state | media_now_playing_album | VARCHAR | /media/latest | now_playing_album | useMediaLatest | MediaPlayerPage, Dashboard | Text | 🟢 |
| 152 | MediaNowPlayingArtist | String | direct | vehicle_live_state | media_now_playing_artist | VARCHAR | /media/latest | now_playing_artist | useMediaLatest | MediaPlayerPage, Dashboard, MediaNowPlayingWidget | Text | 🟢 |
| 153 | MediaNowPlayingDuration | Float | direct | vehicle_live_state | media_now_playing_duration | FLOAT8 | /media/latest | now_playing_duration | useMediaLatest | MediaPlayerPage | MM:SS (fmtPlayTime) | 🟢 |
| 154 | MediaNowPlayingElapsed | Float | direct | vehicle_live_state | media_now_playing_elapsed | FLOAT8 | /media/latest | now_playing_elapsed | useMediaLatest | MediaPlayerPage | MM:SS (fmtPlayTime) | 🟢 |
| 155 | MediaNowPlayingStation | String | direct | vehicle_live_state | media_now_playing_station | VARCHAR | /media/latest | now_playing_station | useMediaLatest | MediaPlayerPage, Dashboard | Text | 🟢 |
| 156 | MediaNowPlayingTitle | String | direct | vehicle_live_state | media_now_playing_title | VARCHAR | /media/latest | now_playing_title | useMediaLatest | MediaPlayerPage, Dashboard, MediaNowPlayingWidget | Text | 🟢 |
| 157 | MediaPlaybackSource | String | direct | vehicle_live_state | media_playback_source | VARCHAR | /media/latest | playback_source | useMediaLatest | MediaPlayerPage, Dashboard, MediaNowPlayingWidget | Icon + text (Spotify/BT/Radio) | 🟢 |
| 158 | MediaPlaybackStatus | Enum | direct (→ VARCHAR) | vehicle_live_state | media_playback_status | VARCHAR | /media/latest | playback_status | useMediaLatest | MediaPlayerPage, Dashboard, MediaNowPlayingWidget | Badge (Playing/Paused/Stopped) | 🟢 |

### 9 · Safety (14 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 159 | AutomaticBlindSpotCamera | Bool | ParseEnumBool | vehicle_live_state | automatic_blind_spot_camera | BOOLEAN | /safety/latest | automatic_blind_spot_camera | useSafety | SafetySettingsPage | Boolean (Enabled/Disabled) | 🟢 |
| 160 | AutomaticEmergencyBrakingOff | Bool | ParseEnumBool | vehicle_live_state | automatic_emergency_braking_off | BOOLEAN | /safety/latest | automatic_emergency_braking_off | useSafety | SafetySettingsPage | Boolean inverted (AEB status) | 🟢 |
| 161 | BlindSpotCollisionWarningChime | Bool | ParseEnumBool | vehicle_live_state | blind_spot_collision_warning_chime | BOOLEAN | /safety/latest | blind_spot_collision_warning_chime | useSafety | SafetySettingsPage | Boolean (Warning/No Warning) | 🟢 |
| 162 | CruiseFollowDistance | Enum | ParseCruiseFollowDistance (strip prefix) | vehicle_live_state | cruise_follow_distance | VARCHAR | /safety/latest | cruise_follow_distance | useSafety | SafetySettingsPage | String (1–7) | 🟢 |
| 163 | DriverSeatBelt | Enum | ParseBuckleStatus (→boolean) | vehicle_live_state | driver_seat_belt | BOOLEAN | /safety/latest | driver_seat_belt | useSafety | SafetySettingsPage | Boolean | 🟢 |
| 164 | EmergencyLaneDepartureAvoidance | Bool | ParseEnumBool | vehicle_live_state | emergency_lane_departure_avoidance | BOOLEAN | /safety/latest | emergency_lane_departure_avoidance | useSafety | SafetySettingsPage | Boolean | 🟢 |
| 165 | ForwardCollisionWarning | Enum | ParseForwardCollisionWarning (strip prefix) | vehicle_live_state | forward_collision_warning | VARCHAR | /safety/latest | forward_collision_warning | useSafety | SafetySettingsPage | String (Off/Late/Average/Early) | 🟢 |
| 166 | LaneDepartureAvoidance | Enum | ParseLaneDepartureAvoidance (strip prefix) | vehicle_live_state | lane_departure_avoidance | VARCHAR | /safety/latest | lane_departure_avoidance | useSafety | SafetySettingsPage | String (Off/Warning/Assist) | 🟢 |
| 167 | Locked | Bool | bool/string→bool | vehicle_live_state | locked | BOOLEAN | /vehicles/{id}/state, /security/latest | is_locked / locked | useVehicleState, useSecurityLatest | SecuritySection, SecurityStatusWidget, GuardModePage | 🔒/🔓 icon | 🟢 |
| 168 | MilesSinceReset | Float | direct | vehicle_live_state | miles_since_reset | FLOAT8 | /safety/latest | miles_since_reset | useSafety | SafetySettingsPage | Number formatted | 🟢 |
| 169 | PassengerSeatBelt | Enum | ParseBuckleStatus (→boolean) | vehicle_live_state | passenger_seat_belt | BOOLEAN | /safety/latest | passenger_seat_belt | useSafety | SafetySettingsPage | Boolean | 🟢 |
| 170 | PinToDriveEnabled | Bool | ParseEnumBool | vehicle_live_state | pin_to_drive_enabled | BOOLEAN | /safety/latest | pin_to_drive_enabled | useSafety | SafetySettingsPage | Boolean | 🟢 |
| 171 | SelfDrivingMilesSinceReset | Float | direct | vehicle_live_state | self_driving_miles_since_reset | FLOAT8 | /safety/latest | self_driving_miles_since_reset | useSafety | SafetySettingsPage | Number formatted | 🟢 |
| 172 | SpeedLimitWarning | Enum | ParseSpeedLimitWarning (strip prefix) | vehicle_live_state | speed_limit_warning | VARCHAR | /safety/latest | speed_limit_warning | useSafety | SafetySettingsPage | String (Off/Display/Chime) | 🟢 |

### 10 · TPMS (10 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 173 | TpmsHardWarnings | TireLocation | compound→JSON string | vehicle_live_state | tpms_hard_warnings | VARCHAR | /tire-pressure/latest | tpms_hard_warnings | useLatestTirePressure | TirePressurePage, TirePressureVisualWidget | Per-tire JSON parsed | 🟢 |
| 174 | TpmsLastSeenPressureTimeFl | Float | float→timestamptz | vehicle_live_state | tpms_last_seen_pressure_time_fl | TIMESTAMPTZ | /tire-pressure/latest | last_seen_time_fl | useLatestTirePressure | TirePressurePage | ISO timestamp formatted | 🟢 |
| 175 | TpmsLastSeenPressureTimeFr | Float | float→timestamptz | vehicle_live_state | tpms_last_seen_pressure_time_fr | TIMESTAMPTZ | /tire-pressure/latest | last_seen_time_fr | useLatestTirePressure | TirePressurePage | ISO timestamp formatted | 🟢 |
| 176 | TpmsLastSeenPressureTimeRl | Float | float→timestamptz | vehicle_live_state | tpms_last_seen_pressure_time_rl | TIMESTAMPTZ | /tire-pressure/latest | last_seen_time_rl | useLatestTirePressure | TirePressurePage | ISO timestamp formatted | 🟢 |
| 177 | TpmsLastSeenPressureTimeRr | Float | float→timestamptz | vehicle_live_state | tpms_last_seen_pressure_time_rr | TIMESTAMPTZ | /tire-pressure/latest | last_seen_time_rr | useLatestTirePressure | TirePressurePage | ISO timestamp formatted | 🟢 |
| 178 | TpmsPressureFl | Float | direct | vehicle_live_state | tire_pressure_fl | FLOAT8 | /tire-pressure/latest | front_left | useLatestTirePressure | TirePressurePage, TirePressureVisualWidget | Number (Bar) + gauge | 🟢 |
| 179 | TpmsPressureFr | Float | direct | vehicle_live_state | tire_pressure_fr | FLOAT8 | /tire-pressure/latest | front_right | useLatestTirePressure | TirePressurePage, TirePressureVisualWidget | Number (Bar) + gauge | 🟢 |
| 180 | TpmsPressureRl | Float | direct | vehicle_live_state | tire_pressure_rl | FLOAT8 | /tire-pressure/latest | rear_left | useLatestTirePressure | TirePressurePage, TirePressureVisualWidget | Number (Bar) + gauge | 🟢 |
| 181 | TpmsPressureRr | Float | direct | vehicle_live_state | tire_pressure_rr | FLOAT8 | /tire-pressure/latest | rear_right | useLatestTirePressure | TirePressurePage, TirePressureVisualWidget | Number (Bar) + gauge | 🟢 |
| 182 | TpmsSoftWarnings | TireLocation | compound→JSON string | vehicle_live_state | tpms_soft_warnings | VARCHAR | /tire-pressure/latest | tpms_soft_warnings | useLatestTirePressure | TirePressurePage, TirePressureVisualWidget | Per-tire JSON parsed | 🟢 |

### 11 · Vehicle State (29 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 183 | CenterDisplay | Enum | ParseCenterDisplay (strip prefix) | vehicle_live_state | center_display | VARCHAR | /security/latest | center_display | useSecurityLatest | SecurityPanel | String (Off/Dim/On/Driving) | 🟢 |
| 184 | CurrentLimitMph | Float | direct | vehicle_live_state | current_limit_mph | FLOAT8 | /security/latest | current_limit_mph | useSecurityLatest | SecurityPanel | `{value} mph` | 🟢 |
| 185 | DoorState | Doors | compound→JSON string | vehicle_live_state | door_state | VARCHAR | /security/latest | door_state | useSecurityLatest | SecuritySection, DoorWindowStatusWidget, SecurityPanel | Parsed JSON per-door | 🟢 |
| 186 | DriverSeatOccupied | Bool | ParseEnumBool | vehicle_live_state | driver_seat_occupied | BOOLEAN | /security/latest | driver_seat_occupied | useSecurityLatest | SecurityPanel | Boolean | 🟢 |
| 187 | FdWindow | Enum | ParseWindowState (strip prefix) | vehicle_live_state | fd_window | VARCHAR | /security/latest | fd_window | useSecurityLatest | SecuritySection, DoorWindowStatusWidget, SecurityPanel | String (Closed/Open/Partial) | 🟢 |
| 188 | FpWindow | Enum | ParseWindowState (strip prefix) | vehicle_live_state | fp_window | VARCHAR | /security/latest | fp_window | useSecurityLatest | SecuritySection, DoorWindowStatusWidget, SecurityPanel | String (Closed/Open/Partial) | 🟢 |
| 189 | GuestModeEnabled | Bool | ParseEnumBool | vehicle_live_state | guest_mode | BOOLEAN | /security/latest | guest_mode | useSecurityLatest | SecurityPanel | Boolean | 🟢 |
| 190 | GuestModeMobileAccessState | Enum | direct (→ VARCHAR) | vehicle_live_state | guest_mode_mobile_access | VARCHAR | /security/latest | guest_mode_mobile_access_state | useSecurityLatest | SecurityPanel | String | 🟢 |
| 191 | HomelinkDeviceCount | Float | direct | vehicle_live_state | homelink_device_count | INT | /security/latest | homelink_device_count | useSecurityLatest | SecurityPanel | Number | 🟢 |
| 192 | HomelinkNearby | Bool | ParseEnumBool | vehicle_live_state | homelink_nearby | BOOLEAN | /security/latest | homelink_nearby | useSecurityLatest | SecurityPanel | Boolean | 🟢 |
| 193 | LightsHazardsActive | Bool | ParseEnumBool | vehicle_live_state | lights_hazards_active | BOOLEAN | /security/latest | lights_hazards_active | useSecurityLatest | SecurityPanel | Boolean | 🟢 |
| 194 | LightsHighBeams | Bool | ParseEnumBool | vehicle_live_state | lights_high_beams | BOOLEAN | /security/latest | lights_high_beams | useSecurityLatest | SecurityPanel | Boolean | 🟢 |
| 195 | LightsTurnSignal | Enum | ParseTurnSignal (strip prefix) | vehicle_live_state | lights_turn_signal | VARCHAR | /security/latest | lights_turn_signal | useSecurityLatest | SecurityPanel | String (Off/Left/Right/Both) | 🟢 |
| 196 | Odometer | Float | direct | vehicle_live_state | odometer | FLOAT8 | /vehicles/{id}/state, /security/latest | odometer | useVehicleState, useSecurityLatest | OdometerCounterWidget, QuickStatsGrid, LiveStateIndicators | `fmtNumber(convertDistance())` km/mi | 🟢 |
| 197 | PairedPhoneKeyAndKeyFobQty | Float | direct | vehicle_live_state | paired_phone_key_count | INT | /security/latest | paired_phone_key_count | useSecurityLatest | SecurityPanel | Number | 🟢 |
| 198 | RdWindow | Enum | ParseWindowState (strip prefix) | vehicle_live_state | rd_window | VARCHAR | /security/latest | rd_window | useSecurityLatest | SecuritySection, DoorWindowStatusWidget, SecurityPanel | String (Closed/Open/Partial) | 🟢 |
| 199 | RpWindow | Enum | ParseWindowState (strip prefix) | vehicle_live_state | rp_window | VARCHAR | /security/latest | rp_window | useSecurityLatest | SecuritySection, DoorWindowStatusWidget, SecurityPanel | String (Closed/Open/Partial) | 🟢 |
| 200 | SentryMode | Enum | ParseEnumBool (→boolean) | vehicle_live_state | sentry_mode | BOOLEAN | /vehicles/{id}/state, /security/latest | sentry_mode | useVehicleState, useSecurityLatest | SecuritySection, SecurityStatusWidget, SentryEventLogWidget | 🛡️ icon + badge | 🟢 |
| 201 | ServiceMode | Bool | ParseEnumBool | vehicle_live_state | service_mode | BOOLEAN | /security/latest | service_mode | useSecurityLatest | SecurityPanel | Boolean | 🟢 |
| 202 | SpeedLimitMode | Bool | ParseEnumBool | vehicle_live_state | speed_limit_mode | BOOLEAN | /security/latest | speed_limit_mode | useSecurityLatest | SecurityPanel | Boolean | 🟢 |
| 203 | SoftwareUpdateDownloadPercentComplete | Float | direct | vehicle_live_state | sw_update_download_pct | INT | /vehicle-config/latest | software_update_download_pct | useVehicleConfigLatest | SoftwareUpdateStatusWidget | `{value}%` | 🟢 |
| 204 | SoftwareUpdateExpectedDurationMinutes | Float | direct | vehicle_live_state | sw_update_expected_duration | INT | /vehicle-config/latest | software_update_expected_duration | useVehicleConfigLatest | SoftwareUpdateStatusWidget | `{value} minutes` | 🟢 |
| 205 | SoftwareUpdateInstallationPercentComplete | Float | direct | vehicle_live_state | sw_update_install_pct | INT | /vehicle-config/latest | software_update_install_pct | useVehicleConfigLatest | SoftwareUpdateStatusWidget | `{value}%` | 🟢 |
| 206 | SoftwareUpdateScheduledStartTime | String | direct | vehicle_live_state | sw_update_scheduled_start | VARCHAR | /vehicle-config/latest | software_update_scheduled_start | useVehicleConfigLatest | SoftwareUpdateStatusWidget | ISO timestamp | 🟢 |
| 207 | SoftwareUpdateVersion | String | direct | vehicle_live_state | sw_update_version | VARCHAR | /vehicle-config/latest | software_update_version | useVehicleConfigLatest | SoftwareUpdateStatusWidget | String | 🟢 |
| 208 | TonneauOpenPercent | Float | direct | vehicle_live_state | tonneau_open_percent | FLOAT8 | /security/latest | tonneau_open_percent | useSecurityLatest | SecurityPanel | `{value}%` | 🟢 |
| 209 | TonneauPosition | Enum | ParseTonneauPosition (strip prefix) | vehicle_live_state | tonneau_position | VARCHAR | /security/latest | tonneau_position | useSecurityLatest | SecurityPanel | String | 🟢 |
| 210 | TonneauTentMode | Enum | ParseTonneauTentMode (strip prefix) | vehicle_live_state | tonneau_tent_mode | VARCHAR | /security/latest | tonneau_tent_mode | useSecurityLatest | SecurityPanel | String | 🟢 |
| 211 | ValetModeEnabled | Bool | ParseEnumBool | vehicle_live_state | valet_mode_enabled | BOOLEAN | /security/latest | valet_mode_enabled | useSecurityLatest | SecurityPanel, GuardModePage | Boolean | 🟢 |

### 12 · Vehicle Config (14 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 212 | CarType | Enum | direct (→ VARCHAR) | vehicle_live_state | car_type | VARCHAR | /vehicle-config/latest | car_type | useVehicleConfigLatest | VehicleConfigSection, DigitalTwinPage | String (Model S/3/X/Y) | 🟢 |
| 213 | EfficiencyPackage | String | direct | vehicle_live_state | efficiency_package | VARCHAR | /vehicle-config/latest | efficiency_package | useVehicleConfigLatest | VehicleConfigSection | String (e.g., "LFP") | 🟢 |
| 214 | EuropeVehicle | Bool | ParseEnumBool | vehicle_live_state | europe_vehicle | BOOLEAN | /vehicle-config/latest | europe_vehicle | useVehicleConfigLatest | — | — | ⚪ |
| 215 | ExteriorColor | String | direct | vehicle_live_state | exterior_color | VARCHAR | /vehicle-config/latest | exterior_color | useVehicleConfigLatest | VehicleConfigSection, DigitalTwinPage | String (color name) | 🟢 |
| 216 | OffroadLightbarPresent | Bool | ParseEnumBool | vehicle_live_state | offroad_lightbar_present | BOOLEAN | /vehicle-config/latest | offroad_lightbar_present | useVehicleConfigLatest | — | — | ⚪ |
| 217 | RearSeatHeaters | Float | direct (→ VARCHAR) | vehicle_live_state | rear_seat_heaters | VARCHAR | /vehicle-config/latest | rear_seat_heaters | useVehicleConfigLatest | — | — | ⚪ |
| 218 | RemoteStartEnabled | Bool | ParseEnumBool | vehicle_live_state | remote_start_enabled | BOOLEAN | /vehicle-config/latest | remote_start_enabled | useVehicleConfigLatest | — | — | ⚪ |
| 219 | RightHandDrive | Bool | ParseEnumBool | vehicle_live_state | right_hand_drive | BOOLEAN | /vehicle-config/latest | right_hand_drive | useVehicleConfigLatest | VehicleConfigSection | Boolean (Yes/No) | 🟢 |
| 220 | RoofColor | String | direct | vehicle_live_state | roof_color | VARCHAR | /vehicle-config/latest | roof_color | useVehicleConfigLatest | VehicleConfigSection | String | 🟢 |
| 221 | SunroofInstalled | Enum | direct (→ VARCHAR) | vehicle_live_state | sunroof_installed | VARCHAR | /vehicle-config/latest | sunroof_installed | useVehicleConfigLatest | — | — | ⚪ |
| 222 | Trim | String | direct | vehicle_live_state | trim | VARCHAR | /vehicle-config/latest | trim | useVehicleConfigLatest | VehicleConfigSection, DigitalTwinPage | String | 🟢 |
| 223 | VehicleName | String | direct | vehicle_live_state | vehicle_name | VARCHAR | /vehicle-config/latest | vehicle_name | useVehicleConfigLatest | VehicleConfigSection, DigitalTwinPage | String | 🟢 |
| 224 | Version | String | direct | vehicle_live_state | version | VARCHAR | /vehicles/{id}/state, /vehicle-config/latest | software_version / version | useVehicleState, useVehicleConfigLatest | VehicleConfigSection, Dashboard | String | 🟢 |
| 225 | WheelType | String | direct | vehicle_live_state | wheel_type | VARCHAR | /vehicle-config/latest | wheel_type | useVehicleConfigLatest | VehicleConfigSection, DigitalTwinPage | String | 🟢 |

### 13 · User Preferences (5 signals)

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|-----------|---------------|--------|
| 226 | Setting24HourTime | Bool | ParseEnumBool (→ VARCHAR) | vehicle_live_state | setting24_hour_time | VARCHAR | /user-preferences/latest | setting_24hr_time | useUserPreferenceLatest | — | — | ⚪ |
| 227 | SettingChargeUnit | Enum | direct (→ VARCHAR) | vehicle_live_state | setting_charge_unit | VARCHAR | /user-preferences/latest | setting_charge_unit | useCarPreferences, useUserPreferenceLatest | Settings page | String (mi/km/%) | 🟢 |
| 228 | SettingDistanceUnit | Enum | direct (→ VARCHAR) | vehicle_live_state | setting_distance_unit | VARCHAR | /user-preferences/latest | setting_distance_unit | useCarPreferences, useUserPreferenceLatest | Settings page | String (mi/hr, km/hr) | 🟢 |
| 229 | SettingTemperatureUnit | Enum | direct (→ VARCHAR) | vehicle_live_state | setting_temperature_unit | VARCHAR | /user-preferences/latest | setting_temperature_unit | useCarPreferences, useUserPreferenceLatest | Settings page | String (F/C) | 🟢 |
| 230 | SettingTirePressureUnit | Enum | direct (→ VARCHAR) | vehicle_live_state | setting_tire_pressure_unit | VARCHAR | /user-preferences/latest | setting_tire_pressure_unit | useCarPreferences, useUserPreferenceLatest | Settings page, TirePressurePage | String (Bar/Psi) | 🟢 |

---

## Critical Mismatches (Action Required)

### 🔴 1. ChargePort — Not served by any API endpoint

- **Signal**: `ChargePort` (Enum)
- **What's wrong**: Stored in `vehicle_live_state.charge_port` but not included in any domain snapshot handler or API response
- **Root cause**: The ChargePort enum (Open/Closed) is stored in live state but no snapshot handler reads this column. Frontend uses `charge_port_door_open` boolean instead.
- **Suggested fix**: Add `charge_port` to the ChargingTelemetry handler response, or document as intentionally excluded (superseded by `ChargePortDoorOpen` boolean)
- **Files to change**: `internal/database/charging_telemetry_repo.go`, `web/src/api/types.ts`

### 🔴 2. DiAxleSpeedR — Missing from MotorSnapshot TypeScript type

- **Signal**: `DiAxleSpeedR` (Float)
- **What's wrong**: Stored in `vehicle_live_state.di_axle_speed_r` and in `motor_snapshots` DB table, but the frontend `MotorSnapshot` TypeScript interface in `web/src/api/types.ts` does not include `di_axle_speed_r`
- **Root cause**: When the MotorSnapshot type was created, only the front (F) and REL/RER variants were included; the plain rear (R) variant was omitted
- **Suggested fix**: Add `di_axle_speed_r?: number` to `MotorSnapshot` interface
- **Files to change**: `web/src/api/types.ts` (MotorSnapshot interface)

### 🔴 3. DiAxleSpeedRER — Missing from MotorSnapshot TypeScript type

- **Signal**: `DiAxleSpeedRER` (Float)
- **What's wrong**: Same issue as DiAxleSpeedR — stored in DB but missing from frontend type
- **Root cause**: Omitted during type definition
- **Suggested fix**: Add `di_axle_speed_rer?: number` to `MotorSnapshot` interface
- **Files to change**: `web/src/api/types.ts` (MotorSnapshot interface)

### 🔴 4. DiStateR / DiStatorTempR — Missing from MotorSnapshot TypeScript type

- **Signal**: `DiStateR` (Enum), `DiStatorTempR` (Float)
- **What's wrong**: Both stored in `vehicle_live_state` (`di_state_r`, `di_stator_temp_r`) and served by `/motor/latest`, but the MotorSnapshot TypeScript interface uses `di_state` (generic) for front motor only, and lacks `di_state_r` and `di_stator_temp_r` fields
- **Root cause**: The MotorSnapshot type was built for single/front motor display; rear motor base variants were not added
- **Suggested fix**: Add `di_state_r?: string` and `di_stator_temp_r?: number` to `MotorSnapshot` interface
- **Files to change**: `web/src/api/types.ts` (MotorSnapshot interface)

---

## Orphaned Signals

Signals that are ingested into the database and stored in `vehicle_live_state` but **not displayed on any dedicated frontend page**. All 81 orphaned signals are still accessible via the raw signal viewer (`/signals/{vehicleID}/live`) and signal history (`/signals/history`).

### Charging — 28 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| BmsFullchargecomplete | vehicle_live_state, charging_telemetry | Add to BatteryHealthPage — useful for cycle counting |
| ChargeCurrentRequest | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage advanced section |
| ChargeCurrentRequestMax | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage advanced section |
| ChargeEnableRequest | vehicle_live_state, charging_telemetry | Low priority — internal BMS flag |
| ChargePortColdWeatherMode | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage — cold weather indication |
| ChargePortLatch | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage — safety indicator |
| ChargingCableType | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage — useful cable info |
| DCDCEnable | vehicle_live_state, charging_telemetry | Low priority — DC-DC converter status |
| DetailedChargeState | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage — more granular than ChargeState |
| EstBatteryRange | vehicle_live_state, charging_telemetry | Add to range display alongside rated_range |
| EstimatedHoursToChargeTermination | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage — complements TimeToFullCharge |
| ExpectedEnergyPercentAtTripArrival | vehicle_live_state, charging_telemetry | Add to NavigationRoutePage — trip planning |
| FastChargerPresent | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage badge |
| FastChargerType | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage — charger brand info |
| IdealBatteryRange | vehicle_live_state | Used internally for range fallback only |
| LifetimeEnergyUsed | vehicle_live_state, charging_telemetry | Add to EnergyStatsPage — lifetime metric |
| ModuleTempMax | vehicle_live_state, charging_telemetry | Add to BatteryHealthPage — thermal monitoring |
| ModuleTempMin | vehicle_live_state, charging_telemetry | Add to BatteryHealthPage — thermal monitoring |
| NotEnoughPowerToHeat | vehicle_live_state, charging_telemetry | Add to ClimateControlPage — alert indicator |
| NumBrickVoltageMax | vehicle_live_state, charging_telemetry | Low priority — cell balance diagnostic |
| NumBrickVoltageMin | vehicle_live_state, charging_telemetry | Low priority — cell balance diagnostic |
| NumModuleTempMax | vehicle_live_state, charging_telemetry | Low priority — module temp diagnostic |
| NumModuleTempMin | vehicle_live_state, charging_telemetry | Low priority — module temp diagnostic |
| PreconditioningEnabled | vehicle_live_state, charging_telemetry | Add to ChargingDetailPage or ClimateControlPage |
| RatedRange | vehicle_live_state | Used internally for range fallback only |
| SuperchargerSessionTripPlanner | vehicle_live_state, charging_telemetry | Low priority — trip planner integration flag |

### Powershare — 5 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| PowershareHoursLeft | vehicle_live_state, charging_telemetry | Create PowersharePage — all 5 signals together |
| PowershareInstantaneousPowerKW | vehicle_live_state, charging_telemetry | Create PowersharePage |
| PowershareStatus | vehicle_live_state, charging_telemetry | Create PowersharePage |
| PowershareStopReason | vehicle_live_state, charging_telemetry | Create PowersharePage |
| PowershareType | vehicle_live_state, charging_telemetry | Create PowersharePage |

### Climate — 10 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| AutoSeatClimateLeft | vehicle_live_state, climate_snapshots | Add to ClimateControlPage seat section |
| AutoSeatClimateRight | vehicle_live_state, climate_snapshots | Add to ClimateControlPage seat section |
| CabinOverheatProtectionTemperatureLimit | vehicle_live_state, climate_snapshots | Add alongside CabinOverheatProtectionMode |
| ClimateSeatCoolingFrontLeft | vehicle_live_state, climate_snapshots | Add to ClimateControlPage seat section |
| ClimateSeatCoolingFrontRight | vehicle_live_state, climate_snapshots | Add to ClimateControlPage seat section |
| DefrostForPreconditioning | vehicle_live_state, climate_snapshots | Low priority — preconditioning detail |
| HvacFanStatus | vehicle_live_state, climate_snapshots | Low priority — raw status code |
| HvacSteeringWheelHeatAuto | vehicle_live_state, climate_snapshots | Add to ClimateControlPage steering wheel section |
| HvacSteeringWheelHeatLevel | vehicle_live_state, climate_snapshots | Add to ClimateControlPage steering wheel section |
| RearDefrostEnabled | vehicle_live_state, climate_snapshots | Add to ClimateControlPage defrost section |
| RearDisplayHvacEnabled | vehicle_live_state, climate_snapshots | Add to ClimateControlPage rear section |
| SeatVentEnabled | vehicle_live_state, climate_snapshots | Add to ClimateControlPage seat section |
| WiperHeatEnabled | vehicle_live_state, climate_snapshots | Add to ClimateControlPage defrost section |

### Driving — 4 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| BrakePedalPos | vehicle_live_state, motor_snapshots | Add to DrivingDynamicsPage pedal display |
| CruiseSetSpeed | vehicle_live_state, motor_snapshots | Add to DrivingDynamicsPage — autopilot section |
| DriveRail | vehicle_live_state, motor_snapshots | Low priority — internal HV bus signal |
| LifetimeEnergyGainedRegen | vehicle_live_state, motor_snapshots | Add to EnergyStatsPage — regen efficiency |
| LifetimeEnergyUsedDrive | vehicle_live_state, motor_snapshots | Add to EnergyStatsPage — drive energy |

### Powertrain — 30 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| DiAxleSpeedF | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage motor detail |
| DiAxleSpeedREL | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage motor detail |
| DiHeatsinkTF/TR/TREL/TRER | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage thermal section |
| DiInverterTF/TR/TREL/TRER | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage thermal section |
| DiMotorCurrentF/R/REL/RER | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage load section |
| DiSlaveTorqueCmd | vehicle_live_state, motor_snapshots | Low priority — torque command detail |
| DiStateF/REL/RER | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage motor status |
| DiStatorTempF/REL/RER | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage thermal |
| DiTorqueActualF/R/REL/RER | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage torque section |
| DiVBatF/R/REL/RER | vehicle_live_state, motor_snapshots | Add to DrivetrainHealthPage voltage section |
| IsolationResistance | vehicle_live_state | Add to DrivetrainHealthPage — HV safety metric |

### Location — 2 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| GpsState | vehicle_live_state, location_snapshots | Add to NavigationRoutePage — GPS fix quality |
| RouteLastUpdated | vehicle_live_state, location_snapshots | Add to NavigationRoutePage — data freshness |

### Media — 1 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| MediaAudioVolumeIncrement | vehicle_live_state, media_snapshots | Low priority — volume step size |

### Vehicle Config — 5 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| EuropeVehicle | vehicle_live_state | Low priority — static config flag |
| OffroadLightbarPresent | vehicle_live_state | Low priority — Cybertruck-specific |
| RearSeatHeaters | vehicle_live_state | Add to VehicleConfigSection — feature indicator |
| RemoteStartEnabled | vehicle_live_state | Add to SecurityPanel — access status |
| SunroofInstalled | vehicle_live_state | Low priority — static config flag |

### User Preferences — 1 orphaned

| Signal | Where Stored | Recommendation |
|--------|-------------|----------------|
| Setting24HourTime | vehicle_live_state | Add to Settings page — time format preference |

---

## Data Flow Architecture

```
Tesla Vehicle ──▶ Fleet Telemetry Server ──▶ TeslaSync Telemetry Handler
                                                      │
                                            ┌─────────┤─────────────┐
                                            ▼         ▼             ▼
                                      SignalStore   normalizeFleetUnits   signal_history
                                      (in-memory)    (coercion)          (Postgres)
                                            │         │
                                            ▼         ▼
                                      FlushLiveState ──▶ vehicle_live_state (Postgres)
                                            │
                                ┌───────────┼───────────────────────────┐
                                ▼           ▼           ▼               ▼
                         Domain Snapshot  Domain Snapshot  ...    BuildStateFromSignalStore
                         Writers          Repos                   (20 core signals)
                                ▼           ▼                          ▼
                         climate_snapshots  motor_snapshots     VehicleState JSON
                         security_events    charging_telemetry        │
                         tire_pressure_*    media_snapshots           ▼
                         safety_snapshots   location_snapshots   /vehicles/{id}/state
                         vehicle_config_*   user_preference_*         │
                                ▼                                     ▼
                         /climate/latest    /motor/latest       React Frontend
                         /security/latest   /charging-telemetry/latest
                         /tire-pressure/latest  /media/latest
                         /safety/latest     /vehicle-config/latest
                         /location-snapshots/latest
                         /user-preferences/latest
                                ▼
                         React Frontend (TanStack Query hooks)
                                ▼
                         UI Pages (shared components)
```

---

## Notes

1. **All 230 signals** are stored in `vehicle_live_state` via `signalToColumn` mapping — this is the single source of truth for current vehicle state
2. **Domain snapshot tables** (climate_snapshots, motor_snapshots, etc.) duplicate data for historical querying — the `*_snapshots` tables are populated by periodic snapshot writers
3. **Signal History** (`signal_history` table) stores every signal value change with timestamp — accessible via `/signals/history` endpoint
4. **Raw Signal Viewer** (`/signals/{vehicleID}/live`) provides real-time access to all signals from the in-memory SignalStore
5. **Orphaned signals** are "orphaned" only from dedicated UI pages — they remain accessible via raw signal viewer and signal history
6. **ACChargingPower** and **DCChargingPower** both map to `charger_power` column; DC takes priority when both present
7. **ScheduledChargingPending** is classified as Bool in SignalRegistry despite being in the "Charging (enums)" audit category
8. **Compound types** (Location, DoorState, TpmsWarnings, ScheduledChargingStartTime) undergo structural transformation before storage

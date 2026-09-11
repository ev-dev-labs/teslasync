/**
 * Curated Alert Studio rule templates.
 *
 * Thresholds follow the same display-unit convention as the original
 * catalogue (percent SOC, km/h labels, bar tire pressure, kW charging)
 * so cloned rules stay consistent with existing user rules.
 */
import type { ElementType } from 'react'
import type { AlertRuleInput } from '@/api/hooks/useNotifications'
import { Icons } from '@/lib/icons'

type Severity = NonNullable<AlertRuleInput['severity']>
type RuleOp = NonNullable<AlertRuleInput['op']>

export interface RuleTemplate {
  name: string
  icon: ElementType
  category: string
  severity: Severity
  message: string
  cooldown_min: number
  signal_name: string
  op: RuleOp
  value_num?: number
  value_text?: string
  value_bool?: boolean
  value_min?: number
  value_max?: number
}

export const ruleTemplates: RuleTemplate[] = [
  // ── Battery (original) ──────────────────────────────────────────
  { name: 'Battery Low (< 20%)', icon: Icons.battery, category: 'Battery', severity: 'warn', message: 'Battery at {{BatteryLevel}}%', cooldown_min: 30, signal_name: 'BatteryLevel', op: '<', value_num: 20 },
  { name: 'Battery Critical (< 10%)', icon: Icons.battery, category: 'Battery', severity: 'critical', message: 'Battery critically low at {{BatteryLevel}}%!', cooldown_min: 15, signal_name: 'BatteryLevel', op: '<', value_num: 10 },
  { name: 'Battery Full (>= 90%)', icon: Icons.battery, category: 'Battery', severity: 'info', message: 'Battery reached {{BatteryLevel}}%', cooldown_min: 60, signal_name: 'BatteryLevel', op: '>=', value_num: 90 },
  { name: 'Charge Limit Reached', icon: Icons.battery, category: 'Battery', severity: 'info', message: 'Battery at charge limit {{ChargeLimitSoc}}%', cooldown_min: 60, signal_name: 'BatteryLevel', op: '>=', value_num: 80 },
  { name: 'Range Below 50 km', icon: Icons.battery, category: 'Battery', severity: 'warn', message: 'Range low: {{RatedRange}} km remaining', cooldown_min: 30, signal_name: 'RatedRange', op: '<', value_num: 50 },

  // ── Charging (original) ─────────────────────────────────────────
  { name: 'Charge Complete', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charging complete at {{BatteryLevel}}%', cooldown_min: 60, signal_name: 'ChargeState', op: '=', value_text: 'Complete' },
  { name: 'Charging Started', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charging started - {{DetailedChargeState}}', cooldown_min: 15, signal_name: 'DetailedChargeState', op: '=', value_text: 'Charging' },
  { name: 'Charging Stopped Unexpectedly', icon: Icons.charging, category: 'Charging', severity: 'warn', message: 'Charging stopped - {{DetailedChargeState}}', cooldown_min: 30, signal_name: 'DetailedChargeState', op: '=', value_text: 'Stopped' },
  { name: 'Supercharging (DC Fast)', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Supercharging at {{DCChargingPower}} kW', cooldown_min: 30, signal_name: 'DCChargingPower', op: '>', value_num: 50 },
  { name: 'Slow Charge Rate', icon: Icons.charging, category: 'Charging', severity: 'warn', message: 'Charging slow: {{ChargeAmps}}A', cooldown_min: 60, signal_name: 'ChargeAmps', op: 'between', value_min: 0.01, value_max: 5 },

  // ── Driving (original) ──────────────────────────────────────────
  { name: 'Drive Started', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Drive started - gear is {{Gear}}', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'D' },
  { name: 'Drive Ended', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Drive ended - gear is {{Gear}}', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'P' },
  { name: 'Speed Limit Exceeded', icon: Icons.speed, category: 'Driving', severity: 'warn', message: 'Speed {{VehicleSpeed}} km/h exceeded limit', cooldown_min: 15, signal_name: 'VehicleSpeed', op: '>', value_num: 120 },
  { name: 'High Speed Alert (> 160 km/h)', icon: Icons.speed, category: 'Driving', severity: 'critical', message: 'Very high speed: {{VehicleSpeed}} km/h!', cooldown_min: 5, signal_name: 'VehicleSpeed', op: '>', value_num: 160 },
  { name: 'Reverse Gear Engaged', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Vehicle in reverse', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'R' },
  { name: 'Odometer Milestone (100k km)', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Odometer: {{Odometer}} km', cooldown_min: 1440, signal_name: 'Odometer', op: '>', value_num: 100000 },

  // ── Security (original) ─────────────────────────────────────────
  { name: 'Car Unlocked While Parked', icon: Icons.locked, category: 'Security', severity: 'critical', message: 'Vehicle is unlocked and parked!', cooldown_min: 30, signal_name: 'Locked', op: '=', value_bool: false },
  { name: 'Vehicle Locked', icon: Icons.locked, category: 'Security', severity: 'info', message: 'Vehicle locked', cooldown_min: 5, signal_name: 'Locked', op: '=', value_bool: true },
  { name: 'Vehicle Unlocked', icon: Icons.locked, category: 'Security', severity: 'info', message: 'Vehicle unlocked', cooldown_min: 5, signal_name: 'Locked', op: '=', value_bool: false },
  { name: 'Sentry Mode Activated', icon: Icons.security, category: 'Security', severity: 'info', message: 'Sentry mode activated', cooldown_min: 30, signal_name: 'SentryMode', op: '=', value_bool: true },
  { name: 'Door Opened While Parked', icon: Icons.locked, category: 'Security', severity: 'warn', message: 'Door opened - {{DoorState}}', cooldown_min: 15, signal_name: 'DoorState', op: '!=', value_text: 'Closed' },
  { name: 'Window Left Open', icon: Icons.vehicle, category: 'Security', severity: 'warn', message: 'Front driver window is {{FdWindow}}', cooldown_min: 60, signal_name: 'FdWindow', op: '!=', value_text: 'Closed' },
  { name: 'Valet Mode Enabled', icon: Icons.security, category: 'Security', severity: 'info', message: 'Valet mode enabled', cooldown_min: 60, signal_name: 'ValetModeEnabled', op: '=', value_bool: true },
  { name: 'Guest Mode Enabled', icon: Icons.security, category: 'Security', severity: 'warn', message: 'Guest mode enabled', cooldown_min: 60, signal_name: 'GuestModeEnabled', op: '=', value_bool: true },

  // ── Climate (original) ──────────────────────────────────────────
  { name: 'Cabin Overheat (> 40C)', icon: Icons.climate, category: 'Climate', severity: 'warn', message: 'Cabin temp: {{InsideTemp}}C', cooldown_min: 30, signal_name: 'InsideTemp', op: '>', value_num: 40 },
  { name: 'Cabin Freezing (< 0C)', icon: Icons.climate, category: 'Climate', severity: 'warn', message: 'Cabin temp: {{InsideTemp}}C - freezing!', cooldown_min: 60, signal_name: 'InsideTemp', op: '<', value_num: 0 },
  { name: 'HVAC Left On While Parked', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'HVAC running while parked', cooldown_min: 30, signal_name: 'HvacPower', op: '=', value_bool: true },
  { name: 'Climate Keeper Active', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Climate keeper: {{ClimateKeeperMode}}', cooldown_min: 60, signal_name: 'ClimateKeeperMode', op: '!=', value_text: 'Off' },
  { name: 'Steering Wheel Heater On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Steering wheel heater level {{HvacSteeringWheelHeatLevel}}', cooldown_min: 30, signal_name: 'HvacSteeringWheelHeatLevel', op: '>', value_num: 0 },

  // ── Tire Pressure (original) ────────────────────────────────────
  { name: 'Tire Pressure Low', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'Low tire pressure detected', cooldown_min: 60, signal_name: 'TpmsHardWarnings', op: '=', value_bool: true },
  { name: 'Tire Pressure Soft Warning', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'Tire pressure slightly low', cooldown_min: 120, signal_name: 'TpmsSoftWarnings', op: '=', value_bool: true },
  { name: 'Front Left Tire Low (< 2.2 bar)', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'FL tire: {{TpmsPressureFl}} bar', cooldown_min: 60, signal_name: 'TpmsPressureFl', op: '<', value_num: 2.2 },

  // ── Location (original) ─────────────────────────────────────────
  { name: 'Arrived at Home', icon: Icons.vehicle, category: 'Location', severity: 'info', message: 'Vehicle arrived at home', cooldown_min: 15, signal_name: 'LocatedAtHome', op: '=', value_bool: true },
  { name: 'Left Home', icon: Icons.vehicle, category: 'Location', severity: 'info', message: 'Vehicle left home', cooldown_min: 15, signal_name: 'LocatedAtHome', op: '=', value_bool: false },
  { name: 'Arrived at Work', icon: Icons.vehicle, category: 'Location', severity: 'info', message: 'Vehicle arrived at work', cooldown_min: 15, signal_name: 'LocatedAtWork', op: '=', value_bool: true },
  { name: 'Navigation Started', icon: Icons.vehicle, category: 'Location', severity: 'info', message: 'Navigating to {{DestinationName}}', cooldown_min: 10, signal_name: 'DestinationName', op: 'changed' },

  // ── Safety (original) ───────────────────────────────────────────
  { name: 'Driver Seatbelt Unbuckled', icon: Icons.security, category: 'Safety', severity: 'warn', message: 'Driver seatbelt unbuckled while driving!', cooldown_min: 5, signal_name: 'DriverSeatBelt', op: '=', value_bool: false },
  { name: 'Speed Limit Mode Active', icon: Icons.security, category: 'Safety', severity: 'info', message: 'Speed limit mode active', cooldown_min: 60, signal_name: 'SpeedLimitMode', op: '=', value_bool: true },
  { name: 'PIN to Drive Disabled', icon: Icons.security, category: 'Safety', severity: 'warn', message: 'PIN to Drive has been disabled', cooldown_min: 1440, signal_name: 'PinToDriveEnabled', op: '=', value_bool: false },

  // ── Motor (original) ────────────────────────────────────────────
  { name: 'High Motor Temperature (> 80C)', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'Motor stator temp: {{DiStatorTempF}}C', cooldown_min: 15, signal_name: 'DiStatorTempF', op: '>', value_num: 80 },
  { name: 'HVIL Fault', icon: Icons.security, category: 'Motor', severity: 'critical', message: 'HV interlock fault detected!', cooldown_min: 5, signal_name: 'Hvil', op: '=', value_text: 'Fault' },
  { name: 'High Regenerative Braking', icon: Icons.charging, category: 'Motor', severity: 'info', message: 'Regen power: {{Power}} kW', cooldown_min: 15, signal_name: 'Power', op: '<', value_num: -50 },

  // ── Software (original) ─────────────────────────────────────────
  { name: 'Software Update Available', icon: Icons.charging, category: 'Software', severity: 'info', message: 'Update available: {{SoftwareUpdateVersion}}', cooldown_min: 1440, signal_name: 'SoftwareUpdateVersion', op: 'changed' },
  { name: 'Software Update Installing', icon: Icons.charging, category: 'Software', severity: 'info', message: 'Installing update: {{SoftwareUpdateInstallationPercentComplete}}%', cooldown_min: 30, signal_name: 'SoftwareUpdateInstallationPercentComplete', op: '>', value_num: 0 },

  // ── Media (original) ────────────────────────────────────────────
  { name: 'Music Playing', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Now playing: {{MediaNowPlayingTitle}} by {{MediaNowPlayingArtist}}', cooldown_min: 60, signal_name: 'MediaPlaybackStatus', op: '=', value_text: 'Playing' },
  { name: 'Volume Too High', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Volume at {{MediaAudioVolume}}', cooldown_min: 30, signal_name: 'MediaAudioVolume', op: '>', value_num: 8 },

  // ── Powershare (original) ───────────────────────────────────────
  { name: 'Powershare Active', icon: Icons.charging, category: 'Powershare', severity: 'info', message: 'Powershare active: {{PowershareInstantaneousPowerKW}} kW', cooldown_min: 60, signal_name: 'PowershareStatus', op: 'changed' },

  // ── Battery (new) ───────────────────────────────────────────────
  { name: 'Battery Low (< 30%)', icon: Icons.battery, category: 'Battery', severity: 'info', message: 'Battery dropped to {{BatteryLevel}}%', cooldown_min: 60, signal_name: 'BatteryLevel', op: '<', value_num: 30 },
  { name: 'Battery Very Low (< 5%)', icon: Icons.battery, category: 'Battery', severity: 'critical', message: 'Battery almost empty: {{BatteryLevel}}%', cooldown_min: 10, signal_name: 'BatteryLevel', op: '<', value_num: 5 },
  { name: 'SOC Below 15%', icon: Icons.battery, category: 'Battery', severity: 'warn', message: 'SOC {{Soc}}% — charge soon', cooldown_min: 30, signal_name: 'Soc', op: '<', value_num: 15 },
  { name: 'Energy Remaining Low', icon: Icons.battery, category: 'Battery', severity: 'warn', message: 'Energy remaining: {{EnergyRemaining}}', cooldown_min: 30, signal_name: 'EnergyRemaining', op: '<', value_num: 8 },
  { name: 'Battery Heater On', icon: Icons.climate, category: 'Battery', severity: 'info', message: 'Battery heater is on', cooldown_min: 60, signal_name: 'BatteryHeaterOn', op: '=', value_bool: true },
  { name: 'BMS Full Charge Complete', icon: Icons.battery, category: 'Battery', severity: 'info', message: 'BMS reports full charge complete', cooldown_min: 120, signal_name: 'BmsFullchargecomplete', op: '=', value_bool: true },
  { name: 'Pack Voltage Low', icon: Icons.battery, category: 'Battery', severity: 'warn', message: 'Pack voltage {{PackVoltage}} V', cooldown_min: 30, signal_name: 'PackVoltage', op: '<', value_num: 320 },
  { name: 'Estimated Range Below 80 km', icon: Icons.battery, category: 'Battery', severity: 'warn', message: 'Estimated range {{EstBatteryRange}}', cooldown_min: 30, signal_name: 'EstBatteryRange', op: '<', value_num: 80 },
  { name: 'Ideal Range Below 100 km', icon: Icons.battery, category: 'Battery', severity: 'info', message: 'Ideal range {{IdealBatteryRange}}', cooldown_min: 60, signal_name: 'IdealBatteryRange', op: '<', value_num: 100 },
  { name: 'Charge Limit Changed', icon: Icons.battery, category: 'Battery', severity: 'info', message: 'Charge limit is now {{ChargeLimitSoc}}%', cooldown_min: 60, signal_name: 'ChargeLimitSoc', op: 'changed' },
  { name: 'Module Temp High (> 45C)', icon: Icons.climate, category: 'Battery', severity: 'warn', message: 'Module max temp {{ModuleTempMax}}C', cooldown_min: 20, signal_name: 'ModuleTempMax', op: '>', value_num: 45 },
  { name: 'Module Temp Low (< 5C)', icon: Icons.climate, category: 'Battery', severity: 'info', message: 'Module min temp {{ModuleTempMin}}C — pack is cold', cooldown_min: 60, signal_name: 'ModuleTempMin', op: '<', value_num: 5 },

  // ── Charging (new) ──────────────────────────────────────────────
  { name: 'Charge Port Door Open', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charge port door is open', cooldown_min: 30, signal_name: 'ChargePortDoorOpen', op: '=', value_bool: true },
  { name: 'Charge Port Latched', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charge port latch: {{ChargePortLatch}}', cooldown_min: 15, signal_name: 'ChargePortLatch', op: 'changed' },
  { name: 'Fast Charger Present', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'DC fast charger detected ({{FastChargerType}})', cooldown_min: 30, signal_name: 'FastChargerPresent', op: '=', value_bool: true },
  { name: 'AC Charging Power High', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'AC charging at {{ACChargingPower}}', cooldown_min: 30, signal_name: 'ACChargingPower', op: '>', value_num: 10 },
  { name: 'Long Time to Full (> 8h)', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Time to full charge: {{TimeToFullCharge}} h', cooldown_min: 120, signal_name: 'TimeToFullCharge', op: '>', value_num: 8 },
  { name: 'Scheduled Charging Pending', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Scheduled charging is pending', cooldown_min: 120, signal_name: 'ScheduledChargingPending', op: '=', value_bool: true },
  { name: 'Scheduled Charging Mode Changed', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Scheduled charging mode: {{ScheduledChargingMode}}', cooldown_min: 60, signal_name: 'ScheduledChargingMode', op: 'changed' },
  { name: 'Charging Cable Changed', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Cable type: {{ChargingCableType}}', cooldown_min: 30, signal_name: 'ChargingCableType', op: 'changed' },
  { name: 'Charge Current Request Maxed', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Requested {{ChargeCurrentRequest}}A of {{ChargeCurrentRequestMax}}A max', cooldown_min: 60, signal_name: 'ChargeCurrentRequest', op: 'changed' },
  { name: 'Charger Voltage Present', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charger voltage {{ChargerVoltage}} V', cooldown_min: 30, signal_name: 'ChargerVoltage', op: '>', value_num: 100 },
  { name: 'Three-Phase Charging', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charger phases: {{ChargerPhases}}', cooldown_min: 60, signal_name: 'ChargerPhases', op: '>=', value_num: 3 },
  { name: 'Charge Port Cold Weather Mode', icon: Icons.climate, category: 'Charging', severity: 'info', message: 'Charge port cold-weather mode on', cooldown_min: 120, signal_name: 'ChargePortColdWeatherMode', op: '=', value_bool: true },
  { name: 'Supercharger Trip Planner', icon: Icons.navigation, category: 'Charging', severity: 'info', message: 'Supercharger session trip planner updated', cooldown_min: 15, signal_name: 'SuperchargerSessionTripPlanner', op: 'changed' },
  { name: 'Hours to Charge Termination', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Estimated hours to end: {{EstimatedHoursToChargeTermination}}', cooldown_min: 60, signal_name: 'EstimatedHoursToChargeTermination', op: '>', value_num: 4 },
  { name: 'Charge Enable Request Off', icon: Icons.charging, category: 'Charging', severity: 'warn', message: 'Charge enable request is off', cooldown_min: 30, signal_name: 'ChargeEnableRequest', op: '=', value_bool: false },

  // ── Driving (new) ───────────────────────────────────────────────
  { name: 'Neutral Gear', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Vehicle in neutral', cooldown_min: 10, signal_name: 'Gear', op: '=', value_text: 'N' },
  { name: 'Hard Acceleration', icon: Icons.speed, category: 'Driving', severity: 'info', message: 'Pedal {{PedalPosition}}%', cooldown_min: 15, signal_name: 'PedalPosition', op: '>', value_num: 80 },
  { name: 'Hard Braking', icon: Icons.speed, category: 'Driving', severity: 'warn', message: 'Brake pedal position {{BrakePedalPos}}', cooldown_min: 10, signal_name: 'BrakePedalPos', op: '>', value_num: 80 },
  { name: 'Brake Pedal Pressed', icon: Icons.speed, category: 'Driving', severity: 'info', message: 'Brake pedal is pressed', cooldown_min: 15, signal_name: 'BrakePedal', op: '=', value_bool: true },
  { name: 'High Longitudinal Accel', icon: Icons.speed, category: 'Driving', severity: 'info', message: 'Longitudinal accel {{LongitudinalAcceleration}}', cooldown_min: 15, signal_name: 'LongitudinalAcceleration', op: '>', value_num: 4 },
  { name: 'High Lateral Accel', icon: Icons.speed, category: 'Driving', severity: 'warn', message: 'Lateral accel {{LateralAcceleration}} — cornering hard', cooldown_min: 15, signal_name: 'LateralAcceleration', op: '>', value_num: 5 },
  { name: 'Cruise Set Speed High', icon: Icons.speed, category: 'Driving', severity: 'info', message: 'Cruise set to {{CruiseSetSpeed}}', cooldown_min: 30, signal_name: 'CruiseSetSpeed', op: '>', value_num: 120 },
  { name: 'Speed Current Limit', icon: Icons.speed, category: 'Driving', severity: 'info', message: 'Current limit {{CurrentLimitMph}}', cooldown_min: 60, signal_name: 'CurrentLimitMph', op: 'changed' },
  { name: 'Drive Rail On', icon: Icons.bolt, category: 'Driving', severity: 'info', message: 'Drive rail energized', cooldown_min: 15, signal_name: 'DriveRail', op: '=', value_bool: true },
  { name: 'Self-Driving Miles Changed', icon: Icons.navigation, category: 'Driving', severity: 'info', message: 'FSD miles since reset: {{SelfDrivingMilesSinceReset}}', cooldown_min: 1440, signal_name: 'SelfDrivingMilesSinceReset', op: 'changed' },
  { name: 'Trip Miles Since Reset', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Miles since reset: {{MilesSinceReset}}', cooldown_min: 1440, signal_name: 'MilesSinceReset', op: '>', value_num: 500 },

  // ── Security (new) ──────────────────────────────────────────────
  { name: 'Frunk Open', icon: Icons.locked, category: 'Security', severity: 'warn', message: 'Front trunk is open', cooldown_min: 15, signal_name: 'DoorStateFrontTrunk', op: '!=', value_text: 'Closed' },
  { name: 'Trunk Open', icon: Icons.locked, category: 'Security', severity: 'warn', message: 'Rear trunk is open', cooldown_min: 15, signal_name: 'DoorStateRearTrunk', op: '!=', value_text: 'Closed' },
  { name: 'Passenger Door Open', icon: Icons.locked, category: 'Security', severity: 'warn', message: 'Passenger front door: {{DoorStatePassengerFront}}', cooldown_min: 15, signal_name: 'DoorStatePassengerFront', op: '!=', value_text: 'Closed' },
  { name: 'Driver Rear Door Open', icon: Icons.locked, category: 'Security', severity: 'warn', message: 'Driver rear door: {{DoorStateDriverRear}}', cooldown_min: 15, signal_name: 'DoorStateDriverRear', op: '!=', value_text: 'Closed' },
  { name: 'Passenger Rear Door Open', icon: Icons.locked, category: 'Security', severity: 'warn', message: 'Passenger rear door: {{DoorStatePassengerRear}}', cooldown_min: 15, signal_name: 'DoorStatePassengerRear', op: '!=', value_text: 'Closed' },
  { name: 'Front Passenger Window Open', icon: Icons.vehicle, category: 'Security', severity: 'warn', message: 'Front passenger window is {{FpWindow}}', cooldown_min: 60, signal_name: 'FpWindow', op: '!=', value_text: 'Closed' },
  { name: 'Rear Driver Window Open', icon: Icons.vehicle, category: 'Security', severity: 'warn', message: 'Rear driver window is {{RdWindow}}', cooldown_min: 60, signal_name: 'RdWindow', op: '!=', value_text: 'Closed' },
  { name: 'Rear Passenger Window Open', icon: Icons.vehicle, category: 'Security', severity: 'warn', message: 'Rear passenger window is {{RpWindow}}', cooldown_min: 60, signal_name: 'RpWindow', op: '!=', value_text: 'Closed' },
  { name: 'Sentry Mode Off', icon: Icons.security, category: 'Security', severity: 'warn', message: 'Sentry mode is off', cooldown_min: 60, signal_name: 'SentryMode', op: '=', value_bool: false },
  { name: 'Homelink Nearby', icon: Icons.location, category: 'Security', severity: 'info', message: 'Homelink is nearby', cooldown_min: 30, signal_name: 'HomelinkNearby', op: '=', value_bool: true },
  { name: 'Remote Start Enabled', icon: Icons.security, category: 'Security', severity: 'info', message: 'Remote start is enabled', cooldown_min: 30, signal_name: 'RemoteStartEnabled', op: '=', value_bool: true },
  { name: 'Paired Keys Changed', icon: Icons.security, category: 'Security', severity: 'warn', message: 'Paired phone/key fob count: {{PairedPhoneKeyAndKeyFobQty}}', cooldown_min: 60, signal_name: 'PairedPhoneKeyAndKeyFobQty', op: 'changed' },
  { name: 'Service Mode On', icon: Icons.security, category: 'Security', severity: 'warn', message: 'Vehicle is in service mode', cooldown_min: 60, signal_name: 'ServiceMode', op: '=', value_bool: true },
  { name: 'Guest Mobile Access Changed', icon: Icons.security, category: 'Security', severity: 'info', message: 'Guest mobile access: {{GuestModeMobileAccessState}}', cooldown_min: 60, signal_name: 'GuestModeMobileAccessState', op: 'changed' },

  // ── Climate (new) ───────────────────────────────────────────────
  { name: 'Outside Extreme Heat (> 38C)', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Outside temp {{OutsideTemp}}C', cooldown_min: 120, signal_name: 'OutsideTemp', op: '>', value_num: 38 },
  { name: 'Outside Freezing (< 0C)', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Outside temp {{OutsideTemp}}C', cooldown_min: 120, signal_name: 'OutsideTemp', op: '<', value_num: 0 },
  { name: 'Preconditioning On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Preconditioning is enabled', cooldown_min: 30, signal_name: 'PreconditioningEnabled', op: '=', value_bool: true },
  { name: 'HVAC AC On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'A/C is on', cooldown_min: 30, signal_name: 'HvacACEnabled', op: '=', value_bool: true },
  { name: 'Cabin Overheat Protection', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Cabin overheat protection: {{CabinOverheatProtectionMode}}', cooldown_min: 60, signal_name: 'CabinOverheatProtectionMode', op: 'changed' },
  { name: 'Defrost On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Defrost mode: {{DefrostMode}}', cooldown_min: 30, signal_name: 'DefrostMode', op: '!=', value_text: 'Off' },
  { name: 'Rear Defrost On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Rear defrost is on', cooldown_min: 30, signal_name: 'RearDefrostEnabled', op: '=', value_bool: true },
  { name: 'Cabin Fan High', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Fan speed {{HvacFanSpeed}}', cooldown_min: 30, signal_name: 'HvacFanSpeed', op: '>', value_num: 8 },
  { name: 'Driver Seat Heater On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Driver seat heater {{SeatHeaterLeft}}', cooldown_min: 30, signal_name: 'SeatHeaterLeft', op: '>', value_num: 0 },
  { name: 'Passenger Seat Heater On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Passenger seat heater {{SeatHeaterRight}}', cooldown_min: 30, signal_name: 'SeatHeaterRight', op: '>', value_num: 0 },
  { name: 'Seat Vent On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Seat ventilation is on', cooldown_min: 30, signal_name: 'SeatVentEnabled', op: '=', value_bool: true },
  { name: 'Not Enough Power to Heat', icon: Icons.climate, category: 'Climate', severity: 'warn', message: 'Not enough pack power to heat cabin', cooldown_min: 30, signal_name: 'NotEnoughPowerToHeat', op: '=', value_bool: true },
  { name: 'Wiper Heat On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Wiper heat is on', cooldown_min: 60, signal_name: 'WiperHeatEnabled', op: '=', value_bool: true },
  { name: 'Defrost for Preconditioning', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Defrost-for-preconditioning is on', cooldown_min: 30, signal_name: 'DefrostForPreconditioning', op: '=', value_bool: true },

  // ── Tire Pressure (new) ─────────────────────────────────────────
  { name: 'Front Right Tire Low (< 2.2 bar)', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'FR tire: {{TpmsPressureFr}} bar', cooldown_min: 60, signal_name: 'TpmsPressureFr', op: '<', value_num: 2.2 },
  { name: 'Rear Left Tire Low (< 2.2 bar)', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'RL tire: {{TpmsPressureRl}} bar', cooldown_min: 60, signal_name: 'TpmsPressureRl', op: '<', value_num: 2.2 },
  { name: 'Rear Right Tire Low (< 2.2 bar)', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'RR tire: {{TpmsPressureRr}} bar', cooldown_min: 60, signal_name: 'TpmsPressureRr', op: '<', value_num: 2.2 },
  { name: 'Front Left Tire High (> 3.2 bar)', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'FL tire overinflated: {{TpmsPressureFl}} bar', cooldown_min: 120, signal_name: 'TpmsPressureFl', op: '>', value_num: 3.2 },
  { name: 'TPMS Hard Warning FL', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'Hard TPMS warning — front left', cooldown_min: 60, signal_name: 'TpmsHardWarningsFrontLeft', op: '=', value_bool: true },
  { name: 'TPMS Hard Warning FR', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'Hard TPMS warning — front right', cooldown_min: 60, signal_name: 'TpmsHardWarningsFrontRight', op: '=', value_bool: true },
  { name: 'TPMS Hard Warning RL', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'Hard TPMS warning — rear left', cooldown_min: 60, signal_name: 'TpmsHardWarningsRearLeft', op: '=', value_bool: true },
  { name: 'TPMS Hard Warning RR', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'Hard TPMS warning — rear right', cooldown_min: 60, signal_name: 'TpmsHardWarningsRearRight', op: '=', value_bool: true },
  { name: 'TPMS Soft Warning FL', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'Soft TPMS warning — front left', cooldown_min: 120, signal_name: 'TpmsSoftWarningsFrontLeft', op: '=', value_bool: true },

  // ── Location (new) ──────────────────────────────────────────────
  { name: 'Left Work', icon: Icons.location, category: 'Location', severity: 'info', message: 'Vehicle left work', cooldown_min: 15, signal_name: 'LocatedAtWork', op: '=', value_bool: false },
  { name: 'Arrived at Favorite', icon: Icons.location, category: 'Location', severity: 'info', message: 'Vehicle arrived at a favorite location', cooldown_min: 15, signal_name: 'LocatedAtFavorite', op: '=', value_bool: true },
  { name: 'Left Favorite', icon: Icons.location, category: 'Location', severity: 'info', message: 'Vehicle left a favorite location', cooldown_min: 15, signal_name: 'LocatedAtFavorite', op: '=', value_bool: false },
  { name: 'Arrival in Under 10 Minutes', icon: Icons.navigation, category: 'Location', severity: 'info', message: '{{MinutesToArrival}} min to {{DestinationName}}', cooldown_min: 15, signal_name: 'MinutesToArrival', op: '<', value_num: 10 },
  { name: 'Arrival in Under 5 km', icon: Icons.navigation, category: 'Location', severity: 'info', message: '{{MilesToArrival}} remaining to destination', cooldown_min: 15, signal_name: 'MilesToArrival', op: '<', value_num: 5 },
  { name: 'Heavy Traffic Delay (> 15 min)', icon: Icons.navigation, category: 'Location', severity: 'info', message: 'Traffic delay {{RouteTrafficMinutesDelay}} min', cooldown_min: 20, signal_name: 'RouteTrafficMinutesDelay', op: '>', value_num: 15 },
  { name: 'GPS Lost', icon: Icons.location, category: 'Location', severity: 'warn', message: 'GPS state: {{GpsState}}', cooldown_min: 30, signal_name: 'GpsState', op: 'changed' },

  // ── Safety / ADAS (new) ─────────────────────────────────────────
  { name: 'Passenger Seatbelt Unbuckled', icon: Icons.security, category: 'Safety', severity: 'warn', message: 'Passenger seatbelt unbuckled', cooldown_min: 5, signal_name: 'PassengerSeatBelt', op: '=', value_bool: false },
  { name: 'Automatic Emergency Braking Off', icon: Icons.security, category: 'Safety', severity: 'critical', message: 'Automatic emergency braking is off', cooldown_min: 60, signal_name: 'AutomaticEmergencyBrakingOff', op: '=', value_bool: true },
  { name: 'Forward Collision Warning', icon: Icons.security, category: 'Safety', severity: 'warn', message: 'Forward collision warning: {{ForwardCollisionWarning}}', cooldown_min: 15, signal_name: 'ForwardCollisionWarning', op: 'changed' },
  { name: 'Lane Departure Avoidance Off', icon: Icons.security, category: 'Safety', severity: 'warn', message: 'Lane departure avoidance: {{LaneDepartureAvoidance}}', cooldown_min: 60, signal_name: 'LaneDepartureAvoidance', op: 'changed' },
  { name: 'Emergency Lane Departure', icon: Icons.security, category: 'Safety', severity: 'warn', message: 'Emergency lane departure avoidance: {{EmergencyLaneDepartureAvoidance}}', cooldown_min: 30, signal_name: 'EmergencyLaneDepartureAvoidance', op: 'changed' },
  { name: 'Speed Limit Warning', icon: Icons.speed, category: 'Safety', severity: 'info', message: 'Speed limit warning: {{SpeedLimitWarning}}', cooldown_min: 30, signal_name: 'SpeedLimitWarning', op: 'changed' },
  { name: 'Hazards On', icon: Icons.warning, category: 'Safety', severity: 'warn', message: 'Hazard lights are on', cooldown_min: 15, signal_name: 'LightsHazardsActive', op: '=', value_bool: true },
  { name: 'High Beams On', icon: Icons.vehicle, category: 'Safety', severity: 'info', message: 'High beams are on', cooldown_min: 30, signal_name: 'LightsHighBeams', op: '=', value_bool: true },
  { name: 'Turn Signal On', icon: Icons.vehicle, category: 'Safety', severity: 'info', message: 'Turn signal: {{LightsTurnSignal}}', cooldown_min: 15, signal_name: 'LightsTurnSignal', op: 'changed' },
  { name: 'Blind Spot Camera Auto', icon: Icons.security, category: 'Safety', severity: 'info', message: 'Automatic blind-spot camera: {{AutomaticBlindSpotCamera}}', cooldown_min: 120, signal_name: 'AutomaticBlindSpotCamera', op: 'changed' },
  { name: 'Blind Spot Chime Changed', icon: Icons.security, category: 'Safety', severity: 'info', message: 'Blind-spot collision chime: {{BlindSpotCollisionWarningChime}}', cooldown_min: 120, signal_name: 'BlindSpotCollisionWarningChime', op: 'changed' },
  { name: 'Cruise Follow Distance Changed', icon: Icons.speed, category: 'Safety', severity: 'info', message: 'Follow distance {{CruiseFollowDistance}}', cooldown_min: 30, signal_name: 'CruiseFollowDistance', op: 'changed' },

  // ── Motor / powertrain (new) ────────────────────────────────────
  { name: 'Rear Motor Temp High (> 80C)', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'Rear stator temp {{DiStatorTempR}}C', cooldown_min: 15, signal_name: 'DiStatorTempR', op: '>', value_num: 80 },
  { name: 'Front Inverter Temp High (> 80C)', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'Front inverter temp {{DiInverterTF}}C', cooldown_min: 15, signal_name: 'DiInverterTF', op: '>', value_num: 80 },
  { name: 'Front Heatsink Temp High (> 75C)', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'Front heatsink {{DiHeatsinkTF}}C', cooldown_min: 15, signal_name: 'DiHeatsinkTF', op: '>', value_num: 75 },
  { name: 'Isolation Resistance Low', icon: Icons.security, category: 'Motor', severity: 'critical', message: 'Isolation resistance {{IsolationResistance}}', cooldown_min: 10, signal_name: 'IsolationResistance', op: '<', value_num: 500 },
  { name: 'High Pack Current', icon: Icons.bolt, category: 'Motor', severity: 'info', message: 'Pack current {{PackCurrent}} A', cooldown_min: 15, signal_name: 'PackCurrent', op: '>', value_num: 400 },
  { name: 'Lifetime Drive Energy Changed', icon: Icons.bolt, category: 'Motor', severity: 'info', message: 'Lifetime drive energy {{LifetimeEnergyUsedDrive}}', cooldown_min: 1440, signal_name: 'LifetimeEnergyUsedDrive', op: 'changed' },
  { name: 'Lifetime Regen Energy Changed', icon: Icons.charging, category: 'Motor', severity: 'info', message: 'Lifetime regen {{LifetimeEnergyGainedRegen}}', cooldown_min: 1440, signal_name: 'LifetimeEnergyGainedRegen', op: 'changed' },

  // ── Software (new) ──────────────────────────────────────────────
  { name: 'Software Download Progress', icon: Icons.charging, category: 'Software', severity: 'info', message: 'Update download {{SoftwareUpdateDownloadPercentComplete}}%', cooldown_min: 30, signal_name: 'SoftwareUpdateDownloadPercentComplete', op: '>', value_num: 0 },
  { name: 'Software Update Scheduled', icon: Icons.charging, category: 'Software', severity: 'info', message: 'Update scheduled at {{SoftwareUpdateScheduledStartTime}}', cooldown_min: 180, signal_name: 'SoftwareUpdateScheduledStartTime', op: 'changed' },
  { name: 'Vehicle Software Version Changed', icon: Icons.charging, category: 'Software', severity: 'info', message: 'Software version {{Version}}', cooldown_min: 1440, signal_name: 'Version', op: 'changed' },
  { name: 'Update Duration Changed', icon: Icons.charging, category: 'Software', severity: 'info', message: 'Expected install {{SoftwareUpdateExpectedDurationMinutes}} min', cooldown_min: 180, signal_name: 'SoftwareUpdateExpectedDurationMinutes', op: 'changed' },

  // ── Media (new) ─────────────────────────────────────────────────
  { name: 'Media Paused', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Playback paused', cooldown_min: 30, signal_name: 'MediaPlaybackStatus', op: '=', value_text: 'Paused' },
  { name: 'Now Playing Changed', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Now playing {{MediaNowPlayingTitle}}', cooldown_min: 15, signal_name: 'MediaNowPlayingTitle', op: 'changed' },
  { name: 'Media Source Changed', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Source: {{MediaPlaybackSource}}', cooldown_min: 30, signal_name: 'MediaPlaybackSource', op: 'changed' },
  { name: 'Volume Muted', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Volume is {{MediaAudioVolume}}', cooldown_min: 30, signal_name: 'MediaAudioVolume', op: '=', value_num: 0 },

  // ── Powershare (new) ────────────────────────────────────────────
  { name: 'Powershare Hours Low', icon: Icons.charging, category: 'Powershare', severity: 'warn', message: 'Powershare hours left: {{PowershareHoursLeft}}', cooldown_min: 30, signal_name: 'PowershareHoursLeft', op: '<', value_num: 1 },
  { name: 'Powershare Stop Reason', icon: Icons.charging, category: 'Powershare', severity: 'info', message: 'Powershare stopped: {{PowershareStopReason}}', cooldown_min: 30, signal_name: 'PowershareStopReason', op: 'changed' },
  { name: 'Powershare High Power', icon: Icons.charging, category: 'Powershare', severity: 'info', message: 'Powershare {{PowershareInstantaneousPowerKW}} kW', cooldown_min: 30, signal_name: 'PowershareInstantaneousPowerKW', op: '>', value_num: 5 },
  { name: 'Powershare Type Changed', icon: Icons.charging, category: 'Powershare', severity: 'info', message: 'Powershare type {{PowershareType}}', cooldown_min: 60, signal_name: 'PowershareType', op: 'changed' },

  // ── Energy (ecosystem) ──────────────────────────────────────────
  { name: 'AC Energy In High', icon: Icons.bolt, category: 'Energy', severity: 'info', message: 'AC energy in {{ACChargingEnergyIn}}', cooldown_min: 60, signal_name: 'ACChargingEnergyIn', op: '>', value_num: 10 },
  { name: 'DC Energy In High', icon: Icons.bolt, category: 'Energy', severity: 'info', message: 'DC energy in {{DCChargingEnergyIn}}', cooldown_min: 30, signal_name: 'DCChargingEnergyIn', op: '>', value_num: 20 },
  { name: 'Lifetime Energy Used Changed', icon: Icons.bolt, category: 'Energy', severity: 'info', message: 'Lifetime energy {{LifetimeEnergyUsed}}', cooldown_min: 1440, signal_name: 'LifetimeEnergyUsed', op: 'changed' },
  { name: 'Arrival Energy Below 20%', icon: Icons.navigation, category: 'Energy', severity: 'warn', message: 'Expected energy at arrival {{ExpectedEnergyPercentAtTripArrival}}%', cooldown_min: 20, signal_name: 'ExpectedEnergyPercentAtTripArrival', op: '<', value_num: 20 },
  { name: 'Arrival Energy Below 10%', icon: Icons.navigation, category: 'Energy', severity: 'critical', message: 'Arrival SoC only {{ExpectedEnergyPercentAtTripArrival}}%', cooldown_min: 10, signal_name: 'ExpectedEnergyPercentAtTripArrival', op: '<', value_num: 10 },
  { name: 'High Range-Add Rate', icon: Icons.charging, category: 'Energy', severity: 'info', message: 'Range-add rate {{ChargeRateMilePerHour}}', cooldown_min: 30, signal_name: 'ChargeRateMilePerHour', op: '>', value_num: 150 },
  { name: 'DC-DC Converter On', icon: Icons.bolt, category: 'Energy', severity: 'info', message: 'DC-DC converter enabled', cooldown_min: 30, signal_name: 'DCDCEnable', op: '=', value_bool: true },
  { name: 'BMS State Changed', icon: Icons.battery, category: 'Energy', severity: 'info', message: 'BMS state {{BMSState}}', cooldown_min: 30, signal_name: 'BMSState', op: 'changed' },
  { name: 'Brick Voltage High', icon: Icons.battery, category: 'Energy', severity: 'warn', message: 'Max brick {{BrickVoltageMax}} V', cooldown_min: 20, signal_name: 'BrickVoltageMax', op: '>', value_num: 4.2 },
  { name: 'Brick Voltage Low', icon: Icons.battery, category: 'Energy', severity: 'critical', message: 'Min brick {{BrickVoltageMin}} V', cooldown_min: 10, signal_name: 'BrickVoltageMin', op: '<', value_num: 3.2 },
  { name: 'Brick Voltage Spread', icon: Icons.battery, category: 'Energy', severity: 'warn', message: 'Brick max {{BrickVoltageMax}} / min {{BrickVoltageMin}}', cooldown_min: 30, signal_name: 'NumBrickVoltageMax', op: 'changed' },
  { name: 'Module Temp Cell Index Changed', icon: Icons.climate, category: 'Energy', severity: 'info', message: 'Hottest module index {{NumModuleTempMax}}', cooldown_min: 60, signal_name: 'NumModuleTempMax', op: 'changed' },

  // ── Charging extras (ecosystem) ─────────────────────────────────
  { name: 'Charge Port State Changed', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charge port {{ChargePort}}', cooldown_min: 15, signal_name: 'ChargePort', op: 'changed' },
  { name: 'Max Charge Current Changed', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Max request {{ChargeCurrentRequestMax}}A', cooldown_min: 60, signal_name: 'ChargeCurrentRequestMax', op: 'changed' },
  { name: 'Fast Charger Type Changed', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Fast charger type {{FastChargerType}}', cooldown_min: 30, signal_name: 'FastChargerType', op: 'changed' },
  { name: 'Scheduled Charge Start Changed', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Scheduled start {{ScheduledChargingStartTime}}', cooldown_min: 60, signal_name: 'ScheduledChargingStartTime', op: 'changed' },
  { name: 'Scheduled Departure Changed', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Departure {{ScheduledDepartureTime}}', cooldown_min: 60, signal_name: 'ScheduledDepartureTime', op: 'changed' },

  // ── Climate extras (ecosystem) ──────────────────────────────────
  { name: 'Auto Seat Climate Left On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Driver auto seat climate on', cooldown_min: 30, signal_name: 'AutoSeatClimateLeft', op: '=', value_bool: true },
  { name: 'Auto Seat Climate Right On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Passenger auto seat climate on', cooldown_min: 30, signal_name: 'AutoSeatClimateRight', op: '=', value_bool: true },
  { name: 'Driver Seat Cooling On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Driver seat cooling {{ClimateSeatCoolingFrontLeft}}', cooldown_min: 30, signal_name: 'ClimateSeatCoolingFrontLeft', op: '>', value_num: 0 },
  { name: 'Passenger Seat Cooling On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Passenger seat cooling {{ClimateSeatCoolingFrontRight}}', cooldown_min: 30, signal_name: 'ClimateSeatCoolingFrontRight', op: '>', value_num: 0 },
  { name: 'Cabin Overheat Temp Limit Changed', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'COP limit {{CabinOverheatProtectionTemperatureLimit}}', cooldown_min: 120, signal_name: 'CabinOverheatProtectionTemperatureLimit', op: 'changed' },
  { name: 'HVAC Auto Mode Changed', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'HVAC auto {{HvacAutoMode}}', cooldown_min: 30, signal_name: 'HvacAutoMode', op: 'changed' },
  { name: 'HVAC Fan Status Changed', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Fan status {{HvacFanStatus}}', cooldown_min: 30, signal_name: 'HvacFanStatus', op: 'changed' },
  { name: 'Driver Temp Request High', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Left temp request {{HvacLeftTemperatureRequest}}', cooldown_min: 30, signal_name: 'HvacLeftTemperatureRequest', op: '>', value_num: 24 },
  { name: 'Passenger Temp Request Low', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Right temp request {{HvacRightTemperatureRequest}}', cooldown_min: 30, signal_name: 'HvacRightTemperatureRequest', op: '<', value_num: 18 },
  { name: 'Steering Heat Auto On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Steering wheel auto-heat on', cooldown_min: 30, signal_name: 'HvacSteeringWheelHeatAuto', op: '=', value_bool: true },
  { name: 'Rear Display HVAC On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Rear display HVAC enabled', cooldown_min: 30, signal_name: 'RearDisplayHvacEnabled', op: '=', value_bool: true },
  { name: 'Rear Seat Heaters On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Rear seat heaters {{RearSeatHeaters}}', cooldown_min: 30, signal_name: 'RearSeatHeaters', op: '>', value_num: 0 },
  { name: 'Rear Center Seat Heat On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Rear center heater {{SeatHeaterRearCenter}}', cooldown_min: 30, signal_name: 'SeatHeaterRearCenter', op: '>', value_num: 0 },
  { name: 'Rear Left Seat Heat On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Rear left heater {{SeatHeaterRearLeft}}', cooldown_min: 30, signal_name: 'SeatHeaterRearLeft', op: '>', value_num: 0 },
  { name: 'Rear Right Seat Heat On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Rear right heater {{SeatHeaterRearRight}}', cooldown_min: 30, signal_name: 'SeatHeaterRearRight', op: '>', value_num: 0 },

  // ── Occupancy (ecosystem) ───────────────────────────────────────
  { name: 'Driver Seat Occupied', icon: Icons.vehicle, category: 'Occupancy', severity: 'info', message: 'Driver seat is occupied', cooldown_min: 15, signal_name: 'DriverSeatOccupied', op: '=', value_bool: true },
  { name: 'Driver Seat Empty', icon: Icons.vehicle, category: 'Occupancy', severity: 'info', message: 'Driver seat is empty', cooldown_min: 15, signal_name: 'DriverSeatOccupied', op: '=', value_bool: false },
  { name: 'Driver Door Open', icon: Icons.locked, category: 'Occupancy', severity: 'info', message: 'Driver door {{DoorStateDriverFront}}', cooldown_min: 10, signal_name: 'DoorStateDriverFront', op: '!=', value_text: 'Closed' },

  // ── Driving extras (ecosystem) ──────────────────────────────────
  { name: 'Front Axle Speed High', icon: Icons.speed, category: 'Driving', severity: 'info', message: 'Front axle {{DiAxleSpeedF}}', cooldown_min: 15, signal_name: 'DiAxleSpeedF', op: '>', value_num: 100 },
  { name: 'Rear Axle Speed High', icon: Icons.speed, category: 'Driving', severity: 'info', message: 'Rear axle {{DiAxleSpeedR}}', cooldown_min: 15, signal_name: 'DiAxleSpeedR', op: '>', value_num: 100 },
  { name: 'Front Motor Current High', icon: Icons.bolt, category: 'Motor', severity: 'info', message: 'Front motor current {{DiMotorCurrentF}} A', cooldown_min: 15, signal_name: 'DiMotorCurrentF', op: '>', value_num: 250 },
  { name: 'Rear Motor Current High', icon: Icons.bolt, category: 'Motor', severity: 'info', message: 'Rear motor current {{DiMotorCurrentR}} A', cooldown_min: 15, signal_name: 'DiMotorCurrentR', op: '>', value_num: 250 },
  { name: 'Front Torque High', icon: Icons.speed, category: 'Motor', severity: 'info', message: 'Front torque {{DiTorqueActualF}}', cooldown_min: 15, signal_name: 'DiTorqueActualF', op: '>', value_num: 200 },
  { name: 'Rear Torque High', icon: Icons.speed, category: 'Motor', severity: 'info', message: 'Rear torque {{DiTorqueActualR}}', cooldown_min: 15, signal_name: 'DiTorqueActualR', op: '>', value_num: 200 },
  { name: 'Torque Command High', icon: Icons.speed, category: 'Motor', severity: 'info', message: 'Torque command {{DiSlaveTorqueCmd}}', cooldown_min: 15, signal_name: 'DiSlaveTorqueCmd', op: '>', value_num: 200 },
  { name: 'Motor Torque High', icon: Icons.speed, category: 'Motor', severity: 'info', message: 'Motor torque {{DiTorquemotor}}', cooldown_min: 15, signal_name: 'DiTorquemotor', op: '>', value_num: 250 },
  { name: 'REL Stator Temp High', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'REL stator {{DiStatorTempREL}}C', cooldown_min: 15, signal_name: 'DiStatorTempREL', op: '>', value_num: 80 },
  { name: 'RER Stator Temp High', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'RER stator {{DiStatorTempRER}}C', cooldown_min: 15, signal_name: 'DiStatorTempRER', op: '>', value_num: 80 },
  { name: 'Rear Heatsink Temp High', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'Rear heatsink {{DiHeatsinkTR}}C', cooldown_min: 15, signal_name: 'DiHeatsinkTR', op: '>', value_num: 75 },
  { name: 'REL Heatsink Temp High', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'REL heatsink {{DiHeatsinkTREL}}C', cooldown_min: 15, signal_name: 'DiHeatsinkTREL', op: '>', value_num: 75 },
  { name: 'RER Heatsink Temp High', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'RER heatsink {{DiHeatsinkTRER}}C', cooldown_min: 15, signal_name: 'DiHeatsinkTRER', op: '>', value_num: 75 },
  { name: 'Rear Inverter Temp High', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'Rear inverter {{DiInverterTR}}C', cooldown_min: 15, signal_name: 'DiInverterTR', op: '>', value_num: 80 },
  { name: 'REL Inverter Temp High', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'REL inverter {{DiInverterTREL}}C', cooldown_min: 15, signal_name: 'DiInverterTREL', op: '>', value_num: 80 },
  { name: 'RER Inverter Temp High', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'RER inverter {{DiInverterTRER}}C', cooldown_min: 15, signal_name: 'DiInverterTRER', op: '>', value_num: 80 },
  { name: 'Front Drive Unit State Changed', icon: Icons.bolt, category: 'Motor', severity: 'info', message: 'Front DU {{DiStateF}}', cooldown_min: 30, signal_name: 'DiStateF', op: 'changed' },
  { name: 'Rear Drive Unit State Changed', icon: Icons.bolt, category: 'Motor', severity: 'info', message: 'Rear DU {{DiStateR}}', cooldown_min: 30, signal_name: 'DiStateR', op: 'changed' },
  { name: 'Front Pack Voltage Low', icon: Icons.battery, category: 'Motor', severity: 'warn', message: 'Front Vbat {{DiVBatF}} V', cooldown_min: 20, signal_name: 'DiVBatF', op: '<', value_num: 300 },
  { name: 'Rear Pack Voltage Low', icon: Icons.battery, category: 'Motor', severity: 'warn', message: 'Rear Vbat {{DiVBatR}} V', cooldown_min: 20, signal_name: 'DiVBatR', op: '<', value_num: 300 },
  { name: 'REL Motor Current High', icon: Icons.bolt, category: 'Motor', severity: 'info', message: 'REL current {{DiMotorCurrentREL}} A', cooldown_min: 15, signal_name: 'DiMotorCurrentREL', op: '>', value_num: 250 },
  { name: 'RER Motor Current High', icon: Icons.bolt, category: 'Motor', severity: 'info', message: 'RER current {{DiMotorCurrentRER}} A', cooldown_min: 15, signal_name: 'DiMotorCurrentRER', op: '>', value_num: 250 },

  // ── Location extras (ecosystem) ─────────────────────────────────
  { name: 'GPS Heading Changed', icon: Icons.navigation, category: 'Location', severity: 'info', message: 'Heading {{GpsHeading}}', cooldown_min: 30, signal_name: 'GpsHeading', op: 'changed' },
  { name: 'Route Recalculated', icon: Icons.navigation, category: 'Location', severity: 'info', message: 'Route last updated {{RouteLastUpdated}}', cooldown_min: 10, signal_name: 'RouteLastUpdated', op: 'changed' },
  { name: 'Route Line Updated', icon: Icons.navigation, category: 'Location', severity: 'info', message: 'Nav route geometry updated', cooldown_min: 15, signal_name: 'RouteLine', op: 'changed' },
  { name: 'Destination Latitude Changed', icon: Icons.navigation, category: 'Location', severity: 'info', message: 'New destination lat {{DestinationLocationLatitude}}', cooldown_min: 10, signal_name: 'DestinationLocationLatitude', op: 'changed' },
  { name: 'Origin Changed', icon: Icons.location, category: 'Location', severity: 'info', message: 'Trip origin updated', cooldown_min: 30, signal_name: 'OriginLocationLatitude', op: 'changed' },

  // ── Tires extras (ecosystem) ────────────────────────────────────
  { name: 'TPMS Soft Warning FR', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'Soft TPMS warning — front right', cooldown_min: 120, signal_name: 'TpmsSoftWarningsFrontRight', op: '=', value_bool: true },
  { name: 'TPMS Soft Warning RL', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'Soft TPMS warning — rear left', cooldown_min: 120, signal_name: 'TpmsSoftWarningsRearLeft', op: '=', value_bool: true },
  { name: 'TPMS Soft Warning RR', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'Soft TPMS warning — rear right', cooldown_min: 120, signal_name: 'TpmsSoftWarningsRearRight', op: '=', value_bool: true },
  { name: 'FL Pressure Stale', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'FL last seen {{TpmsLastSeenPressureTimeFl}}', cooldown_min: 180, signal_name: 'TpmsLastSeenPressureTimeFl', op: 'changed' },
  { name: 'FR Pressure Stale', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'FR last seen {{TpmsLastSeenPressureTimeFr}}', cooldown_min: 180, signal_name: 'TpmsLastSeenPressureTimeFr', op: 'changed' },
  { name: 'RL Pressure Stale', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'RL last seen {{TpmsLastSeenPressureTimeRl}}', cooldown_min: 180, signal_name: 'TpmsLastSeenPressureTimeRl', op: 'changed' },
  { name: 'RR Pressure Stale', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'RR last seen {{TpmsLastSeenPressureTimeRr}}', cooldown_min: 180, signal_name: 'TpmsLastSeenPressureTimeRr', op: 'changed' },

  // ── Media extras (ecosystem) ────────────────────────────────────
  { name: 'Now Playing Artist Changed', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Artist {{MediaNowPlayingArtist}}', cooldown_min: 15, signal_name: 'MediaNowPlayingArtist', op: 'changed' },
  { name: 'Now Playing Album Changed', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Album {{MediaNowPlayingAlbum}}', cooldown_min: 15, signal_name: 'MediaNowPlayingAlbum', op: 'changed' },
  { name: 'Radio Station Changed', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Station {{MediaNowPlayingStation}}', cooldown_min: 15, signal_name: 'MediaNowPlayingStation', op: 'changed' },
  { name: 'Volume Max Changed', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Volume max {{MediaAudioVolumeMax}}', cooldown_min: 120, signal_name: 'MediaAudioVolumeMax', op: 'changed' },
  { name: 'Volume Increment Changed', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Volume step {{MediaAudioVolumeIncrement}}', cooldown_min: 120, signal_name: 'MediaAudioVolumeIncrement', op: 'changed' },
  { name: 'Track Duration Changed', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Track duration {{MediaNowPlayingDuration}}', cooldown_min: 15, signal_name: 'MediaNowPlayingDuration', op: 'changed' },

  // ── Display / settings (ecosystem) ──────────────────────────────
  { name: 'Center Display Changed', icon: Icons.vehicle, category: 'Display', severity: 'info', message: 'Center display {{CenterDisplay}}', cooldown_min: 30, signal_name: 'CenterDisplay', op: 'changed' },
  { name: '24-Hour Time Setting Changed', icon: Icons.vehicle, category: 'Display', severity: 'info', message: '24-hour time {{Setting24HourTime}}', cooldown_min: 1440, signal_name: 'Setting24HourTime', op: 'changed' },
  { name: 'Distance Unit Changed', icon: Icons.vehicle, category: 'Display', severity: 'info', message: 'Distance unit {{SettingDistanceUnit}}', cooldown_min: 1440, signal_name: 'SettingDistanceUnit', op: 'changed' },
  { name: 'Temperature Unit Changed', icon: Icons.climate, category: 'Display', severity: 'info', message: 'Temp unit {{SettingTemperatureUnit}}', cooldown_min: 1440, signal_name: 'SettingTemperatureUnit', op: 'changed' },
  { name: 'Charge Unit Changed', icon: Icons.charging, category: 'Display', severity: 'info', message: 'Charge unit {{SettingChargeUnit}}', cooldown_min: 1440, signal_name: 'SettingChargeUnit', op: 'changed' },
  { name: 'Tire Pressure Unit Changed', icon: Icons.droplets, category: 'Display', severity: 'info', message: 'TP unit {{SettingTirePressureUnit}}', cooldown_min: 1440, signal_name: 'SettingTirePressureUnit', op: 'changed' },

  // ── Identity / software extras ──────────────────────────────────
  { name: 'Vehicle Name Changed', icon: Icons.vehicle, category: 'Software', severity: 'info', message: 'Vehicle renamed to {{VehicleName}}', cooldown_min: 1440, signal_name: 'VehicleName', op: 'changed' },
  { name: 'Trim Changed', icon: Icons.vehicle, category: 'Software', severity: 'info', message: 'Trim {{Trim}}', cooldown_min: 1440, signal_name: 'Trim', op: 'changed' },
  { name: 'Wheel Type Changed', icon: Icons.vehicle, category: 'Software', severity: 'info', message: 'Wheels {{WheelType}}', cooldown_min: 1440, signal_name: 'WheelType', op: 'changed' },
  { name: 'Efficiency Package Changed', icon: Icons.bolt, category: 'Software', severity: 'info', message: 'Efficiency package {{EfficiencyPackage}}', cooldown_min: 1440, signal_name: 'EfficiencyPackage', op: 'changed' },
  { name: 'Exterior Color Changed', icon: Icons.vehicle, category: 'Software', severity: 'info', message: 'Color {{ExteriorColor}}', cooldown_min: 1440, signal_name: 'ExteriorColor', op: 'changed' },
  { name: 'Roof Color Changed', icon: Icons.vehicle, category: 'Software', severity: 'info', message: 'Roof {{RoofColor}}', cooldown_min: 1440, signal_name: 'RoofColor', op: 'changed' },
  { name: 'Car Type Changed', icon: Icons.vehicle, category: 'Software', severity: 'info', message: 'Car type {{CarType}}', cooldown_min: 1440, signal_name: 'CarType', op: 'changed' },

  // ── Truck / Cybertruck (ecosystem) ──────────────────────────────
  { name: 'Tonneau Mostly Open', icon: Icons.vehicle, category: 'Truck', severity: 'info', message: 'Tonneau open {{TonneauOpenPercent}}%', cooldown_min: 30, signal_name: 'TonneauOpenPercent', op: '>', value_num: 50 },
  { name: 'Tonneau Position Changed', icon: Icons.vehicle, category: 'Truck', severity: 'info', message: 'Tonneau {{TonneauPosition}}', cooldown_min: 15, signal_name: 'TonneauPosition', op: 'changed' },
  { name: 'Tonneau Tent Mode', icon: Icons.vehicle, category: 'Truck', severity: 'info', message: 'Tonneau tent mode is on', cooldown_min: 30, signal_name: 'TonneauTentMode', op: '=', value_bool: true },
  { name: 'Sunroof Installed Changed', icon: Icons.vehicle, category: 'Truck', severity: 'info', message: 'Sunroof installed {{SunroofInstalled}}', cooldown_min: 1440, signal_name: 'SunroofInstalled', op: 'changed' },
  { name: 'Offroad Lightbar Present', icon: Icons.warning, category: 'Truck', severity: 'info', message: 'Off-road lightbar present', cooldown_min: 1440, signal_name: 'OffroadLightbarPresent', op: '=', value_bool: true },
  { name: 'Homelink Device Count Changed', icon: Icons.location, category: 'Security', severity: 'info', message: 'Homelink devices {{HomelinkDeviceCount}}', cooldown_min: 1440, signal_name: 'HomelinkDeviceCount', op: 'changed' },
]

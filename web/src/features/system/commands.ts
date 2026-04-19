/**
 * Command definitions for the Vehicle Commands page.
 *
 * Every Tesla vehicle command is defined here as a CommandDef.
 * The page uses this config to render tiles, handle input prompts,
 * manage toggles, and filter/search commands.
 *
 * 67 entries → 72 commands (5 toggle pairs merged into single entries).
 */

import type { LucideIcon } from 'lucide-react';
import {
  Power, Lock, Unlock, Shield, GaugeCircle, UserCheck, UserX, UserPlus,
  Eraser, KeyRound, Wind, Thermometer, Flame, Snowflake, CircleDot,
  ShieldAlert, Dog, Tent, X, Zap, BatteryFull, BatteryMedium, Gauge,
  Battery, DoorOpen, Car, ArrowUpFromDot, ArrowDownToDot, CircleStop,
  CalendarPlus, CalendarMinus, Volume2, MapPin, Speaker, Locate, Home,
  Navigation, Download, XCircle, Pencil, Play, SkipForward, SkipBack,
  Heart, VolumeX, Volume1,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CommandCategory =
  | 'security' | 'climate' | 'climate_protection' | 'charging'
  | 'doors' | 'drive' | 'windows' | 'sunroof'
  | 'schedules' | 'alerts' | 'navigation' | 'software'
  | 'vehicle' | 'media';

export interface InputField {
  name: string;
  labelKey: string;
  labelFallback: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'password';
  validation?: 'pin' | 'number' | 'decimal' | 'text';
  min?: number;
  max?: number;
}

export interface InputConfig {
  promptKey: string;
  promptFallback: string;
  paramName: string;
  defaultValue?: string;
  validation?: 'pin' | 'number' | 'decimal' | 'text';
  min?: number;
  max?: number;
  transform?: (value: string) => unknown;
  fields?: InputField[];
  buildParams?: (values: Record<string, string>) => Record<string, unknown>;
  getDefaultValue?: (ctx: { vehicle?: { display_name: string } }) => string;
}

export interface SelectOption {
  value: string;
  labelKey: string;
  labelFallback: string;
  description?: string;
}

export interface SelectConfig {
  paramName: string;
  options: SelectOption[];
}

export interface CommandDef {
  id: string;
  command: string;
  commandOff?: string;
  labelKey: string;
  labelFallback: string;
  sublabelKey?: string;
  sublabelFallback?: string;
  icon: LucideIcon;
  iconOff?: LucideIcon;
  category: CommandCategory;
  variant?: 'default' | 'danger' | 'success';
  type: 'action' | 'toggle' | 'input';
  stateField?: string;
  dangerous?: boolean;
  confirmKey?: string;
  confirmFallback?: string;
  defaultFavorite?: boolean;
  inputConfig?: InputConfig;
  selectConfig?: SelectConfig;
  params?: Record<string, unknown>;
  countdown?: number;
  confirmInput?: string;
}

export interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
  model: string;
  state: string;
  battery_level: number;
  battery_range: number;
  updated_at: string;
}

export interface VehicleState {
  battery_level: number;
  rated_range: number;
  is_locked: boolean;
  is_charging: boolean;
  is_climate_on: boolean;
  sentry_mode: boolean;
  inside_temp: number;
  speed: number;
}

export interface CommandLogEntry {
  id: number;
  vehicle_id: number;
  command: string;
  params: string;
  status: string;
  error: string;
  created_at: string;
}

// ─── Category metadata ──────────────────────────────────────────────────────

export const CATEGORY_ORDER: CommandCategory[] = [
  'security', 'climate', 'climate_protection', 'charging',
  'doors', 'drive', 'windows', 'sunroof',
  'schedules', 'alerts', 'navigation', 'software',
  'vehicle', 'media',
];

export const CATEGORY_META: Record<CommandCategory, { labelKey: string; fallback: string; icon: LucideIcon }> = {
  security:           { labelKey: 'commands.cat.security',       fallback: 'Security & Access',  icon: Shield },
  climate:            { labelKey: 'commands.cat.climate',        fallback: 'Climate & Comfort',  icon: Wind },
  climate_protection: { labelKey: 'commands.cat.climateProtect', fallback: 'Climate Protection', icon: ShieldAlert },
  charging:           { labelKey: 'commands.cat.charging',       fallback: 'Charging',           icon: Zap },
  doors:              { labelKey: 'commands.cat.doors',          fallback: 'Doors & Trunk',      icon: DoorOpen },
  drive:              { labelKey: 'commands.cat.drive',          fallback: 'Drive',              icon: Car },
  windows:            { labelKey: 'commands.cat.windows',        fallback: 'Windows',            icon: Wind },
  sunroof:            { labelKey: 'commands.cat.sunroof',        fallback: 'Sunroof',            icon: ArrowUpFromDot },
  schedules:          { labelKey: 'commands.cat.schedules',      fallback: 'Schedules',          icon: CalendarPlus },
  alerts:             { labelKey: 'commands.cat.alerts',         fallback: 'Alerts & Location',  icon: Speaker },
  navigation:         { labelKey: 'commands.cat.navigation',     fallback: 'Navigation',         icon: Navigation },
  software:           { labelKey: 'commands.cat.software',       fallback: 'Software',           icon: Download },
  vehicle:            { labelKey: 'commands.cat.vehicle',        fallback: 'Vehicle',            icon: Car },
  media:              { labelKey: 'commands.cat.media',          fallback: 'Media',              icon: Play },
};

// ─── Command definitions ────────────────────────────────────────────────────

export const COMMANDS: CommandDef[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // Security & Access — 15 entries (17 commands: 2 toggles)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'wake_up', command: 'wake_up',
    labelKey: 'commands.security.wakeUp', labelFallback: 'Wake Up',
    sublabelKey: 'commands.security.wakeVehicle', sublabelFallback: 'Wake vehicle',
    icon: Power, category: 'security', type: 'action',
    variant: 'success', defaultFavorite: true,
  },
  {
    id: 'lock', command: 'lock', commandOff: 'unlock',
    labelKey: 'commands.security.lock', labelFallback: 'Lock',
    icon: Lock, iconOff: Unlock, category: 'security', type: 'toggle',
    stateField: 'is_locked', defaultFavorite: true,
  },
  {
    id: 'sentry', command: 'sentry_on', commandOff: 'sentry_off',
    labelKey: 'commands.security.sentry', labelFallback: 'Sentry',
    icon: Shield, category: 'security', type: 'toggle',
    stateField: 'sentry_mode', variant: 'danger', defaultFavorite: true,
  },
  {
    id: 'speed_limit_set', command: 'speed_limit_set_limit',
    labelKey: 'commands.security.speedLimit', labelFallback: 'Speed Limit',
    sublabelKey: 'commands.security.setMph', sublabelFallback: 'Set MPH',
    icon: GaugeCircle, category: 'security', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterSpeedLimit',
      promptFallback: 'Enter speed limit (50-90 MPH):',
      paramName: 'limit_mph', validation: 'number', min: 50, max: 90,
    },
  },
  {
    id: 'speed_limit_on', command: 'speed_limit_on',
    labelKey: 'commands.security.speedActivate', labelFallback: 'Activate',
    sublabelKey: 'commands.security.speedLimitMode', sublabelFallback: 'Speed Limit',
    icon: GaugeCircle, category: 'security', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterSpeedPin',
      promptFallback: 'Enter 4-digit PIN:',
      paramName: 'pin', validation: 'pin',
    },
  },
  {
    id: 'speed_limit_off', command: 'speed_limit_off',
    labelKey: 'commands.security.speedDeactivate', labelFallback: 'Deactivate',
    sublabelKey: 'commands.security.speedLimitMode', sublabelFallback: 'Speed Limit',
    icon: GaugeCircle, category: 'security', type: 'input',
    inputConfig: {
      promptKey: 'commands.security.enterSpeedPin',
      promptFallback: 'Enter 4-digit PIN:',
      paramName: 'pin', validation: 'pin',
    },
  },
  {
    id: 'speed_limit_clear_pin', command: 'speed_limit_clear_pin',
    labelKey: 'commands.security.clearSpeedPin', labelFallback: 'Clear Speed PIN',
    sublabelKey: 'commands.security.requiresPin', sublabelFallback: 'Requires PIN',
    icon: GaugeCircle, category: 'security', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterSpeedPin',
      promptFallback: 'Enter 4-digit PIN:',
      paramName: 'pin', validation: 'pin',
    },
  },
  {
    id: 'speed_limit_clear_pin_admin', command: 'speed_limit_clear_pin_admin',
    labelKey: 'commands.security.clearSpeedPin', labelFallback: 'Clear Speed PIN',
    sublabelKey: 'commands.security.admin', sublabelFallback: 'Admin',
    icon: GaugeCircle, category: 'security', type: 'action', variant: 'danger',
    dangerous: true,
    confirmKey: 'commands.security.confirmClearPin',
    confirmFallback: 'Clear speed limit PIN without authentication?',
  },
  {
    id: 'valet_mode', command: 'set_valet_mode', commandOff: 'valet_off',
    labelKey: 'commands.security.valetMode', labelFallback: 'Valet Mode',
    icon: UserCheck, iconOff: UserX, category: 'security', type: 'toggle', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterValetPin',
      promptFallback: 'Enter 4-digit valet PIN:',
      paramName: 'password', validation: 'pin',
    },
    params: { on: 'true' },
  },
  {
    id: 'reset_valet_pin', command: 'reset_valet_pin',
    labelKey: 'commands.security.resetValetPin', labelFallback: 'Reset Valet PIN',
    sublabelKey: 'commands.security.admin', sublabelFallback: 'Admin',
    icon: UserX, category: 'security', type: 'action', variant: 'danger',
  },
  {
    id: 'guest_mode', command: 'guest_mode_on', commandOff: 'guest_mode_off',
    labelKey: 'commands.security.guestMode', labelFallback: 'Guest Mode',
    icon: UserPlus, iconOff: UserX, category: 'security', type: 'toggle',
  },
  {
    id: 'erase_user_data', command: 'erase_user_data',
    labelKey: 'commands.security.eraseData', labelFallback: 'Erase Data',
    sublabelKey: 'commands.security.guestOnly', sublabelFallback: 'Guest mode only',
    icon: Eraser, category: 'security', type: 'action', variant: 'danger',
    dangerous: true,
    confirmKey: 'commands.security.confirmErase',
    confirmFallback: 'This will erase all user data from the vehicle touchscreen. Continue?',
    countdown: 5,
    confirmInput: 'ERASE',
  },
  {
    id: 'pin_to_drive', command: 'set_pin_to_drive',
    labelKey: 'commands.security.pinToDrive', labelFallback: 'PIN to Drive',
    sublabelKey: 'commands.security.enable', sublabelFallback: 'Enable',
    icon: KeyRound, category: 'security', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterPin',
      promptFallback: 'Enter 4-digit PIN:',
      paramName: 'password', validation: 'pin',
    },
    params: { on: 'true' },
  },
  {
    id: 'reset_pin_to_drive_pin', command: 'reset_pin_to_drive_pin',
    labelKey: 'commands.security.resetPin', labelFallback: 'Reset PIN',
    sublabelKey: 'commands.security.pinToDrive', sublabelFallback: 'PIN to Drive',
    icon: KeyRound, category: 'security', type: 'action', variant: 'danger',
  },
  {
    id: 'clear_pin_to_drive_admin', command: 'clear_pin_to_drive_admin',
    labelKey: 'commands.security.clearPin', labelFallback: 'Clear PIN',
    sublabelKey: 'commands.security.admin', sublabelFallback: 'Admin',
    icon: KeyRound, category: 'security', type: 'action', variant: 'danger',
    dangerous: true,
    confirmKey: 'commands.security.confirmClearDrivePin',
    confirmFallback: 'Clear PIN to Drive without authentication?',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Climate & Comfort — 5 entries (6 commands: 1 toggle)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'climate', command: 'climate_on', commandOff: 'climate_off',
    labelKey: 'commands.climate.climate', labelFallback: 'Climate',
    icon: Wind, category: 'climate', type: 'toggle',
    stateField: 'is_climate_on', defaultFavorite: true,
  },
  {
    id: 'set_temps', command: 'set_temps',
    labelKey: 'commands.climate.setTemps', labelFallback: 'Set Temps',
    sublabelKey: 'commands.climate.driverPassenger', sublabelFallback: 'Driver/Passenger',
    icon: Thermometer, category: 'climate', type: 'input',
    inputConfig: {
      promptKey: 'commands.climate.enterTemp',
      promptFallback: 'Enter temperature in °C (e.g., 21):',
      paramName: 'driver_temp', validation: 'decimal', min: 15, max: 30,
      buildParams: (values) => ({ driver_temp: values.driver_temp, passenger_temp: values.driver_temp }),
    },
  },
  {
    id: 'seat_heater', command: 'seat_heater',
    labelKey: 'commands.climate.seatHeat', labelFallback: 'Seat Heat',
    sublabelKey: 'commands.climate.driver', sublabelFallback: 'Driver',
    icon: Flame, category: 'climate', type: 'action',
    params: { heater: '0', level: '3' },
  },
  {
    id: 'seat_cooler', command: 'seat_cooler',
    labelKey: 'commands.climate.seatCool', labelFallback: 'Seat Cool',
    sublabelKey: 'commands.climate.driver', sublabelFallback: 'Driver',
    icon: Snowflake, category: 'climate', type: 'action',
    params: { seat_position: '0', seat_cooler_level: '3' },
  },
  {
    id: 'steering_wheel_heat', command: 'steering_wheel_heat',
    labelKey: 'commands.climate.steeringHeat', labelFallback: 'Steering Heat',
    sublabelKey: 'commands.climate.toggle', sublabelFallback: 'Toggle',
    icon: CircleDot, category: 'climate', type: 'action',
    params: { on: 'true' },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Climate Protection — 10 entries (12 commands: 2 toggles)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'bioweapon', command: 'bioweapon_on', commandOff: 'bioweapon_off',
    labelKey: 'commands.climate.bioweapon', labelFallback: 'Bioweapon',
    sublabelKey: 'commands.climate.defenseMode', sublabelFallback: 'Defense Mode',
    icon: ShieldAlert, category: 'climate_protection', type: 'toggle', variant: 'danger',
  },
  {
    id: 'cop_on', command: 'cop_on',
    labelKey: 'commands.climate.cop', labelFallback: 'Overheat Protect',
    sublabelKey: 'commands.climate.copOn', sublabelFallback: 'On (AC)',
    icon: Thermometer, category: 'climate_protection', type: 'action',
  },
  {
    id: 'cop_fan_only', command: 'cop_fan_only',
    labelKey: 'commands.climate.copFan', labelFallback: 'Overheat Protect',
    sublabelKey: 'commands.climate.fanOnly', sublabelFallback: 'Fan only',
    icon: Thermometer, category: 'climate_protection', type: 'action',
  },
  {
    id: 'cop_off', command: 'cop_off',
    labelKey: 'commands.climate.copOff', labelFallback: 'Overheat Protect',
    sublabelKey: 'commands.climate.off', sublabelFallback: 'OFF',
    icon: Thermometer, category: 'climate_protection', type: 'action',
  },
  {
    id: 'set_cop_temp', command: 'set_cop_temp',
    labelKey: 'commands.climate.copTemp', labelFallback: 'COP Temp',
    sublabelKey: 'commands.climate.setLevel', sublabelFallback: 'Low/Med/High',
    icon: Thermometer, category: 'climate_protection', type: 'input',
    selectConfig: {
      paramName: 'cop_temp',
      options: [
        { value: '0', labelKey: 'commands.climate.copLow', labelFallback: 'Low', description: '90°F / 30°C' },
        { value: '1', labelKey: 'commands.climate.copMedium', labelFallback: 'Medium', description: '95°F / 35°C' },
        { value: '2', labelKey: 'commands.climate.copHigh', labelFallback: 'High', description: '100°F / 40°C' },
      ],
    },
  },
  {
    id: 'climate_keeper', command: 'climate_keeper_on', commandOff: 'climate_keeper_off',
    labelKey: 'commands.climate.climateKeeper', labelFallback: 'Climate Keeper',
    sublabelKey: 'commands.climate.keepMode', sublabelFallback: 'Keep',
    icon: Wind, iconOff: X, category: 'climate_protection', type: 'toggle', variant: 'success',
  },
  {
    id: 'dog_mode', command: 'dog_mode',
    labelKey: 'commands.climate.dogMode', labelFallback: 'Dog Mode',
    icon: Dog, category: 'climate_protection', type: 'action', variant: 'success',
  },
  {
    id: 'camp_mode', command: 'camp_mode',
    labelKey: 'commands.climate.campMode', labelFallback: 'Camp Mode',
    icon: Tent, category: 'climate_protection', type: 'action', variant: 'success',
  },
  {
    id: 'preconditioning_max', command: 'preconditioning_max',
    labelKey: 'commands.climate.maxPrecondition', labelFallback: 'Max Precondition',
    sublabelKey: 'commands.climate.override', sublabelFallback: 'Override',
    icon: Flame, category: 'climate_protection', type: 'action', variant: 'danger',
  },
  {
    id: 'preconditioning_reset', command: 'preconditioning_reset',
    labelKey: 'commands.climate.resetPrecondition', labelFallback: 'Reset Precondition',
    sublabelKey: 'commands.climate.default', sublabelFallback: 'Default',
    icon: Flame, category: 'climate_protection', type: 'action',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Charging — 7 entries (8 commands: 1 toggle)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'charge_port_open', command: 'charge_port_open',
    labelKey: 'commands.charging.chargePort', labelFallback: 'Charge Port',
    sublabelKey: 'commands.charging.open', sublabelFallback: 'Open',
    icon: Zap, category: 'charging', type: 'action',
  },
  {
    id: 'close_charge_port', command: 'close_charge_port',
    labelKey: 'commands.charging.chargePort', labelFallback: 'Charge Port',
    sublabelKey: 'commands.charging.close', sublabelFallback: 'Close',
    icon: Zap, category: 'charging', type: 'action',
  },
  {
    id: 'charge', command: 'charge_start', commandOff: 'charge_stop',
    labelKey: 'commands.charging.charge', labelFallback: 'Charge',
    icon: Zap, category: 'charging', type: 'toggle',
    stateField: 'is_charging', variant: 'success',
  },
  {
    id: 'charge_max_range', command: 'charge_max_range',
    labelKey: 'commands.charging.maxRange', labelFallback: 'Max Range',
    sublabelKey: 'commands.charging.tripMode', sublabelFallback: 'Trip mode',
    icon: BatteryFull, category: 'charging', type: 'action', variant: 'danger',
  },
  {
    id: 'charge_standard', command: 'charge_standard',
    labelKey: 'commands.charging.standard', labelFallback: 'Standard',
    sublabelKey: 'commands.charging.dailyMode', sublabelFallback: 'Daily mode',
    icon: BatteryMedium, category: 'charging', type: 'action', variant: 'success',
  },
  {
    id: 'set_charging_amps', command: 'set_charging_amps',
    labelKey: 'commands.charging.setAmps', labelFallback: 'Set Amps',
    sublabelKey: 'commands.charging.amperage', sublabelFallback: 'Amperage',
    icon: Gauge, category: 'charging', type: 'input',
    inputConfig: {
      promptKey: 'commands.charging.enterAmps',
      promptFallback: 'Enter charging amps (e.g., 16, 32, 48):',
      paramName: 'charging_amps',
    },
  },
  {
    id: 'set_charge_limit', command: 'set_charge_limit',
    labelKey: 'commands.charging.setLimit', labelFallback: 'Set Limit',
    sublabelKey: 'commands.charging.percent', sublabelFallback: 'Charge %',
    icon: Battery, category: 'charging', type: 'input',
    inputConfig: {
      promptKey: 'commands.charging.enterLimit',
      promptFallback: 'Enter charge limit % (50–100):',
      paramName: 'percent', defaultValue: '80',
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Doors & Trunk — 2 entries
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'frunk_open', command: 'frunk_open',
    labelKey: 'commands.doors.frunk', labelFallback: 'Frunk',
    sublabelKey: 'commands.doors.open', sublabelFallback: 'Open',
    icon: DoorOpen, category: 'doors', type: 'action', defaultFavorite: true,
  },
  {
    id: 'trunk_open', command: 'trunk_open',
    labelKey: 'commands.doors.trunk', labelFallback: 'Trunk',
    sublabelKey: 'commands.doors.open', sublabelFallback: 'Open',
    icon: DoorOpen, category: 'doors', type: 'action',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Drive — 1 entry
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'remote_start_drive', command: 'remote_start_drive',
    labelKey: 'commands.drive.remoteStart', labelFallback: 'Remote Start',
    sublabelKey: 'commands.drive.keylessDrive', sublabelFallback: 'Keyless drive',
    icon: Car, category: 'drive', type: 'action', variant: 'danger',
    dangerous: true,
    confirmKey: 'commands.drive.confirmRemoteStart',
    confirmFallback: 'This will enable keyless driving for 2 minutes. Continue?',
    countdown: 3,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Windows — 2 entries
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'vent_windows', command: 'vent_windows',
    labelKey: 'commands.windows.vent', labelFallback: 'Vent Windows',
    icon: Wind, category: 'windows', type: 'action',
  },
  {
    id: 'close_windows', command: 'close_windows',
    labelKey: 'commands.windows.close', labelFallback: 'Close Windows',
    icon: X, category: 'windows', type: 'action',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Sunroof — 3 entries
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'sunroof_vent', command: 'sunroof_vent',
    labelKey: 'commands.sunroof.vent', labelFallback: 'Sunroof',
    sublabelKey: 'commands.sunroof.ventMode', sublabelFallback: 'Vent',
    icon: ArrowUpFromDot, category: 'sunroof', type: 'action',
  },
  {
    id: 'sunroof_close', command: 'sunroof_close',
    labelKey: 'commands.sunroof.close', labelFallback: 'Sunroof',
    sublabelKey: 'commands.sunroof.closeMode', sublabelFallback: 'Close',
    icon: ArrowDownToDot, category: 'sunroof', type: 'action',
  },
  {
    id: 'sunroof_stop', command: 'sunroof_stop',
    labelKey: 'commands.sunroof.stop', labelFallback: 'Sunroof',
    sublabelKey: 'commands.sunroof.stopMode', sublabelFallback: 'Stop',
    icon: CircleStop, category: 'sunroof', type: 'action',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Schedules — 4 entries
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'add_charge_schedule', command: 'add_charge_schedule',
    labelKey: 'commands.schedules.addCharge', labelFallback: 'Add Charge Schedule',
    sublabelKey: 'commands.schedules.midnight', sublabelFallback: 'Midnight daily',
    icon: CalendarPlus, category: 'schedules', type: 'action', variant: 'success',
    params: {
      id: '0', name: 'Default', days_of_week: '127',
      start_enabled: 'true', start_time: '0',
      end_enabled: 'false', end_time: '0', one_time: 'false',
    },
  },
  {
    id: 'remove_charge_schedule', command: 'remove_charge_schedule',
    labelKey: 'commands.schedules.removeCharge', labelFallback: 'Remove Schedule',
    sublabelKey: 'commands.schedules.byId', sublabelFallback: 'By ID',
    icon: CalendarMinus, category: 'schedules', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.schedules.enterScheduleId',
      promptFallback: 'Enter schedule ID to remove:',
      paramName: 'id',
    },
  },
  {
    id: 'add_precondition_schedule', command: 'add_precondition_schedule',
    labelKey: 'commands.schedules.addPrecondition', labelFallback: 'Add Precondition',
    sublabelKey: 'commands.schedules.morning', sublabelFallback: '7 AM daily',
    icon: CalendarPlus, category: 'schedules', type: 'action', variant: 'success',
    params: {
      id: '0', name: 'Morning', days_of_week: '127',
      precondition_time: '420', one_time: 'false',
    },
  },
  {
    id: 'remove_precondition_schedule', command: 'remove_precondition_schedule',
    labelKey: 'commands.schedules.removePrecondition', labelFallback: 'Remove Precondition',
    sublabelKey: 'commands.schedules.byId', sublabelFallback: 'By ID',
    icon: CalendarMinus, category: 'schedules', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.schedules.enterScheduleId',
      promptFallback: 'Enter schedule ID to remove:',
      paramName: 'id',
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Alerts & Location — 5 entries
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'honk_horn', command: 'honk_horn',
    labelKey: 'commands.alerts.horn', labelFallback: 'Horn',
    icon: Volume2, category: 'alerts', type: 'action',
    variant: 'danger', defaultFavorite: true,
  },
  {
    id: 'flash_lights', command: 'flash_lights',
    labelKey: 'commands.alerts.flashLights', labelFallback: 'Flash Lights',
    icon: MapPin, category: 'alerts', type: 'action',
  },
  {
    id: 'boombox_fart', command: 'boombox_fart',
    labelKey: 'commands.alerts.boombox', labelFallback: 'Boombox',
    sublabelKey: 'commands.alerts.randomFart', sublabelFallback: 'Random fart',
    icon: Speaker, category: 'alerts', type: 'action',
  },
  {
    id: 'boombox_ping', command: 'boombox_ping',
    labelKey: 'commands.alerts.locatePing', labelFallback: 'Locate Ping',
    sublabelKey: 'commands.alerts.findMyCar', sublabelFallback: 'Find my car',
    icon: Locate, category: 'alerts', type: 'action',
  },
  {
    id: 'trigger_homelink', command: 'trigger_homelink',
    labelKey: 'commands.homelink.trigger', labelFallback: 'HomeLink',
    sublabelKey: 'commands.homelink.garage', sublabelFallback: 'Garage door',
    icon: Home, category: 'alerts', type: 'input',
    inputConfig: {
      promptKey: 'commands.homelink.triggerTitle',
      promptFallback: 'Enter vehicle coordinates',
      paramName: '',
      fields: [
        { name: 'lat', labelKey: 'commands.homelink.latitude', labelFallback: 'Latitude', placeholder: '37.7749', type: 'text', validation: 'decimal' as const },
        { name: 'lon', labelKey: 'commands.homelink.longitude', labelFallback: 'Longitude', placeholder: '-122.4194', type: 'text', validation: 'decimal' as const },
      ],
      buildParams: (values) => ({ lat: values.lat, lon: values.lon }),
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Navigation — 3 entries
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'navigation_request', command: 'navigation_request',
    labelKey: 'commands.nav.sendAddress', labelFallback: 'Send Address',
    sublabelKey: 'commands.nav.toVehicleNav', sublabelFallback: 'To vehicle nav',
    icon: Navigation, category: 'navigation', type: 'input',
    inputConfig: {
      promptKey: 'commands.nav.enterAddress',
      promptFallback: 'Enter destination address:',
      paramName: 'address', validation: 'text',
      buildParams: (values) => ({
        type: 'share_ext_content_raw',
        value: { 'android.intent.extra.TEXT': values.address },
        locale: 'en-US',
      }),
    },
  },
  {
    id: 'navigation_gps_request', command: 'navigation_gps_request',
    labelKey: 'commands.nav.sendGPS', labelFallback: 'Send GPS',
    sublabelKey: 'commands.nav.coordinates', sublabelFallback: 'Lat / Lon',
    icon: MapPin, category: 'navigation', type: 'input',
    inputConfig: {
      promptKey: 'commands.nav.sendGPSTitle',
      promptFallback: 'Enter GPS coordinates',
      paramName: '',
      fields: [
        { name: 'lat', labelKey: 'commands.nav.latitude', labelFallback: 'Latitude', placeholder: '37.7749', type: 'text', validation: 'decimal' as const },
        { name: 'lon', labelKey: 'commands.nav.longitude', labelFallback: 'Longitude', placeholder: '-122.4194', type: 'text', validation: 'decimal' as const },
      ],
      buildParams: (values) => ({ lat: parseFloat(values.lat), lon: parseFloat(values.lon), order: 0 }),
    },
  },
  {
    id: 'navigation_sc_request', command: 'navigation_sc_request',
    labelKey: 'commands.nav.supercharger', labelFallback: 'Supercharger',
    sublabelKey: 'commands.nav.byId', sublabelFallback: 'By ID',
    icon: Zap, category: 'navigation', type: 'input',
    inputConfig: {
      promptKey: 'commands.nav.enterScId',
      promptFallback: 'Enter Supercharger ID:',
      paramName: 'id', transform: (v) => parseInt(v, 10),
    },
    params: { order: 0 },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Software — 2 entries
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'schedule_software_update', command: 'schedule_software_update',
    labelKey: 'commands.software.scheduleUpdate', labelFallback: 'Schedule Update',
    sublabelKey: 'commands.software.installNow', sublabelFallback: 'Install now',
    icon: Download, category: 'software', type: 'input', variant: 'success',
    inputConfig: {
      promptKey: 'commands.software.enterDelay',
      promptFallback: 'Install in how many minutes? (0 = now, 120 = 2 hours)',
      paramName: 'offset_sec', defaultValue: '0',
      transform: (v) => String(parseInt(v, 10) * 60),
    },
  },
  {
    id: 'cancel_software_update', command: 'cancel_software_update',
    labelKey: 'commands.software.cancelUpdate', labelFallback: 'Cancel Update',
    sublabelKey: 'commands.software.stopPending', sublabelFallback: 'Stop pending',
    icon: XCircle, category: 'software', type: 'action', variant: 'danger',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Vehicle — 1 entry
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'set_vehicle_name', command: 'set_vehicle_name',
    labelKey: 'commands.vehicle.rename', labelFallback: 'Rename',
    sublabelKey: 'commands.vehicle.changeName', sublabelFallback: 'Change name',
    icon: Pencil, category: 'vehicle', type: 'input',
    inputConfig: {
      promptKey: 'commands.vehicle.enterName',
      promptFallback: 'Enter new vehicle name:',
      paramName: 'vehicle_name', validation: 'text',
      getDefaultValue: (ctx) => ctx.vehicle?.display_name ?? '',
      buildParams: (values) => ({ vehicle_name: values.vehicle_name.trim() }),
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Media — 7 entries
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'media_toggle_playback', command: 'media_toggle_playback',
    labelKey: 'commands.media.playPause', labelFallback: 'Play / Pause',
    icon: Play, category: 'media', type: 'action',
  },
  {
    id: 'media_prev_track', command: 'media_prev_track',
    labelKey: 'commands.media.prevTrack', labelFallback: 'Prev Track',
    icon: SkipBack, category: 'media', type: 'action',
  },
  {
    id: 'media_next_track', command: 'media_next_track',
    labelKey: 'commands.media.nextTrack', labelFallback: 'Next Track',
    icon: SkipForward, category: 'media', type: 'action',
  },
  {
    id: 'media_prev_fav', command: 'media_prev_fav',
    labelKey: 'commands.media.prevFav', labelFallback: 'Prev Favorite',
    icon: Heart, category: 'media', type: 'action',
  },
  {
    id: 'media_next_fav', command: 'media_next_fav',
    labelKey: 'commands.media.nextFav', labelFallback: 'Next Favorite',
    icon: Heart, category: 'media', type: 'action',
  },
  {
    id: 'adjust_volume', command: 'adjust_volume',
    labelKey: 'commands.media.volumeUp', labelFallback: 'Volume Up',
    icon: Volume1, category: 'media', type: 'input',
    inputConfig: {
      promptKey: 'commands.media.enterVolume',
      promptFallback: 'Enter volume level (0.0 – 11.0):',
      paramName: 'volume', defaultValue: '5',
    },
  },
  {
    id: 'media_volume_down', command: 'media_volume_down',
    labelKey: 'commands.media.volumeDown', labelFallback: 'Volume Down',
    icon: VolumeX, category: 'media', type: 'action',
  },
];

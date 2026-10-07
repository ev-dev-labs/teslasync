import type { AutomationActionKind } from '@/types/automations';

type ActionKindOption = {
  value: AutomationActionKind;
  labelKey: string;
  fallback: string;
};

export const ACTION_TYPES: ActionKindOption[] = [
  {
    value: 'action_command',
    labelKey: 'automations.actions.command',
    fallback: 'Vehicle command',
  },
  {
    value: 'action_notify',
    labelKey: 'automations.actions.notify',
    fallback: 'Send notification',
  },
  {
    value: 'action_set_setting',
    labelKey: 'automations.actions.setSetting',
    fallback: 'Set setting',
  },
  {
    value: 'action_call_automation',
    labelKey: 'automations.actions.callAutomation',
    fallback: 'Call automation',
  },
];

export const COMMAND_GROUPS: {
  labelKey: string;
  fallback: string;
  commands: { value: string; labelKey: string; fallback: string }[];
}[] = [
  {
    labelKey: 'automations.commandGroups.security',
    fallback: 'Security & access',
    commands: [
      { value: 'lock', labelKey: 'automations.commands.lock', fallback: 'Lock doors' },
      { value: 'unlock', labelKey: 'automations.commands.unlock', fallback: 'Unlock doors' },
      { value: 'sentry_on', labelKey: 'automations.commands.sentryOn', fallback: 'Sentry mode on' },
      { value: 'sentry_off', labelKey: 'automations.commands.sentryOff', fallback: 'Sentry mode off' },
      { value: 'valet_on', labelKey: 'automations.commands.valetOn', fallback: 'Valet mode on' },
      { value: 'valet_off', labelKey: 'automations.commands.valetOff', fallback: 'Valet mode off' },
    ],
  },
  {
    labelKey: 'automations.commandGroups.climate',
    fallback: 'Climate',
    commands: [
      { value: 'climate_on', labelKey: 'automations.commands.climateOn', fallback: 'Climate on' },
      { value: 'climate_off', labelKey: 'automations.commands.climateOff', fallback: 'Climate off' },
      { value: 'set_temps', labelKey: 'automations.commands.setTemps', fallback: 'Set temperature' },
      { value: 'seat_heater', labelKey: 'automations.commands.seatHeater', fallback: 'Seat heater' },
      { value: 'seat_cooler', labelKey: 'automations.commands.seatCooler', fallback: 'Seat cooler' },
      {
        value: 'steering_wheel_heat',
        labelKey: 'automations.commands.steeringWheelHeat',
        fallback: 'Steering wheel heater',
      },
      { value: 'dog_mode', labelKey: 'automations.commands.dogMode', fallback: 'Dog mode' },
      { value: 'camp_mode', labelKey: 'automations.commands.campMode', fallback: 'Camp mode' },
    ],
  },
  {
    labelKey: 'automations.commandGroups.charging',
    fallback: 'Charging',
    commands: [
      { value: 'charge_start', labelKey: 'automations.commands.chargeStart', fallback: 'Start charging' },
      { value: 'charge_stop', labelKey: 'automations.commands.chargeStop', fallback: 'Stop charging' },
      {
        value: 'set_charge_limit',
        labelKey: 'automations.commands.setChargeLimit',
        fallback: 'Set charge limit',
      },
      {
        value: 'set_charging_amps',
        labelKey: 'automations.commands.setChargingAmps',
        fallback: 'Set charging amps',
      },
      {
        value: 'open_charge_port',
        labelKey: 'automations.commands.openChargePort',
        fallback: 'Open charge port',
      },
      {
        value: 'close_charge_port',
        labelKey: 'automations.commands.closeChargePort',
        fallback: 'Close charge port',
      },
    ],
  },
  {
    labelKey: 'automations.commandGroups.doors',
    fallback: 'Doors & trunk',
    commands: [
      { value: 'frunk_open', labelKey: 'automations.commands.frunkOpen', fallback: 'Open frunk' },
      { value: 'trunk_open', labelKey: 'automations.commands.trunkOpen', fallback: 'Open trunk' },
    ],
  },
  {
    labelKey: 'automations.commandGroups.alerts',
    fallback: 'Alerts',
    commands: [
      { value: 'honk', labelKey: 'automations.commands.honk', fallback: 'Honk horn' },
      { value: 'flash', labelKey: 'automations.commands.flash', fallback: 'Flash lights' },
    ],
  },
  {
    labelKey: 'automations.commandGroups.navigation',
    fallback: 'Navigation',
    commands: [
      {
        value: 'navigation_request',
        labelKey: 'automations.commands.navigationRequest',
        fallback: 'Navigate to address',
      },
      {
        value: 'navigation_gps_request',
        labelKey: 'automations.commands.navigationGpsRequest',
        fallback: 'Navigate to GPS',
      },
      {
        value: 'trigger_homelink',
        labelKey: 'automations.commands.triggerHomelink',
        fallback: 'Trigger HomeLink',
      },
    ],
  },
  {
    labelKey: 'automations.commandGroups.driveSoftware',
    fallback: 'Drive & software',
    commands: [
      {
        value: 'remote_start_drive',
        labelKey: 'automations.commands.remoteStartDrive',
        fallback: 'Remote start',
      },
      { value: 'wake_up', labelKey: 'automations.commands.wakeUp', fallback: 'Wake up' },
    ],
  },
];

export const GUIDED_COMMAND_FIELDS: Record<string, {
  key: string;
  labelKey: string;
  fallback: string;
  min: number;
  max?: number;
}[]> = {
  set_charge_limit: [
    { key: 'percent', labelKey: 'automations.builder.chargeLimit', fallback: 'Charge limit', min: 0, max: 100 },
  ],
  set_charging_amps: [
    { key: 'charging_amps', labelKey: 'automations.builder.chargingAmps', fallback: 'Charging current (A)', min: 1 },
  ],
  set_temps: [
    { key: 'driver_temp', labelKey: 'automations.builder.driverTemp', fallback: 'Driver temperature', min: 15, max: 30 },
    { key: 'passenger_temp', labelKey: 'automations.builder.passengerTemp', fallback: 'Passenger temperature', min: 15, max: 30 },
  ],
};

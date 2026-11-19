import { Icons, type LucideIcon } from '@/lib/icons';
import { steeringWheel, windowVent } from '@/lib/commandGlyphs';
import { COMMANDS } from '../../commands';

interface CommandBoardGroup {
  id: string;
  labelKey: string;
  fallback: string;
  icon: LucideIcon;
  tone: 'accent' | 'info' | 'success' | 'warning';
  ids: readonly string[];
}

export const COMMAND_BOARD_GROUPS: readonly CommandBoardGroup[] = [
  { id: 'access', labelKey: 'commands.board.access', fallback: 'Access', icon: Icons.keyRound, tone: 'accent',
    ids: ['lock', 'sentry', 'frunk_open', 'trunk_open', 'wake_up'] },
  { id: 'climate', labelKey: 'commands.board.climate', fallback: 'Climate', icon: Icons.wind, tone: 'info',
    ids: ['set_temps', 'climate', 'seat_heater', 'seat_cooler', 'steering_wheel_heat'] },
  { id: 'charging', labelKey: 'commands.board.charging', fallback: 'Charging', icon: Icons.charger, tone: 'success',
    ids: ['set_charge_limit', 'charge', 'charge_port_open'] },
  { id: 'openings', labelKey: 'commands.board.openings', fallback: 'Windows & roof', icon: windowVent, tone: 'info',
    ids: ['vent_windows', 'close_windows', 'sunroof_vent', 'sunroof_close', 'sunroof_stop'] },
  { id: 'navigation', labelKey: 'commands.board.navigation', fallback: 'Navigation & find my car', icon: Icons.navigation, tone: 'info',
    ids: ['navigation_request', 'navigation_gps_request', 'navigation_sc_request', 'trigger_homelink', 'flash_lights', 'honk_horn', 'boombox_ping', 'boombox_fart'] },
  { id: 'driving', labelKey: 'commands.board.driving', fallback: 'Driving & guests', icon: steeringWheel, tone: 'accent',
    ids: ['speed_limit_set', 'speed_limit_on', 'speed_limit_off', 'valet_mode', 'guest_mode', 'pin_to_drive', 'remote_start_drive'] },
  { id: 'care', labelKey: 'commands.board.care', fallback: 'Cabin care', icon: Icons.climate, tone: 'info',
    ids: ['dog_mode', 'camp_mode', 'climate_keeper', 'bioweapon', 'cop_on', 'cop_fan_only', 'cop_off', 'set_cop_temp', 'preconditioning_max', 'preconditioning_reset'] },
  { id: 'media', labelKey: 'commands.board.media', fallback: 'Media', icon: Icons.media, tone: 'accent',
    ids: ['media_prev_track', 'media_toggle_playback', 'media_next_track', 'media_prev_fav', 'media_next_fav', 'adjust_volume', 'media_volume_down'] },
  { id: 'charge-options', labelKey: 'commands.board.chargeOptions', fallback: 'Charge preferences', icon: Icons.preferences, tone: 'success',
    ids: ['set_charging_amps', 'charge_standard', 'charge_max_range', 'close_charge_port'] },
  { id: 'schedules', labelKey: 'commands.board.schedules', fallback: 'Daily schedules', icon: Icons.calendarPlus, tone: 'success',
    ids: ['add_charge_schedule', 'remove_charge_schedule', 'add_precondition_schedule', 'remove_precondition_schedule'] },
  { id: 'vehicle', labelKey: 'commands.board.vehicle', fallback: 'Vehicle settings', icon: Icons.settings, tone: 'accent',
    ids: ['set_vehicle_name', 'schedule_software_update', 'cancel_software_update'] },
  { id: 'security', labelKey: 'commands.board.security', fallback: 'Security settings', icon: Icons.security, tone: 'warning',
    ids: ['speed_limit_clear_pin', 'speed_limit_clear_pin_admin', 'reset_valet_pin', 'reset_pin_to_drive_pin', 'clear_pin_to_drive_admin', 'erase_user_data'] },
];

const byId = new Map(COMMANDS.map(definition => [definition.id, definition]));
export const COMMAND_BOARD = COMMAND_BOARD_GROUPS.map((group, index) => ({
  ...group,
  lead: index < 3,
  commands: group.ids.map(id => {
    const definition = byId.get(id);
    if (!definition) throw new Error(`Unknown board command: ${id}`);
    return definition;
  }),
}));

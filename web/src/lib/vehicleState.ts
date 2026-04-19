import { parseWindowState as parseWindowEnum } from './parseEnums';
import type { SecurityEvent, ChargingTelemetry } from '@/api/types';
import type { VehicleLiveState } from '@/hooks/useVehicleLive';

// ── Door State Parser ──────────────────────────────────────────────────

export interface DoorStates {
  driverFront: boolean | null;
  passengerFront: boolean | null;
  driverRear: boolean | null;
  passengerRear: boolean | null;
  trunkFront: boolean | null;
  trunkRear: boolean | null;
}

const UNKNOWN_DOORS: DoorStates = {
  driverFront: null,
  passengerFront: null,
  driverRear: null,
  passengerRear: null,
  trunkFront: null,
  trunkRear: null,
};

/**
 * Parses the compound DoorState signal from Tesla telemetry.
 * Handles JSON objects, simple enum strings, and descriptive values.
 * Returns null for each unknown field rather than defaulting to closed.
 */
export function parseDoorState(doorState: string | null | undefined): DoorStates {
  if (!doorState) return { ...UNKNOWN_DOORS };

  const trimmed = doorState.trim();
  if (!trimmed) return { ...UNKNOWN_DOORS };

  // Check for "all closed" shorthand values
  const lower = trimmed.toLowerCase();
  if (lower === 'closedall' || lower === 'closed' || lower === '0' || lower === 'false') {
    return {
      driverFront: false,
      passengerFront: false,
      driverRear: false,
      passengerRear: false,
      trunkFront: null,
      trunkRear: null,
    };
  }

  // Try JSON parse (compound signal format)
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        driverFront: parsed.DriverFront != null ? Boolean(parsed.DriverFront) : (parsed.driver_front != null ? Boolean(parsed.driver_front) : null),
        passengerFront: parsed.PassengerFront != null ? Boolean(parsed.PassengerFront) : (parsed.passenger_front != null ? Boolean(parsed.passenger_front) : null),
        driverRear: parsed.DriverRear != null ? Boolean(parsed.DriverRear) : (parsed.driver_rear != null ? Boolean(parsed.driver_rear) : null),
        passengerRear: parsed.PassengerRear != null ? Boolean(parsed.PassengerRear) : (parsed.passenger_rear != null ? Boolean(parsed.passenger_rear) : null),
        trunkFront: parsed.TrunkFront != null ? Boolean(parsed.TrunkFront) : (parsed.trunk_front != null ? Boolean(parsed.trunk_front) : null),
        trunkRear: parsed.TrunkRear != null ? Boolean(parsed.TrunkRear) : (parsed.trunk_rear != null ? Boolean(parsed.trunk_rear) : null),
      };
    } catch {
      // Fall through to string matching
    }
  }

  // String matching for descriptive values (e.g. "OpenDriverFront")
  return {
    driverFront: lower.includes('driver') && lower.includes('front') ? true : null,
    passengerFront: lower.includes('passenger') && lower.includes('front') ? true : null,
    driverRear: (lower.includes('driver') && lower.includes('rear')) || lower.includes('driverrear') ? true : null,
    passengerRear: (lower.includes('passenger') && lower.includes('rear')) || lower.includes('passengerrear') ? true : null,
    trunkFront: null,
    trunkRear: null,
  };
}

// ── Window State Parser ────────────────────────────────────────────────

export type WindowState = 'open' | 'closed' | 'partial' | null;

/**
 * Normalizes Tesla window enum values to display state.
 * Uses the centralized parseWindowEnum from parseEnums.ts.
 */
export function parseWindowState(state: string | null | undefined): WindowState {
  if (!state) return null;
  const clean = parseWindowEnum(state);
  if (clean === 'Closed') return 'closed';
  if (clean === 'Partial') return 'partial';
  if (clean === 'Open') return 'open';
  // Fallback heuristics
  const lower = state.toLowerCase();
  if (lower.includes('closed') || lower === '0') return 'closed';
  if (lower.includes('partial') || lower.includes('vent')) return 'partial';
  if (lower.includes('open')) return 'open';
  return null;
}

// ── Turn Signal Parser ─────────────────────────────────────────────────

export type TurnSignalState = 'left' | 'right' | 'both' | 'off' | null;

export function parseTurnSignal(signal: string | null | undefined): TurnSignalState {
  if (!signal) return null;
  const lower = signal.toLowerCase().replace(/turnsignal/i, '');
  if (lower.includes('both')) return 'both';
  if (lower.includes('left')) return 'left';
  if (lower.includes('right')) return 'right';
  if (lower.includes('off') || lower === '' || lower === '0') return 'off';
  return null;
}

// ── Combined Twin State ────────────────────────────────────────────────

export interface VehicleTwinState {
  doors: DoorStates;
  windowFD: WindowState;
  windowFP: WindowState;
  windowRD: WindowState;
  windowRP: WindowState;
  frunkOpen: boolean | null;
  trunkOpen: boolean | null;
  chargePortOpen: boolean | null;
  isCharging: boolean;
  locked: boolean | null;
  sentryMode: boolean | null;
  headlights: boolean | null;
  hazards: boolean | null;
  turnSignal: TurnSignalState;
  driverSeatOccupied: boolean | null;
  vehicleColor: string;
  lastUpdated: string | Date | null;
}

const EMPTY_TWIN_STATE: VehicleTwinState = {
  doors: { ...UNKNOWN_DOORS },
  windowFD: null,
  windowFP: null,
  windowRD: null,
  windowRP: null,
  frunkOpen: null,
  trunkOpen: null,
  chargePortOpen: null,
  isCharging: false,
  locked: null,
  sentryMode: null,
  headlights: null,
  hazards: null,
  turnSignal: null,
  driverSeatOccupied: null,
  vehicleColor: '',
  lastUpdated: null,
};

/**
 * Merges SecurityEvent + VehicleState + ChargingTelemetry into a single
 * view-model for the VehicleTwin component.
 */
export function buildTwinState(
  security: SecurityEvent | null | undefined,
  vehicleState: { is_charging?: boolean; is_locked?: boolean; sentry_mode?: boolean } | null | undefined,
  charging: ChargingTelemetry | null | undefined,
): VehicleTwinState {
  if (!security && !vehicleState) return { ...EMPTY_TWIN_STATE };
  const doors = parseDoorState(security?.door_state);
  return {
    doors,
    windowFD: parseWindowState(security?.fd_window),
    windowFP: parseWindowState(security?.fp_window),
    windowRD: parseWindowState(security?.rd_window),
    windowRP: parseWindowState(security?.rp_window),
    frunkOpen: doors.trunkFront,
    trunkOpen: doors.trunkRear,
    chargePortOpen: charging?.charge_port_door_open ?? null,
    isCharging: vehicleState?.is_charging ?? false,
    locked: security?.locked ?? vehicleState?.is_locked ?? null,
    sentryMode: security?.sentry_mode ?? vehicleState?.sentry_mode ?? null,
    headlights: security?.lights_high_beams ?? null,
    hazards: security?.lights_hazards_active ?? null,
    turnSignal: parseTurnSignal(security?.lights_turn_signal),
    driverSeatOccupied: security?.driver_seat_occupied ?? null,
    vehicleColor: '',
    lastUpdated: security?.created_at ?? null,
  };
}

/** Adapt VehicleLiveState (SSE) into VehicleTwinState */
export function mapLiveToTwinState(live: VehicleLiveState): VehicleTwinState {
  const doors = parseDoorState(live.doorState);
  return {
    doors,
    windowFD: parseWindowState(live.fdWindow),
    windowFP: parseWindowState(live.fpWindow),
    windowRD: parseWindowState(live.rdWindow),
    windowRP: parseWindowState(live.rpWindow),
    frunkOpen: doors.trunkFront,
    trunkOpen: doors.trunkRear,
    chargePortOpen: null,
    isCharging: live.isCharging,
    locked: live.locked,
    sentryMode: live.sentryMode,
    headlights: live.lightsHighBeams,
    hazards: live.lightsHazards,
    turnSignal: parseTurnSignal(live.lightsTurnSignal),
    driverSeatOccupied: live.driverSeatOccupied,
    vehicleColor: live.exteriorColor,
    lastUpdated: live.lastUpdated,
  };
}

/** Adapt camelCase SecurityEvent (from @/types/admin) into VehicleTwinState */
export function buildTwinStateFromAdmin(
  ev: {
    doorState?: string | null;
    fdWindow?: string | null;
    fpWindow?: string | null;
    rdWindow?: string | null;
    rpWindow?: string | null;
    locked?: boolean | null;
    sentryMode?: boolean | null;
    lightsHazardsActive?: boolean | null;
    lightsHighBeams?: boolean | null;
    lightsTurnSignal?: string | null;
    driverSeatOccupied?: boolean | null;
    createdAt?: string;
  } | null | undefined,
): VehicleTwinState {
  if (!ev) return { ...EMPTY_TWIN_STATE };
  const doors = parseDoorState(ev.doorState);
  return {
    doors,
    windowFD: parseWindowState(ev.fdWindow),
    windowFP: parseWindowState(ev.fpWindow),
    windowRD: parseWindowState(ev.rdWindow),
    windowRP: parseWindowState(ev.rpWindow),
    frunkOpen: doors.trunkFront,
    trunkOpen: doors.trunkRear,
    chargePortOpen: null,
    isCharging: false,
    locked: ev.locked ?? null,
    sentryMode: ev.sentryMode ?? null,
    headlights: ev.lightsHighBeams ?? null,
    hazards: ev.lightsHazardsActive ?? null,
    turnSignal: parseTurnSignal(ev.lightsTurnSignal),
    driverSeatOccupied: ev.driverSeatOccupied ?? null,
    vehicleColor: '',
    lastUpdated: ev.createdAt ?? null,
  };
}

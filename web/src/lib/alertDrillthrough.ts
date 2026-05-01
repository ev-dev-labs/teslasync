/**
 * alertDrillthrough — map an Alert (from `useAlerts`) to a navigable URL on the
 * relevant context page so the user can investigate what triggered it.
 *
 * Phase 40 / Prompt 14. The backend stamps each alert with `rule_signal`
 * (e.g. "BatteryLevel"), `vehicle_id`, and `created_at`; we look up the signal
 * in `SIGNAL_TO_PAGE` to pick the destination page and forward the context
 * (vehicle, timestamp, signal) as query params. Pages opt-in to centering their
 * charts on the alert via `useAlertContext()` + `<TimeMarker>`.
 *
 * If the signal isn't mapped (custom rule, deleted rule, etc.) we fall back to
 * the generic Signal Explorer page which can plot any signal name.
 */

import type { Alert } from '@/api/types';

export interface DrillthroughTarget {
  /** Route path WITHOUT query string, e.g. "/battery". */
  path: string;
  /** Query parameters to append. `vehicle_id`, `t`, `signal` are conventional. */
  query: Record<string, string>;
}

/**
 * Map of telemetry signal names → destination page route. The keys mirror the
 * `signal_name` column on `alert_rules` (Tesla Fleet Telemetry signal names,
 * which are PascalCase). Routes match `App.tsx`.
 *
 * Keep this list aligned with the routes registered in `web/src/App.tsx`.
 * Unknown signals fall through to the Signal Explorer (`/signal-explorer`).
 */
export const SIGNAL_TO_PAGE: Record<string, string> = {
  // Battery
  BatteryLevel:        '/battery',
  RatedRange:          '/battery',
  ChargeLimitSoc:      '/battery',
  EstBatteryRange:     '/battery',
  IdealBatteryRange:   '/battery',

  // Charging
  ChargeState:         '/charging',
  DetailedChargeState: '/charging',
  DCChargingPower:     '/charging',
  ACChargingPower:     '/charging',
  ChargeAmps:          '/charging',
  ChargerVoltage:      '/charging',
  ChargerActualCurrent: '/charging',
  ChargingCableType:   '/charging',

  // Driving
  Gear:                '/drives',
  VehicleSpeed:        '/drives',
  Power:               '/drives',
  Odometer:            '/drives',

  // Climate
  InsideTemp:          '/climate-control',
  OutsideTemp:         '/climate-control',
  HvacPower:           '/climate-control',
  ClimateKeeperMode:   '/climate-control',

  // Tire pressure
  TpmsPressureFl:      '/tire-pressure',
  TpmsPressureFr:      '/tire-pressure',
  TpmsPressureRl:      '/tire-pressure',
  TpmsPressureRr:      '/tire-pressure',
  TpmsHardWarnings:    '/tire-pressure',
  TpmsSoftWarnings:    '/tire-pressure',
  TpmsLastSeenPressureTimeFl: '/tire-pressure',
  TpmsLastSeenPressureTimeFr: '/tire-pressure',
  TpmsLastSeenPressureTimeRl: '/tire-pressure',
  TpmsLastSeenPressureTimeRr: '/tire-pressure',

  // Security / access
  Locked:              '/security-access',
  SentryMode:          '/security-access',
  DoorState:           '/security-access',
  WindowState:         '/security-access',
  SunroofInstalled:    '/security-access',

  // Software
  SoftwareUpdateVersion: '/software-updates',
  SoftwareUpdateDownloadPercentComplete: '/software-updates',
  SoftwareUpdateInstallationPercentComplete: '/software-updates',
  SoftwareUpdateExpectedDurationMinutes: '/software-updates',

  // Location / navigation
  LocatedAtHome:       '/navigation',
  LocatedAtWork:       '/navigation',
  LocatedAtFavorite:   '/navigation',
  DestinationName:     '/navigation',
  DestinationLocation: '/navigation',
};

/** Generic fallback when no signal-specific page is registered. */
export const SIGNAL_EXPLORER_FALLBACK = '/signal-explorer';

/**
 * Compute the drill-through target for an alert. Returns the destination page
 * + query params describing the alert context.
 *
 * Convention for query keys (read by `useAlertContext()`):
 *   - `vehicle_id` — preselect this vehicle on the destination page
 *   - `t`          — ISO timestamp; chart time-window centers here ±30 min
 *   - `signal`     — focus the chart on this signal when the page renders many
 */
export function getAlertDrillthrough(alert: Alert): DrillthroughTarget {
  const signal = alert.rule_signal ?? null;
  // vehicle_id may be 0 when the rule was un-scoped; treat 0 as "no vehicle".
  const vehicleId = alert.vehicle_id && alert.vehicle_id > 0 ? alert.vehicle_id : null;
  const ts = alert.created_at;

  const query: Record<string, string> = {};
  if (vehicleId != null) query.vehicle_id = String(vehicleId);
  if (ts) query.t = ts;
  if (signal) query.signal = signal;

  if (signal && SIGNAL_TO_PAGE[signal]) {
    return { path: SIGNAL_TO_PAGE[signal], query };
  }
  return { path: SIGNAL_EXPLORER_FALLBACK, query };
}

/** Convenience wrapper that returns a single href string ready for `<Link to=>`. */
export function getAlertDrillthroughHref(alert: Alert): string {
  const { path, query } = getAlertDrillthrough(alert);
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}

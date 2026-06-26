// Native parity port of web/src/lib/alertDrillthrough.ts.
//
// Pure routing/utility logic that maps an Alert to a navigable drill-through
// target (destination route + context query params). There is no DOM, React,
// Recharts, Leaflet, or web-UI dependency in the source, so the data
// (DrillthroughTarget, SIGNAL_TO_PAGE, SIGNAL_EXPLORER_FALLBACK) and the two
// functions (getAlertDrillthrough, getAlertDrillthroughHref) port faithfully.
//
// Web -> native adaptations (conversion contract rules 4 & 7):
//   * `import type { Alert } from '@/api/types'` -> the already-ported native
//     web-parity types (`../api/types`), whose Alert mirrors the web shape
//     including `rule_signal` / `vehicle_id` / `created_at` (the same import the
//     sibling AlertCard.tsx native port uses).
//   * `new URLSearchParams(query).toString()` -> an inline
//     application/x-www-form-urlencoded encoder (`encodeFormComponent`). The
//     React Native (Hermes) runtime does not ship a complete `URLSearchParams`,
//     so — matching the value-identical inline builder already used by the
//     native AlertCard.tsx port — we encode each key/value with
//     `encodeURIComponent` and map `%20` -> `+`. For the conventional
//     vehicle_id / ISO-timestamp / signal values this is byte-for-byte identical
//     to URLSearchParams (space -> '+', ':' -> '%3A', insertion order preserved).
//
// The route paths in SIGNAL_TO_PAGE are preserved verbatim from the web App.tsx
// routes so the produced href stays parity-identical; native navigation consumes
// the same href string the web <Link to=> consumed.

import type { Alert } from '../api/types';

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
  BatteryLevel: '/battery',
  RatedRange: '/battery',
  ChargeLimitSoc: '/battery',
  EstBatteryRange: '/battery',
  IdealBatteryRange: '/battery',

  // Charging
  ChargeState: '/charging',
  DetailedChargeState: '/charging',
  DCChargingPower: '/charging',
  ACChargingPower: '/charging',
  ChargeAmps: '/charging',
  ChargerVoltage: '/charging',
  ChargerActualCurrent: '/charging',
  ChargingCableType: '/charging',

  // Driving
  Gear: '/drives',
  VehicleSpeed: '/drives',
  Power: '/drives',
  Odometer: '/drives',

  // Climate
  InsideTemp: '/climate-control',
  OutsideTemp: '/climate-control',
  HvacPower: '/climate-control',
  ClimateKeeperMode: '/climate-control',

  // Tire pressure
  TpmsPressureFl: '/tire-pressure',
  TpmsPressureFr: '/tire-pressure',
  TpmsPressureRl: '/tire-pressure',
  TpmsPressureRr: '/tire-pressure',
  TpmsHardWarnings: '/tire-pressure',
  TpmsSoftWarnings: '/tire-pressure',
  TpmsLastSeenPressureTimeFl: '/tire-pressure',
  TpmsLastSeenPressureTimeFr: '/tire-pressure',
  TpmsLastSeenPressureTimeRl: '/tire-pressure',
  TpmsLastSeenPressureTimeRr: '/tire-pressure',

  // Security / access
  Locked: '/security-access',
  SentryMode: '/security-access',
  DoorState: '/security-access',
  WindowState: '/security-access',
  SunroofInstalled: '/security-access',

  // Software
  SoftwareUpdateVersion: '/software-updates',
  SoftwareUpdateDownloadPercentComplete: '/software-updates',
  SoftwareUpdateInstallationPercentComplete: '/software-updates',
  SoftwareUpdateExpectedDurationMinutes: '/software-updates',

  // Location / navigation
  LocatedAtHome: '/navigation',
  LocatedAtWork: '/navigation',
  LocatedAtFavorite: '/navigation',
  DestinationName: '/navigation',
  DestinationLocation: '/navigation',
};

/** Generic fallback when no signal-specific page is registered. */
export const SIGNAL_EXPLORER_FALLBACK = '/signal-explorer';

/**
 * application/x-www-form-urlencoded component encoder. Native-safe replacement
 * for `new URLSearchParams(query).toString()` (the Hermes runtime lacks a
 * complete URLSearchParams). Matches URLSearchParams for the conventional
 * vehicle_id / ISO-timestamp / signal values (space -> '+', ':' -> '%3A', …).
 */
function encodeFormComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

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
  const vehicleId =
    alert.vehicle_id && alert.vehicle_id > 0 ? alert.vehicle_id : null;
  const ts = alert.created_at;

  const query: Record<string, string> = {};
  if (vehicleId != null) {
    query.vehicle_id = String(vehicleId);
  }
  if (ts) {
    query.t = ts;
  }
  if (signal) {
    query.signal = signal;
  }

  if (signal && SIGNAL_TO_PAGE[signal]) {
    return { path: SIGNAL_TO_PAGE[signal], query };
  }
  return { path: SIGNAL_EXPLORER_FALLBACK, query };
}

/** Convenience wrapper that returns a single href string ready for navigation. */
export function getAlertDrillthroughHref(alert: Alert): string {
  const { path, query } = getAlertDrillthrough(alert);
  const search = Object.keys(query)
    .map(k => `${encodeFormComponent(k)}=${encodeFormComponent(query[k])}`)
    .join('&');
  return search ? `${path}?${search}` : path;
}

/**
 * Frontend view-models for the visited-locations and geofence features.
 *
 * These are the legacy *camelCase* shapes. The current backend wire bodies are
 * snake_case (`VisitedLocation` / `Geofence` in `@/api/types.ts`); the two are
 * reconciled at runtime by `camelCaseKeys` (`@/lib/resilience`), which keeps
 * BOTH casings on the response object, so consumers reading either form work
 * today. Unit-suffixed fields here are already SI-canonical (`totalDurationS`
 * in seconds) — do not reintroduce `_min`/`_mi`/`_mph`/`_kwh` variants. Convert
 * to the user's preferred unit only at the render boundary via `useUnits()`.
 */

/** A place a vehicle has repeatedly visited, ranked by visit frequency. */
export interface Location {
  /** Stable identifier for the visited place. */
  id: string;
  /** Human-readable address/label, e.g. "Home". */
  addressName: string;
  latitude: number;
  longitude: number;
  /** Number of recorded visits. */
  visitCount: number;
  /** Total dwell time across all visits, in SI seconds (never minutes). */
  totalDurationS: number;
  /** ISO-8601 timestamp of the most recent visit, or `null` if never visited. */
  lastVisited: string | null;
}

/** A user-defined circular geofence (centroid + bounding radius in meters). */
export interface Geofence {
  /** Stable identifier for the geofence. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Bounding radius of the geofence, in meters. */
  radius: number;
  /** Fire an alert when a vehicle enters the geofence. */
  alertOnEntry: boolean;
  /** Fire an alert when a vehicle exits the geofence. */
  alertOnExit: boolean;
  /** Whether the geofence is currently active. */
  enabled: boolean;
  /** Charging tariff for this location in $/kWh, or `null` when unset. */
  costPerKwh: number | null;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

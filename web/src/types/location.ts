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

/** How a geofence came to exist (charging-place pricing feature). */
export type GeofenceOrigin = 'manual' | 'charging_discovery';

/** Optional category tag a geofence may carry. */
export type GeofenceCategory = 'home' | 'work' | 'restricted' | 'custom';

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
  /**
   * How this place came to exist: user-created, or auto-discovered off a
   * confirmed charging session's coordinates. Existing manual geofences
   * predate this field and still resolve to `'manual'`.
   */
  origin: GeofenceOrigin;
  /**
   * True while an auto-discovered place awaits a human to confirm its
   * name/type/location — surfaced as the "Needs Setup" queue in the
   * Charging Places workspace.
   */
  needsReview: boolean;
  /** Optional category tag; absent (not merely `null`) when unset — mirrors the backend's `omitempty`. */
  category?: GeofenceCategory | null;
  /**
   * ISO-8601 archive timestamp; absent while active. An archived place is
   * excluded from default active listings but stays resolvable by id for
   * historical charging-session display (never hard-deleted once it has
   * sessions or rates attached).
   */
  archivedAt?: string | null;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

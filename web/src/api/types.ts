/**
 * @module api/types
 *
 * Every exported interface and type alias used across the API layer.
 *
 * === SI Unit Conventions (Phase-43 / Prompt 0011) ===
 *
 * Field names carry their unit as a suffix. Fields marked `(SI)` are stored
 * and transported in canonical SI (or derived-SI) form; the frontend
 * unit-conversion layer (`@/lib/unitConversion`) is the only place that
 * converts to user-display units.
 *
 *   `_m`        -> meters                    (SI: length)
 *   `_km`       -> kilometers                (derived SI)
 *   `_c`        -> degrees Celsius           (SI: temperature)
 *   `_pa`       -> pascals                   (SI: pressure)
 *   `_kg`       -> kilograms                 (SI: mass)
 *   `_kwh`      -> kilowatt-hours            (derived SI: energy)
 *   `_kw`       -> kilowatts                 (derived SI: power)
 *   `_wh_km`    -> watt-hours per kilometer  (derived SI: energy intensity)
 *   `_v` /
 *   `_voltage`  -> volts                     (derived SI: electric potential)
 *   `_amps`     -> amperes                   (SI: electric current)
 *   `_nm`       -> newton-meters             (derived SI: torque)
 *   `_rpm`      -> revolutions per minute    (NON-SI; angular velocity)
 *   `_sec`      -> seconds                   (SI: time)
 *   `_ms`       -> milliseconds              (derived SI: time)
 *
 * NON-SI suffixes (legacy / display-only): `_mi`, `_mph`, `_psi`, `_f`,
 * `_min`, `_hr`. These mirror Go struct fields in source units; the API
 * does NOT convert them — `lib/unitConversion.ts` does on the boundary.
 *
 * Rule of thumb: any field tagged `(SI)` in JSDoc below is safe to feed
 * directly into `metersToKm()` / `celsiusToF()` / `pascalsToPsi()` etc.
 *
 * Mirrors Go structs under `internal/api/*`, `internal/models/*`, and
 * `internal/tesla/protomodel/*`.
 */


// AUTO-SPLIT barrel (P2 #3). Real declarations live under ./types/*.
export * from './types/admin-system'
export * from './types/analytics'
export * from './types/auth'
export * from './types/automation'
export * from './types/core'
export * from './types/notifications'
export * from './types/signals'
export * from './types/vehicle-extras'

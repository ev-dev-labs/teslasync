/** Types for the shareable drive reports feature. */

export interface ShareToken {
  id: number;
  token: string;
  drive_id: number;
  created_by: string | null;
  title: string | null;
  description: string | null;
  include_map: boolean;
  include_telemetry: boolean;
  include_speed: boolean;
  views: number;
  expires_at: string | null;
  created_at: string;
}

export interface SharedDriveInfo {
  date: string;
  distance_m: number;
  duration_s: number;
  start_address: string;
  end_address: string;
  start_battery: number | null;
  end_battery: number | null;
  elevation_gain: number | null;
  elevation_loss: number | null;
  max_speed_mps: number | null;
  avg_speed_mps: number | null;
  efficiency_wh_per_m: number | null;
}

export interface SharedVehicle {
  model: string;
  color: string;
}

export interface SharedMapPoint {
  lat: number;
  lng: number;
}

export interface SharedElevationPoint {
  distance_m: number;
  elevation_m: number;
}

export interface SharedSpeedPoint {
  distance_m: number;
  speed_mps: number;
}

export interface SharedTelemetryPoint {
  distance_m: number;
  battery_level: number | null;
  power: number | null;
  elevation: number | null;
}

export interface SharedDriveData {
  payload_version: 'v2' | 'v1';
  title: string;
  description: string;
  drive: SharedDriveInfo;
  vehicle: SharedVehicle | null;
  map_points: SharedMapPoint[] | null;
  elevation_profile: SharedElevationPoint[] | null;
  speed_profile: SharedSpeedPoint[] | null;
  telemetry: SharedTelemetryPoint[] | null;
}

export interface CreateShareRequest {
  title?: string;
  description?: string;
  include_speed?: boolean;
  include_telemetry?: boolean;
  expires_in_days?: number;
}

export interface CreateShareResponse {
  token: string;
  url: string;
  id: number;
}


export interface SharedDriveDataV1 {
  title: string;
  description: string;
  drive: {
    date: string;
    distance_km: number;
    duration_min: number;
    start_address: string;
    end_address: string;
    start_battery: number | null;
    end_battery: number | null;
    elevation_gain: number | null;
    elevation_loss: number | null;
    max_speed_kmh: number | null;
    avg_speed_kmh: number | null;
    efficiency_wh_km: number | null;
  };
  vehicle: SharedVehicle | null;
  map_points: SharedMapPoint[] | null;
  elevation_profile: { distance_km: number; elevation_m: number }[] | null;
  speed_profile: { distance_km: number; speed_kmh: number }[] | null;
  telemetry: { distance_km: number; battery_level: number | null; power: number | null; elevation: number | null }[] | null;
}

/* ------------------------------------------------------------------ */
/*  Wire-shape discrimination + SI normalisation                      */
/* ------------------------------------------------------------------ */

// Factors for upgrading a legacy v1 payload (kilometres / minutes /
// km·h⁻¹ / Wh·km⁻¹) to the canonical SI shape (metres / seconds /
// m·s⁻¹ / Wh·m⁻¹). Display-unit conversion is a separate concern that
// happens later, at the render boundary via useUnits()/unitConversion.
const METERS_PER_KM = 1000;
const SECONDS_PER_MINUTE = 60;
const KMH_PER_MPS = 3.6;

/**
 * Type guard: `true` when `data` is the canonical SI `SharedDriveData`.
 *
 * The SI wire shape always carries a `payload_version` discriminator
 * (`'v2'` today, historically `'v1'`); the legacy `SharedDriveDataV1`
 * never does. Presence of the field — not its value — is the discriminator,
 * so a v1-*tagged* SI payload is still recognised as canonical and left
 * untouched instead of being re-run through the km→m converters (which
 * would read its absent km fields as `undefined` → `NaN`).
 *
 * Null-safe: `null`/`undefined` are never canonical (the bare `in`
 * operator throws on `null`).
 */
export function isCanonicalSharedDrive(
  data: SharedDriveData | SharedDriveDataV1 | null | undefined,
): data is SharedDriveData {
  return data != null && 'payload_version' in data;
}

/**
 * Type guard: `true` when `data` is the legacy pre-SI `SharedDriveDataV1`
 * (kilometre/minute wire units, no `payload_version` discriminator).
 */
export function isLegacySharedDrive(
  data: SharedDriveData | SharedDriveDataV1 | null | undefined,
): data is SharedDriveDataV1 {
  return data != null && !('payload_version' in data);
}

/**
 * Normalises any shared-drive payload to the canonical SI `SharedDriveData`
 * shape so every consumer reads metres / seconds / m·s⁻¹ / Wh·m⁻¹ and
 * converts to display units exactly once, at the render boundary.
 *
 * - `null`/`undefined` → `undefined` (nothing to render).
 * - An already-canonical payload is returned by reference, untouched.
 * - A legacy v1 payload is upgraded: km→m, min→s, km·h⁻¹→m·s⁻¹,
 *   Wh·km⁻¹→Wh·m⁻¹, with the elevation/speed/telemetry profiles re-based to
 *   SI. Nullable scalars stay `null` (never coerced to `NaN`); absent
 *   profile arrays normalise to `[]` so consumers can `.map`/`.length`
 *   without a guard.
 */
export function normalizeSharedDriveData(
  data: SharedDriveData | SharedDriveDataV1 | null | undefined,
): SharedDriveData | undefined {
  if (data == null) return undefined;
  if (isCanonicalSharedDrive(data)) return data;

  const v1 = data;
  return {
    payload_version: 'v1',
    title: v1.title,
    description: v1.description,
    drive: {
      date: v1.drive.date,
      distance_m: v1.drive.distance_km * METERS_PER_KM,
      duration_s: Math.round(v1.drive.duration_min * SECONDS_PER_MINUTE),
      start_address: v1.drive.start_address,
      end_address: v1.drive.end_address,
      start_battery: v1.drive.start_battery,
      end_battery: v1.drive.end_battery,
      elevation_gain: v1.drive.elevation_gain,
      elevation_loss: v1.drive.elevation_loss,
      max_speed_mps: v1.drive.max_speed_kmh == null ? null : v1.drive.max_speed_kmh / KMH_PER_MPS,
      avg_speed_mps: v1.drive.avg_speed_kmh == null ? null : v1.drive.avg_speed_kmh / KMH_PER_MPS,
      efficiency_wh_per_m: v1.drive.efficiency_wh_km == null ? null : v1.drive.efficiency_wh_km / METERS_PER_KM,
    },
    vehicle: v1.vehicle,
    map_points: v1.map_points,
    elevation_profile: (v1.elevation_profile ?? []).map((p) => ({
      distance_m: p.distance_km * METERS_PER_KM,
      elevation_m: p.elevation_m,
    })),
    speed_profile: (v1.speed_profile ?? []).map((p) => ({
      distance_m: p.distance_km * METERS_PER_KM,
      speed_mps: p.speed_kmh / KMH_PER_MPS,
    })),
    telemetry: (v1.telemetry ?? []).map((p) => ({
      distance_m: p.distance_km * METERS_PER_KM,
      battery_level: p.battery_level,
      power: p.power,
      elevation: p.elevation,
    })),
  };
}

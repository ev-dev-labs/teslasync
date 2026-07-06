/**
 * sharing.ts — wire-shape discrimination + SI normalisation tests.
 *
 * `types/sharing.ts` owns the public shared-drive report contract plus the
 * three runtime helpers every consumer of a `/share/{token}` payload relies
 * on:
 *
 *   - isCanonicalSharedDrive — null-safe guard; `true` only for the SI
 *     `SharedDriveData` shape (identified by the *presence* of
 *     `payload_version`, not its value).
 *   - isLegacySharedDrive    — null-safe guard; `true` only for the pre-SI
 *     `SharedDriveDataV1` km/min shape.
 *   - normalizeSharedDriveData — upgrades any payload to canonical SI so the
 *     renderer converts to display units exactly once. Canonical payloads
 *     pass through by reference; legacy payloads are converted
 *     (km→m, min→s, km·h⁻¹→m·s⁻¹, Wh·km⁻¹→Wh·m⁻¹) with nullable scalars
 *     preserved and absent profile arrays normalised to `[]`.
 *
 * This is a pure-logic module (no React), so it is exercised directly with
 * Vitest — @testing-library/react has nothing to render here. The fixtures
 * mirror the shapes used by useSharing.test.tsx / SharedDrivePage.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import {
  isCanonicalSharedDrive,
  isLegacySharedDrive,
  normalizeSharedDriveData,
} from './sharing';
import type { SharedDriveData, SharedDriveDataV1 } from './sharing';

function makeV2(
  overrides: Partial<SharedDriveData> = {},
  driveOverrides: Partial<SharedDriveData['drive']> = {},
): SharedDriveData {
  return {
    payload_version: 'v2',
    title: 'SF to LA',
    description: 'Road trip',
    drive: {
      date: '2025-06-01T08:00:00Z',
      distance_m: 617_000,
      duration_s: 21_600,
      start_address: 'San Francisco, CA',
      end_address: 'Los Angeles, CA',
      start_battery: 92,
      end_battery: 18,
      elevation_gain: 1_200,
      elevation_loss: 1_150,
      max_speed_mps: 34.5,
      avg_speed_mps: 28.6,
      efficiency_wh_per_m: 0.17,
      ...driveOverrides,
    },
    vehicle: { model: 'Model 3', color: 'Red' },
    map_points: [{ lat: 37.77, lng: -122.41 }],
    elevation_profile: [{ distance_m: 0, elevation_m: 12 }],
    speed_profile: [{ distance_m: 0, speed_mps: 0 }],
    telemetry: [{ distance_m: 0, battery_level: 92, power: 0, elevation: 12 }],
    ...overrides,
  };
}

function makeLegacy(
  overrides: Partial<SharedDriveDataV1> = {},
  driveOverrides: Partial<SharedDriveDataV1['drive']> = {},
): SharedDriveDataV1 {
  return {
    title: 'Legacy Trip',
    description: 'Old format',
    drive: {
      date: '2024-06-15',
      distance_km: 5,
      duration_min: 10,
      start_address: 'Portland',
      end_address: 'Salem',
      start_battery: 90,
      end_battery: 70,
      elevation_gain: 120,
      elevation_loss: 60,
      max_speed_kmh: 108,
      avg_speed_kmh: 72,
      efficiency_wh_km: 150,
      ...driveOverrides,
    },
    vehicle: { model: 'Model Y', color: 'Pearl White' },
    map_points: [{ lat: 45.5, lng: -122.6 }],
    elevation_profile: [
      { distance_km: 0, elevation_m: 50 },
      { distance_km: 1, elevation_m: 80 },
    ],
    speed_profile: [
      { distance_km: 0, speed_kmh: 36 },
      { distance_km: 1, speed_kmh: 72 },
    ],
    telemetry: [{ distance_km: 2, battery_level: 88, power: 15_000, elevation: 42 }],
    ...overrides,
  };
}

describe('isCanonicalSharedDrive', () => {
  it('is true for a v2 SI payload and a v1-tagged SI payload (keys on presence, not value)', () => {
    expect(isCanonicalSharedDrive(makeV2())).toBe(true);
    // A v1-*tagged* SI payload still carries payload_version → canonical.
    expect(isCanonicalSharedDrive(makeV2({ payload_version: 'v1' }))).toBe(true);
  });

  it('is false for a legacy payload with no payload_version discriminator', () => {
    expect(isCanonicalSharedDrive(makeLegacy())).toBe(false);
  });

  it('is null-safe: null and undefined are never canonical (no throw on the `in` operator)', () => {
    expect(() => isCanonicalSharedDrive(null)).not.toThrow();
    expect(isCanonicalSharedDrive(null)).toBe(false);
    expect(isCanonicalSharedDrive(undefined)).toBe(false);
  });
});

describe('isLegacySharedDrive', () => {
  it('is true only for the pre-SI km/min shape', () => {
    expect(isLegacySharedDrive(makeLegacy())).toBe(true);
    expect(isLegacySharedDrive(makeV2())).toBe(false);
    expect(isLegacySharedDrive(makeV2({ payload_version: 'v1' }))).toBe(false);
  });

  it('is null-safe and is the exact complement of isCanonicalSharedDrive for real payloads', () => {
    expect(isLegacySharedDrive(null)).toBe(false);
    expect(isLegacySharedDrive(undefined)).toBe(false);
    const legacy = makeLegacy();
    const canonical = makeV2();
    expect(isLegacySharedDrive(legacy)).toBe(!isCanonicalSharedDrive(legacy));
    expect(isLegacySharedDrive(canonical)).toBe(!isCanonicalSharedDrive(canonical));
  });
});

describe('normalizeSharedDriveData — passthrough branches', () => {
  it('returns undefined for null / undefined input (nothing to render)', () => {
    expect(normalizeSharedDriveData(undefined)).toBeUndefined();
    expect(normalizeSharedDriveData(null)).toBeUndefined();
  });

  it('returns an already-canonical payload by reference, untouched', () => {
    const canonical = makeV2();
    const result = normalizeSharedDriveData(canonical);
    // Same object identity — no copy, no conversion.
    expect(result).toBe(canonical);
  });

  it('passes a v1-tagged SI payload straight through without re-running the km→m converters', () => {
    // Regression guard: a v1-tagged SI payload has no `distance_km` etc., so
    // re-converting would read them as undefined → NaN. Presence of
    // payload_version must short-circuit that path.
    const tagged = makeV2({ payload_version: 'v1' });
    const result = normalizeSharedDriveData(tagged);
    expect(result).toBe(tagged);
    expect(result?.drive.distance_m).toBe(617_000);
    expect(Number.isNaN(result?.drive.distance_m)).toBe(false);
  });
});

describe('normalizeSharedDriveData — legacy v1 → SI conversion', () => {
  it('upgrades every scalar drive field from km/min/kmh to SI', () => {
    const result = normalizeSharedDriveData(makeLegacy());
    expect(result).toBeDefined();
    const drive = result!.drive;

    expect(drive.distance_m).toBe(5_000); // 5 km → 5000 m
    expect(drive.duration_s).toBe(600); // 10 min → 600 s (rounded)
    expect(drive.max_speed_mps).toBeCloseTo(30, 6); // 108 km/h ÷ 3.6
    expect(drive.avg_speed_mps).toBeCloseTo(20, 6); // 72 km/h ÷ 3.6
    expect(drive.efficiency_wh_per_m).toBeCloseTo(0.15, 6); // 150 Wh/km ÷ 1000
    // Elevation was already metres in v1 — copied through, not scaled.
    expect(drive.elevation_gain).toBe(120);
    expect(drive.elevation_loss).toBe(60);
    // Battery + addresses copied verbatim.
    expect(drive.start_battery).toBe(90);
    expect(drive.end_address).toBe('Salem');
  });

  it('tags the converted payload as canonical SI with `v1` provenance', () => {
    const result = normalizeSharedDriveData(makeLegacy());
    expect(result?.payload_version).toBe('v1');
    // The upgraded output is itself recognised as canonical SI.
    expect(isCanonicalSharedDrive(result)).toBe(true);
  });

  it('re-bases the elevation / speed / telemetry profiles to SI metres and m·s⁻¹', () => {
    const result = normalizeSharedDriveData(makeLegacy());

    expect(result?.elevation_profile).toEqual([
      { distance_m: 0, elevation_m: 50 },
      { distance_m: 1_000, elevation_m: 80 },
    ]);

    const speed = result?.speed_profile ?? [];
    expect(speed.map((p) => p.distance_m)).toEqual([0, 1_000]);
    expect(speed[0].speed_mps).toBeCloseTo(10, 6); // 36 km/h
    expect(speed[1].speed_mps).toBeCloseTo(20, 6); // 72 km/h

    expect(result?.telemetry).toEqual([
      { distance_m: 2_000, battery_level: 88, power: 15_000, elevation: 42 },
    ]);
    // vehicle + map_points carried across unchanged.
    expect(result?.vehicle).toEqual({ model: 'Model Y', color: 'Pearl White' });
    expect(result?.map_points).toEqual([{ lat: 45.5, lng: -122.6 }]);
  });

  it('preserves nullable scalars as null instead of coercing them to NaN', () => {
    const result = normalizeSharedDriveData(
      makeLegacy({}, {
        max_speed_kmh: null,
        avg_speed_kmh: null,
        efficiency_wh_km: null,
        start_battery: null,
        end_battery: null,
      }),
    );
    expect(result?.drive.max_speed_mps).toBeNull();
    expect(result?.drive.avg_speed_mps).toBeNull();
    expect(result?.drive.efficiency_wh_per_m).toBeNull();
    expect(result?.drive.start_battery).toBeNull();
    expect(result?.drive.end_battery).toBeNull();
  });

  it('normalises absent (null) profile arrays to empty arrays so consumers can safely map/length', () => {
    const result = normalizeSharedDriveData(
      makeLegacy({ elevation_profile: null, speed_profile: null, telemetry: null }),
    );
    expect(result?.elevation_profile).toEqual([]);
    expect(result?.speed_profile).toEqual([]);
    expect(result?.telemetry).toEqual([]);
    // …and preserves an explicitly-null vehicle / map_points as-is.
    const noVehicle = normalizeSharedDriveData(makeLegacy({ vehicle: null, map_points: null }));
    expect(noVehicle?.vehicle).toBeNull();
    expect(noVehicle?.map_points).toBeNull();
  });
});

import { describe, it, expect } from 'vitest'
import {
  haversineDistance,
  isValidLatLng,
  hasMeaningfulRoute,
  firstValidIndex,
  MIN_MEANINGFUL_ROUTE_METERS,
  type LatLngLike,
} from './geo'

/* Helper: build a coordinate bag the way telemetry/DrivePosition data does. */
const at = (latitude: number, longitude: number): LatLngLike => ({ latitude, longitude })

describe('haversineDistance', () => {
  it('returns exactly 0 for two identical points', () => {
    expect(haversineDistance(37.5, -122.3, 37.5, -122.3)).toBe(0)
    expect(haversineDistance(0, 0, 0, 0)).toBe(0)
  })

  it('measures ~111.19 km for one degree of latitude', () => {
    // 1° of latitude is ~111.19 km everywhere on the sphere.
    expect(haversineDistance(0, 0, 1, 0)).toBeCloseTo(111194.93, 0)
  })

  it('measures ~111.19 km for one degree of longitude at the equator', () => {
    expect(haversineDistance(0, 0, 0, 1)).toBeCloseTo(111194.93, 0)
  })

  it('is symmetric — distance(A,B) equals distance(B,A)', () => {
    const ab = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522)
    const ba = haversineDistance(48.8566, 2.3522, 51.5074, -0.1278)
    expect(ab).toBeCloseTo(ba, 6)
  })

  it('matches a known real-world distance (London → Paris ≈ 343.5 km)', () => {
    const d = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522)
    expect(d).toBeGreaterThan(340_000)
    expect(d).toBeLessThan(346_000)
    expect(d).toBeCloseTo(343556, -1)
  })

  it('returns a small positive distance for closely-spaced samples', () => {
    // ~0.0002° of latitude ≈ 22 m.
    const d = haversineDistance(37.5, -122.3, 37.5002, -122.3)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeCloseTo(22.24, 1)
  })

  it('resolves antipodal points to ~half Earth circumference without NaN (clamp fix)', () => {
    // Regression: floating-point rounding nudged the squared half-chord past 1
    // for these near-antipodal coords, so `Math.sqrt(1 - a)` was NaN and the
    // result was NaN. The [0,1] clamp restores the correct ~20 015 km.
    const d = haversineDistance(-87.5, -180, 87.5, 0)
    expect(Number.isNaN(d)).toBe(false)
    expect(d).toBeCloseTo(20015086.8, 0)
  })

  it('propagates NaN when given a non-finite coordinate', () => {
    // Garbage-in → NaN-out is intentional: callers that need to exclude bad
    // samples (nearest-point search) rely on NaN comparisons failing.
    expect(Number.isNaN(haversineDistance(NaN, 0, 1, 0))).toBe(true)
    expect(Number.isNaN(haversineDistance(0, 0, Infinity, 0))).toBe(true)
  })
})

describe('MIN_MEANINGFUL_ROUTE_METERS', () => {
  it('is the 10 m stationary-cluster threshold', () => {
    expect(MIN_MEANINGFUL_ROUTE_METERS).toBe(10)
  })
})

describe('isValidLatLng', () => {
  it('accepts a normal fixed coordinate', () => {
    expect(isValidLatLng(37.7749, -122.4194)).toBe(true)
    expect(isValidLatLng(-33.8688, 151.2093)).toBe(true)
  })

  it('rejects the (0, 0) "GPS not yet fixed" placeholder', () => {
    expect(isValidLatLng(0, 0)).toBe(false)
  })

  it('accepts a valid point that sits on the equator or prime meridian', () => {
    // Only (0,0) is the placeholder — a genuine equator/meridian point is fine.
    expect(isValidLatLng(0, 10)).toBe(true)
    expect(isValidLatLng(10, 0)).toBe(true)
  })

  it('accepts the exact global bounds', () => {
    expect(isValidLatLng(90, 180)).toBe(true)
    expect(isValidLatLng(-90, -180)).toBe(true)
  })

  it('rejects latitude or longitude beyond global bounds', () => {
    expect(isValidLatLng(90.0001, 0)).toBe(false)
    expect(isValidLatLng(-90.0001, 0)).toBe(false)
    expect(isValidLatLng(0.5, 180.0001)).toBe(false)
    expect(isValidLatLng(0.5, -180.0001)).toBe(false)
  })

  it('rejects non-finite coordinates', () => {
    expect(isValidLatLng(NaN, 10)).toBe(false)
    expect(isValidLatLng(10, NaN)).toBe(false)
    expect(isValidLatLng(Infinity, 10)).toBe(false)
    expect(isValidLatLng(10, -Infinity)).toBe(false)
  })

  it('tolerates being called with null/undefined coordinates at runtime', () => {
    // Position bags come from telemetry JSON where a field may be absent.
    expect(isValidLatLng(null as unknown as number, 10)).toBe(false)
    expect(isValidLatLng(10, undefined as unknown as number)).toBe(false)
  })
})

describe('hasMeaningfulRoute', () => {
  it('returns false for an empty list', () => {
    expect(hasMeaningfulRoute([])).toBe(false)
  })

  it('returns false when only a single valid sample exists', () => {
    expect(hasMeaningfulRoute([at(37.5, -122.3)])).toBe(false)
  })

  it('returns false when every sample is invalid', () => {
    expect(hasMeaningfulRoute([at(0, 0), at(0, 0), at(NaN, NaN)])).toBe(false)
  })

  it('returns false for a stationary cluster (all samples within 10 m)', () => {
    // ~3.3 m and ~5.6 m from the anchor — a parked car with GPS jitter.
    const jitter = [
      at(37.5, -122.3),
      at(37.50003, -122.3),
      at(37.50005, -122.3),
    ]
    expect(hasMeaningfulRoute(jitter)).toBe(false)
  })

  it('returns true once any valid sample is ≥ 10 m from the anchor', () => {
    // ~22 m separation — a genuine (if short) route.
    const route = [at(37.5, -122.3), at(37.5002, -122.3)]
    expect(hasMeaningfulRoute(route)).toBe(true)
  })

  it('anchors on the first valid sample, skipping leading invalid ones', () => {
    const route = [at(0, 0), at(NaN, NaN), at(37.5, -122.3), at(37.5002, -122.3)]
    expect(hasMeaningfulRoute(route)).toBe(true)
  })

  it('ignores invalid samples interleaved between valid ones', () => {
    const route = [at(37.5, -122.3), at(0, 0), at(37.50003, -122.3)]
    // Remaining valid sample is only ~3.3 m away → still a cluster.
    expect(hasMeaningfulRoute(route)).toBe(false)
  })

  it('returns false for null/undefined lists instead of throwing', () => {
    expect(hasMeaningfulRoute(null)).toBe(false)
    expect(hasMeaningfulRoute(undefined)).toBe(false)
  })

  it('skips null/undefined samples inside the list without throwing', () => {
    const dirty = [
      null,
      at(37.5, -122.3),
      undefined,
      at(37.5002, -122.3),
    ] as unknown as LatLngLike[]
    expect(hasMeaningfulRoute(dirty)).toBe(true)
  })
})

describe('firstValidIndex', () => {
  it('returns -1 for an empty list', () => {
    expect(firstValidIndex([])).toBe(-1)
  })

  it('returns -1 when no sample is valid', () => {
    expect(firstValidIndex([at(0, 0), at(NaN, 5), at(200, 400)])).toBe(-1)
  })

  it('returns 0 when the first sample is already valid', () => {
    expect(firstValidIndex([at(37.5, -122.3), at(37.6, -122.4)])).toBe(0)
  })

  it('returns the index of the first valid sample past leading invalid ones', () => {
    expect(firstValidIndex([at(0, 0), at(NaN, NaN), at(37.5, -122.3)])).toBe(2)
  })

  it('returns -1 for null/undefined lists instead of throwing', () => {
    expect(firstValidIndex(null)).toBe(-1)
    expect(firstValidIndex(undefined)).toBe(-1)
  })

  it('skips null/undefined samples when locating the first valid coordinate', () => {
    const dirty = [null, undefined, at(48.8566, 2.3522)] as unknown as LatLngLike[]
    expect(firstValidIndex(dirty)).toBe(2)
  })
})

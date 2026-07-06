/**
 * types/location — contract tests for the visited-Location & Geofence view-models.
 *
 * This module is *type-only*: both exports are `interface`s, fully erased at
 * runtime, so a smoke render proves nothing. Following the repo convention for
 * type modules (see features/charging/components/charging-curve/types.test.ts),
 * this suite enforces the contracts on two levels:
 *
 *   • Runtime (`expect`)      — the *shape + consumer contract*. Fixtures are
 *     projected through the SAME null-safe logic the real consumers use
 *     (LocationFavoritesWidget's Location→RankedItem map, GeofencesPage's
 *     alert-type derivation), so the assertions verify real construction /
 *     branch behaviour rather than a hand-typed echo. The SI-seconds contract
 *     of `totalDurationS` is exercised through an actual display-boundary
 *     conversion.
 *   • Compile-time (`expectTypeOf`) — the *type identities*: each export equals
 *     its documented shape and the `| null` unions are preserved. These are
 *     runtime no-ops; the production `tsc --noEmit` gate enforces them.
 *
 * No network, no DOM — pure structural + branch assertions, so no MSW/QueryClient
 * harness is required.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { Location, Geofence } from './location';

/**
 * Full, valid `Location` fixture. Every field is set so the object is assignable
 * without a cast; overrides tweak only what a test cares about. Defaults describe
 * a home address visited 12 times, last seen 2026-07-01, dwelt 90 min (5 400 s).
 */
function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 'loc-1',
    addressName: 'Home',
    latitude: 37.4419,
    longitude: -122.143,
    visitCount: 12,
    totalDurationS: 5_400, // 90 minutes, in SI seconds
    lastVisited: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Full, valid `Geofence` fixture — a 150 m entry-alerting circle at "Work".
 */
function makeGeofence(overrides: Partial<Geofence> = {}): Geofence {
  return {
    id: 'geo-1',
    name: 'Work',
    latitude: 37.5,
    longitude: -122.2,
    radius: 150,
    alertOnEntry: true,
    alertOnExit: false,
    enabled: true,
    costPerKwh: null,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

// Mirror of LocationFavoritesWidget's null-safe Location→RankedItem projection.
// The `?? '—'` / `?? 0` guards are defensive against API-drift nulls the type
// says cannot happen, so this captures the real widget contract.
function toRankedItem(loc: Location) {
  return {
    id: loc.id,
    label: loc.addressName ?? '—',
    value: loc.visitCount ?? 0,
    lastVisitedLabel: loc.lastVisited ?? '—',
  };
}

// Mirror of GeofencesPage.getAlertType — the reason both booleans exist.
type AlertType = 'both' | 'entry' | 'exit' | 'none';
function deriveAlertType(g: Geofence): AlertType {
  if (g.alertOnEntry && g.alertOnExit) return 'both';
  if (g.alertOnEntry) return 'entry';
  if (g.alertOnExit) return 'exit';
  return 'none';
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

describe('Location', () => {
  it('carries exactly the seven visited-place fields with the right primitive types', () => {
    const loc = makeLocation();

    expect(Object.keys(loc).sort()).toEqual([
      'addressName',
      'id',
      'lastVisited',
      'latitude',
      'longitude',
      'totalDurationS',
      'visitCount',
    ]);
    expect(typeof loc.id).toBe('string');
    expect(typeof loc.addressName).toBe('string');
    expect(typeof loc.latitude).toBe('number');
    expect(typeof loc.longitude).toBe('number');
    expect(typeof loc.visitCount).toBe('number');
    expect(typeof loc.totalDurationS).toBe('number');

    expectTypeOf<Location>().toEqualTypeOf<{
      id: string;
      addressName: string;
      latitude: number;
      longitude: number;
      visitCount: number;
      totalDurationS: number;
      lastVisited: string | null;
    }>();
  });

  it('treats totalDurationS as SI seconds — converts cleanly at the display boundary', () => {
    // 5 400 s dwell time. Consumers convert at the render edge (÷60 → minutes,
    // ÷3600 → hours); the field itself must never be pre-divided.
    const loc = makeLocation({ totalDurationS: 5_400 });

    expect(loc.totalDurationS / 60).toBe(90); // minutes
    expect(loc.totalDurationS / 3_600).toBe(1.5); // hours
    // A zero-dwell location stays a finite 0, never NaN/undefined.
    expect(makeLocation({ totalDurationS: 0 }).totalDurationS / 60).toBe(0);
    expectTypeOf<Location['totalDurationS']>().toEqualTypeOf<number>();
  });

  it('models lastVisited as a nullable ISO string and folds null to a dash', () => {
    const never = makeLocation({ lastVisited: null });
    const seen = makeLocation({ lastVisited: '2026-07-01T00:00:00Z' });

    expect(never.lastVisited).toBeNull();
    expect(never.lastVisited ?? '—').toBe('—');
    expect(seen.lastVisited).toContain('2026-07-01');
    expectTypeOf<Location['lastVisited']>().toEqualTypeOf<string | null>();
  });

  it('projects to the LocationFavoritesWidget ranked-item shape null-safely', () => {
    const populated = toRankedItem(makeLocation({ id: 'a', addressName: 'Cafe', visitCount: 3 }));
    expect(populated).toEqual({
      id: 'a',
      label: 'Cafe',
      value: 3,
      lastVisitedLabel: '2026-07-01T00:00:00Z',
    });

    // Simulate the API-drift the widget's `??` guards defend against: nulls
    // arriving where the type promises a string/number. The projection must
    // still yield safe placeholders, never surface `null`/`undefined`.
    const drifted = {
      ...makeLocation(),
      addressName: null,
      visitCount: null,
      lastVisited: null,
    } as unknown as Location;
    const safe = toRankedItem(drifted);
    expect(safe.label).toBe('—');
    expect(safe.value).toBe(0);
    expect(safe.lastVisitedLabel).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// Geofence
// ---------------------------------------------------------------------------

describe('Geofence', () => {
  it('carries exactly the ten circular-geofence fields with the right primitive types', () => {
    const g = makeGeofence();

    expect(Object.keys(g).sort()).toEqual([
      'alertOnEntry',
      'alertOnExit',
      'costPerKwh',
      'createdAt',
      'enabled',
      'id',
      'latitude',
      'longitude',
      'name',
      'radius',
    ]);
    expect(typeof g.id).toBe('string');
    expect(typeof g.name).toBe('string');
    expect(typeof g.radius).toBe('number');
    expect(typeof g.createdAt).toBe('string');

    expectTypeOf<Geofence>().toEqualTypeOf<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      radius: number;
      alertOnEntry: boolean;
      alertOnExit: boolean;
      enabled: boolean;
      costPerKwh: number | null;
      createdAt: string;
    }>();
  });

  it('drives every alert-type branch off the two independent entry/exit booleans', () => {
    expect(deriveAlertType(makeGeofence({ alertOnEntry: true, alertOnExit: true }))).toBe('both');
    expect(deriveAlertType(makeGeofence({ alertOnEntry: true, alertOnExit: false }))).toBe('entry');
    expect(deriveAlertType(makeGeofence({ alertOnEntry: false, alertOnExit: true }))).toBe('exit');
    expect(deriveAlertType(makeGeofence({ alertOnEntry: false, alertOnExit: false }))).toBe('none');

    expectTypeOf<Geofence['alertOnEntry']>().toEqualTypeOf<boolean>();
    expectTypeOf<Geofence['alertOnExit']>().toEqualTypeOf<boolean>();
  });

  it('models the enabled flag as an independent boolean toggle', () => {
    expect(makeGeofence({ enabled: true }).enabled).toBe(true);
    expect(makeGeofence({ enabled: false }).enabled).toBe(false);
    expectTypeOf<Geofence['enabled']>().toEqualTypeOf<boolean>();
  });

  it('models costPerKwh as a nullable number and folds null to 0 at use sites', () => {
    const untariffed = makeGeofence({ costPerKwh: null });
    const tariffed = makeGeofence({ costPerKwh: 0.32 });

    expect(untariffed.costPerKwh).toBeNull();
    expect(untariffed.costPerKwh ?? 0).toBe(0);
    expect(tariffed.costPerKwh).toBeCloseTo(0.32, 5);
    expectTypeOf<Geofence['costPerKwh']>().toEqualTypeOf<number | null>();
  });
});

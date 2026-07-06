/**
 * trip — contract tests for the trip domain view-models re-exported by
 * `@/types/trip`.
 *
 * This module is *type-only*: every export is an `interface`, erased at
 * runtime. A smoke render proves nothing, so — following the repo convention
 * for type modules (see types/energy.test.ts and
 * features/automations/components/stepInputTypes.test.ts) — this suite
 * enforces the contracts on two levels:
 *
 *   • Runtime (`expect`)       — the *shape + producer contract*. Fixtures are
 *     built the way the real trips endpoints emit them and read the way the
 *     SPA reads them (null-safe per-drive reducers mirroring TripDrivesTable /
 *     TripDrivesChart, SI efficiency = energy / distance, avg speed =
 *     distance / duration, `energy_used_wh` aliased to `total_energy_wh` by the
 *     detail handler). Optional / nullable branches are exercised explicitly.
 *   • Compile-time (`expectTypeOf`) — the *re-export identity* (each export is
 *     the same type as its `@/api/types` origin, not a structural twin), the
 *     `| null` unions, optional keys, and the SI-canonical field set (no legacy
 *     `*_mi` / `*_kwh` / `*_min` suffixes survive the Phase-48 migration).
 *
 * The field names + units mirror the Go handler JSON wire contract (verified
 * against `internal/api/trips`, `internal/api/tripsdetail`, and the `Trip` /
 * `TripDetail` / `TripDriveSummary` interfaces in `web/src/api/types.ts`). No
 * network, no DOM — pure structural + type-level assertions.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { Trip, TripDetail, TripDriveSummary } from './trip';
import type {
  Trip as ApiTrip,
  TripDetail as ApiTripDetail,
  TripDriveSummary as ApiTripDriveSummary,
} from '@/api/types';

// ── Real consumer-mirroring derivations (so assertions test math, not echoes) ──

/** Wh per metre — mirrors the trip-list efficiency cell; divide-by-zero safe. */
const efficiencyWhPerM = (t: Trip): number =>
  t.total_distance_m > 0 ? t.total_energy_wh / t.total_distance_m : 0;

/** Average speed in m/s (SI) — guards a zero-duration (still-open) trip. */
const avgSpeedMps = (t: Trip): number =>
  t.total_duration_s > 0 ? t.total_distance_m / t.total_duration_s : 0;

/** Null-safe distance sum — mirrors the TripDrivesTable / TripDrivesChart reducers. */
const sumDriveDistanceM = (drives: TripDriveSummary[]): number =>
  drives.reduce((s, d) => s + (d.distance_m ?? 0), 0);

/** Null-safe energy sum — an unrecorded drive contributes 0, never NaN. */
const sumDriveEnergyWh = (drives: TripDriveSummary[]): number =>
  drives.reduce((s, d) => s + (d.energy_used_wh ?? 0), 0);

/** Null-safe duration sum — same null-coalescing contract as the SPA. */
const sumDriveDurationS = (drives: TripDriveSummary[]): number =>
  drives.reduce((s, d) => s + (d.duration_s ?? 0), 0);

// ── Fixtures (built once, overridden per branch) ──────────────────────────────

function makeDrive(overrides: Partial<TripDriveSummary> = {}): TripDriveSummary {
  return {
    id: 1,
    started_at: '2024-01-01T08:00:00Z',
    ended_at: '2024-01-01T08:30:00Z',
    distance_m: 20_000,
    energy_used_wh: 4_000,
    duration_s: 1_800,
    start_place: 'Home',
    end_place: 'Office',
    ...overrides,
  };
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 42,
    vehicle_id: 7,
    name: 'Monday commute',
    start_date: '2024-01-01',
    end_date: '2024-01-01',
    started_at: '2024-01-01T08:00:00Z',
    ended_at: '2024-01-01T09:00:00Z',
    total_distance_m: 50_000,
    total_energy_wh: 10_000,
    total_duration_s: 3_600,
    total_cost: 3.5,
    drive_count: 2,
    charge_count: 1,
    created_at: '2024-01-01T09:05:00Z',
    created_by_user: 1,
    auto_generated: false,
    notes: 'Test note',
    ...overrides,
  };
}

/** A detail whose two drives sum *exactly* to the trip totals (the real invariant). */
function makeTripDetail(overrides: Partial<TripDetail> = {}): TripDetail {
  const base = makeTrip();
  const drives: TripDriveSummary[] = [
    makeDrive({ id: 1, distance_m: 20_000, energy_used_wh: 4_000, duration_s: 1_800 }),
    makeDrive({
      id: 2,
      distance_m: 30_000,
      energy_used_wh: 6_000,
      duration_s: 1_800,
      start_place: 'Office',
      end_place: 'Home',
    }),
  ];
  return {
    ...base,
    energy_used_wh: base.total_energy_wh, // detail handler alias
    drives,
    ...overrides,
  };
}

// ── Re-export identity ────────────────────────────────────────────────────────

describe('@/types/trip re-export identity', () => {
  it('re-exports Trip / TripDetail / TripDriveSummary as the canonical @/api/types shapes', () => {
    // Runtime: fixtures typed against `./trip` are freely assignable to the
    // `@/api/types` origin — proving the re-export is not a diverged copy.
    const trip: ApiTrip = makeTrip();
    const detail: ApiTripDetail = makeTripDetail();
    const drive: ApiTripDriveSummary = makeDrive();
    expect(trip.id).toBe(42);
    expect(detail.drives).toHaveLength(2);
    expect(drive.start_place).toBe('Home');

    // Compile-time: same *type*, not a structural twin.
    expectTypeOf<Trip>().toEqualTypeOf<ApiTrip>();
    expectTypeOf<TripDetail>().toEqualTypeOf<ApiTripDetail>();
    expectTypeOf<TripDriveSummary>().toEqualTypeOf<ApiTripDriveSummary>();
  });

  it('keeps TripDetail a superset of Trip (adds drives[] + energy_used_wh)', () => {
    const detail = makeTripDetail();
    // A TripDetail is a valid Trip — every list-shape field is present.
    const asTrip: Trip = detail;
    expect(asTrip.total_distance_m).toBe(detail.total_distance_m);
    expect(asTrip.drive_count).toBe(detail.drive_count);
    expectTypeOf<TripDetail>().toHaveProperty('drives');
    expectTypeOf<TripDetail>().toHaveProperty('energy_used_wh');
    // The extra keys are what a plain Trip must NOT carry.
    expectTypeOf<Trip>().not.toHaveProperty('drives');
    expectTypeOf<Trip>().not.toHaveProperty('energy_used_wh');
  });
});

// ── Trip — list-row contract ──────────────────────────────────────────────────

describe('Trip — list-row contract', () => {
  it('locks the full Trip key set', () => {
    expect(Object.keys(makeTrip()).sort()).toEqual([
      'auto_generated',
      'charge_count',
      'created_at',
      'created_by_user',
      'drive_count',
      'end_date',
      'ended_at',
      'id',
      'name',
      'notes',
      'start_date',
      'started_at',
      'total_cost',
      'total_distance_m',
      'total_duration_s',
      'total_energy_wh',
      'vehicle_id',
    ]);
  });

  it('carries SI-canonical totals and no legacy unit-suffixed fields (Phase-48)', () => {
    const t = makeTrip();
    expect(t.total_distance_m).toBe(50_000);
    expect(t.total_energy_wh).toBe(10_000);
    expect(t.total_duration_s).toBe(3_600);
    // The SI keys exist…
    expectTypeOf<Trip>().toHaveProperty('total_distance_m');
    expectTypeOf<Trip>().toHaveProperty('total_energy_wh');
    expectTypeOf<Trip>().toHaveProperty('total_duration_s');
    // …and the retired display-unit keys are gone for good.
    expectTypeOf<Trip>().not.toHaveProperty('total_distance_mi');
    expectTypeOf<Trip>().not.toHaveProperty('total_energy_kwh');
    expectTypeOf<Trip>().not.toHaveProperty('total_duration_min');
  });

  it('derives SI efficiency (Wh/m) and average speed (m/s) from the totals', () => {
    const t = makeTrip();
    expect(efficiencyWhPerM(t)).toBeCloseTo(0.2, 10); // 10_000 / 50_000
    expect(avgSpeedMps(t)).toBeCloseTo(50_000 / 3_600, 10);
    expect(t.total_distance_m).toBeGreaterThan(0);
  });
});

// ── Trip — nullable + optional fields ─────────────────────────────────────────

describe('Trip — nullable + optional fields', () => {
  it('allows an in-progress trip with null name / end markers', () => {
    const open = makeTrip({ name: null, end_date: null, ended_at: null });
    expect(open.name).toBeNull();
    expect(open.end_date).toBeNull();
    expect(open.ended_at).toBeNull();
    // A still-open trip has zero elapsed duration → the divide is guarded.
    expect(avgSpeedMps(makeTrip({ total_duration_s: 0, total_distance_m: 0 }))).toBe(0);
    expectTypeOf<Trip['name']>().toEqualTypeOf<string | null>();
    expectTypeOf<Trip['end_date']>().toEqualTypeOf<string | null>();
    expectTypeOf<Trip['ended_at']>().toEqualTypeOf<string | null>();
  });

  it('treats created_by_user / auto_generated / notes as optional metadata', () => {
    // An auto-segmented trip carries none of the user-authored metadata.
    const auto: Trip = {
      id: 9,
      vehicle_id: 7,
      name: null,
      start_date: '2024-02-01',
      end_date: '2024-02-01',
      started_at: '2024-02-01T00:00:00Z',
      ended_at: '2024-02-01T01:00:00Z',
      total_distance_m: 0,
      total_energy_wh: 0,
      total_duration_s: 0,
      total_cost: 0,
      drive_count: 0,
      charge_count: 0,
      created_at: '2024-02-01T01:05:00Z',
    };
    expect(auto.created_by_user).toBeUndefined();
    expect(auto.auto_generated).toBeUndefined();
    expect(auto.notes).toBeUndefined();
    expectTypeOf<Trip['created_by_user']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<Trip['auto_generated']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Trip['notes']>().toEqualTypeOf<string | null | undefined>();
  });
});

// ── TripDriveSummary — per-drive row ──────────────────────────────────────────

describe('TripDriveSummary — per-drive row', () => {
  it('locks the drive-summary key set and SI nullable metrics', () => {
    expect(Object.keys(makeDrive()).sort()).toEqual([
      'distance_m',
      'duration_s',
      'end_place',
      'ended_at',
      'energy_used_wh',
      'id',
      'start_place',
      'started_at',
    ]);
    expectTypeOf<TripDriveSummary['distance_m']>().toEqualTypeOf<number | null>();
    expectTypeOf<TripDriveSummary['energy_used_wh']>().toEqualTypeOf<number | null>();
    expectTypeOf<TripDriveSummary['duration_s']>().toEqualTypeOf<number | null>();
    expectTypeOf<TripDriveSummary['start_place']>().toEqualTypeOf<string | null>();
  });

  it('sums null-unrecorded metrics as zero (mirrors TripDrivesTable / Chart reducers)', () => {
    const drives = [
      makeDrive({ id: 1, distance_m: 12_000, energy_used_wh: 3_000, duration_s: 900 }),
      makeDrive({
        id: 2,
        distance_m: null,
        energy_used_wh: null,
        duration_s: null,
        start_place: null,
        end_place: null,
      }),
    ];
    // The null drive contributes 0 to every aggregate — never NaN.
    expect(sumDriveDistanceM(drives)).toBe(12_000);
    expect(sumDriveEnergyWh(drives)).toBe(3_000);
    expect(sumDriveDurationS(drives)).toBe(900);
    // Unresolved geocodes surface as null, not a crash.
    expect(drives[1].start_place).toBeNull();
    expect(drives[1].end_place).toBeNull();
  });
});

// ── TripDetail — detail contract ──────────────────────────────────────────────

describe('TripDetail — detail contract', () => {
  it('aliases energy_used_wh to total_energy_wh (the detail-handler contract)', () => {
    const d = makeTripDetail();
    expect(d.energy_used_wh).toBe(d.total_energy_wh);
    expect(d.energy_used_wh).toBe(10_000);
    expectTypeOf<TripDetail['energy_used_wh']>().toEqualTypeOf<number>();
    expectTypeOf<TripDetail['drives']>().toEqualTypeOf<TripDriveSummary[]>();
  });

  it('reconciles the per-drive breakdown with the trip totals', () => {
    const d = makeTripDetail();
    expect(d.drives).toHaveLength(d.drive_count);
    expect(sumDriveDistanceM(d.drives)).toBe(d.total_distance_m);
    expect(sumDriveEnergyWh(d.drives)).toBe(d.total_energy_wh);
    expect(sumDriveDurationS(d.drives)).toBe(d.total_duration_s);
  });

  it('renders an empty breakdown without dividing by zero (empty-state safety)', () => {
    const empty = makeTripDetail({
      drives: [],
      drive_count: 0,
      total_distance_m: 0,
      total_energy_wh: 0,
      energy_used_wh: 0,
      total_duration_s: 0,
    });
    expect(empty.drives).toEqual([]);
    expect(sumDriveDistanceM(empty.drives)).toBe(0);
    expect(efficiencyWhPerM(empty)).toBe(0);
    expect(avgSpeedMps(empty)).toBe(0);
  });
});

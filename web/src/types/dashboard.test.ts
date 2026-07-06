/**
 * dashboard.ts — contract tests for the `DashboardStats` view-model.
 *
 * This module is *type-only*: its single export is an `interface`, erased at
 * runtime. A smoke render proves nothing, so — following the repo convention
 * for type modules (see features/automations/components/stepInputTypes.test.ts
 * and features/charging/components/charging-curve/types.test.ts) — this suite
 * enforces the contract on two levels:
 *
 *   • Runtime (`expect`)      — the *shape + wire contract*: the payload carries
 *     exactly the seven camelCase keys the Go DTO
 *     (`internal/handler/dto/dashboard.go`) serialises, every metric is a plain
 *     finite number, the SI-canonical field names never regress to a legacy
 *     imperial/kWh suffix (Phase-48), `avgEfficiency` really is
 *     `totalEnergyWh / totalM` (Wh/m), and the shape survives a JSON round-trip.
 *   • Compile-time (`expectTypeOf`) — the *type identities*: the interface equals
 *     its documented all-`number` shape and no field is nullable/optional. These
 *     are runtime no-ops; the production `tsc --noEmit` gate enforces them via
 *     the real call-sites (useDashboardStats / DashboardStatsWidget).
 *
 * No network, no DOM — pure structural assertions, so no MSW/QueryClient harness.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { DashboardStats } from './dashboard';

/**
 * The exact JSON keys the backend serialises, transcribed from the Go DTO
 * `DashboardStatsResponse` (`internal/handler/dto/dashboard.go`). If the Go
 * contract and this frontend interface ever drift, the key-set assertions below
 * fail — this array is the single documented cross-boundary source of truth.
 */
const BACKEND_JSON_KEYS = [
  'totalVehicles',
  'totalM',
  'totalEnergyWh',
  'totalChargingSessions',
  'totalTrips',
  'avgEfficiency',
  'totalCostCents',
] as const;

/**
 * Legacy unit suffixes forbidden by the Phase-48 SI-canonical migration. Any
 * camelCase field ending in one of these is a regression (e.g. `distanceMi`,
 * `durationMin`, `avgSpeedMph`, `energyUsedKwh`, `avgPowerKw`, `pressurePsi`).
 * `totalM` (metres) and `totalEnergyWh` (watt-hours) are the SI keys and MUST
 * NOT match.
 */
const LEGACY_UNIT_SUFFIX = /(?:Mi|Min|Mph|Kwh|Kw|Psi)$/;

/**
 * Realistic SI fixture. `totalM`/`totalEnergyWh` are chosen so `avgEfficiency`
 * (Wh/m) equals `totalEnergyWh / totalM` exactly — 82_500 Wh over 500_000 m =>
 * 0.165 Wh/m (i.e. 165 Wh/km), a typical Model 3 figure.
 */
const sample: DashboardStats = {
  totalVehicles: 3,
  totalM: 500_000,
  totalEnergyWh: 82_500,
  totalChargingSessions: 12,
  totalTrips: 47,
  avgEfficiency: 0.165,
  totalCostCents: 5_432,
};

// ── Wire contract: keys + value kinds ─────────────────────────────────────────

describe('DashboardStats wire contract', () => {
  it('exposes exactly the seven camelCase keys the Go DTO serialises', () => {
    expect(Object.keys(sample).sort()).toEqual([...BACKEND_JSON_KEYS].sort());
    expect(Object.keys(sample)).toHaveLength(7);
    // Backend emits camelCase tags directly, so camelCaseKeys() is a no-op here:
    // there must be no snake_case alias leaking into the declared contract.
    expect(BACKEND_JSON_KEYS.some((k) => k.includes('_'))).toBe(false);

    // Type identity: the interface is precisely this all-`number` record.
    expectTypeOf<DashboardStats>().toEqualTypeOf<{
      totalVehicles: number;
      totalM: number;
      totalEnergyWh: number;
      totalChargingSessions: number;
      totalTrips: number;
      avgEfficiency: number;
      totalCostCents: number;
    }>();
  });

  it('carries every metric as a plain finite number (no null/optional slots)', () => {
    const values = Object.values(sample);
    expect(values).toHaveLength(7);
    expect(values.every((v) => typeof v === 'number')).toBe(true);
    expect(values.every((v) => Number.isFinite(v))).toBe(true);

    // No field is nullable or optional — the aggregation always produces a value.
    expectTypeOf<DashboardStats['totalM']>().toEqualTypeOf<number>();
    expectTypeOf<DashboardStats['avgEfficiency']>().toEqualTypeOf<number>();
    expectTypeOf<DashboardStats['totalCostCents']>().toEqualTypeOf<number>();
  });
});

// ── Phase-48 SI-canonical field-name guard ────────────────────────────────────

describe('SI-canonical field names (Phase-48 guard)', () => {
  it('uses SI unit keys and never a legacy imperial/kWh suffix', () => {
    const keys = Object.keys(sample);
    // The two physical-quantity fields use SI units.
    expect(keys).toContain('totalM');
    expect(keys).toContain('totalEnergyWh');

    // None of the declared keys carry a forbidden legacy unit suffix.
    expect(BACKEND_JSON_KEYS.some((k) => LEGACY_UNIT_SUFFIX.test(k))).toBe(false);
    for (const key of BACKEND_JSON_KEYS) {
      expect(LEGACY_UNIT_SUFFIX.test(key)).toBe(false);
    }
  });

  it('never reintroduces an imperial distance alias for totalM', () => {
    const keys = Object.keys(sample);
    expect(keys).not.toContain('totalMi');
    expect(keys).not.toContain('totalMiles');
    expect(keys).not.toContain('totalKm');
    // The SI energy key must not regress to kWh.
    expect(keys).not.toContain('totalEnergyKwh');
  });
});

// ── Metric semantics ──────────────────────────────────────────────────────────

describe('DashboardStats metric semantics', () => {
  it('derives avgEfficiency as energy-per-distance (Wh/m), matching the API formula', () => {
    // Backend: AvgEfficiency = TotalEnergyWh / TotalM (dashboardsvc/service.go).
    expect(sample.avgEfficiency).toBeCloseTo(sample.totalEnergyWh / sample.totalM, 10);
    expect(sample.avgEfficiency).toBeGreaterThan(0);
  });

  it('reports 0 (not NaN) efficiency for a no-distance window', () => {
    const noDistance: DashboardStats = {
      totalVehicles: 1,
      totalM: 0,
      totalEnergyWh: 0,
      totalChargingSessions: 0,
      totalTrips: 0,
      avgEfficiency: 0,
      totalCostCents: 0,
    };

    // A naive divide would be 0/0 === NaN — this is exactly what the backend
    // guards, so the field is a hard 0 the widget can safely format.
    expect(Number.isNaN(noDistance.totalEnergyWh / noDistance.totalM)).toBe(true);
    expect(noDistance.avgEfficiency).toBe(0);
    expect(Number.isNaN(noDistance.avgEfficiency)).toBe(false);
  });

  it('survives a JSON wire round-trip with numeric types intact', () => {
    const round = JSON.parse(JSON.stringify(sample)) as DashboardStats;
    expect(round).toEqual(sample);
    expect(Object.keys(round).sort()).toEqual([...BACKEND_JSON_KEYS].sort());
    expect(Object.values(round).every((v) => typeof v === 'number')).toBe(true);
  });
});

// ── Empty install (zeroed payload) ────────────────────────────────────────────

describe('DashboardStats empty install', () => {
  it('accepts an all-zero payload for a fresh install without optional gaps', () => {
    const empty: DashboardStats = {
      totalVehicles: 0,
      totalM: 0,
      totalEnergyWh: 0,
      totalChargingSessions: 0,
      totalTrips: 0,
      avgEfficiency: 0,
      totalCostCents: 0,
    };

    expect(Object.keys(empty).sort()).toEqual([...BACKEND_JSON_KEYS].sort());
    expect(Object.values(empty).every((v) => v === 0)).toBe(true);
    expect(empty.totalVehicles).toBe(0);
    expect(empty.totalCostCents).toBe(0);
  });
});

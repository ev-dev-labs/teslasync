/**
 * `types/driving.ts` — data-contract regression harness.
 *
 * `driving.ts` is a pure type-declaration module (~30 interfaces, no runtime
 * code), so a smoke import proves nothing and asserting the interfaces back to
 * themselves is tautological. What actually matters is that the ONE production
 * bridge between the Go backend's snake_case JSON and these (mostly camelCase)
 * interfaces — `camelCaseKeys()` in `@/lib/resilience`, invoked by `request()`
 * in `@/api/client` — keeps emitting objects that satisfy every interface, with
 * the exact SI-canonical field names the interfaces document. If a JSON tag is
 * renamed on the backend or a converter drops a key, the pages silently break
 * with no type error to catch it (tsconfig excludes test files from `tsc`). So
 * this suite pins the contract at RUNTIME through the real producer — the same
 * strategy `drive-detail/types.test.ts` uses.
 *
 * Backend fixtures below are built from the real Go `json:"…"` tags
 * (internal/models/drive, internal/api/{drivetrain,speedprofile,regen,routeeff}
 * handlers) so a genuine backend drift would flip an assertion here.
 *
 * Regression pin: the `SpeedBucket` power field is SI `avg_power_w` (watts), not
 * the legacy `avg_power_kw`/`avgPowerKw`. The only consumer
 * (`SpeedProfileWidget`) read the legacy name and therefore always computed a
 * flat-zero efficiency line before this was fixed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { camelCaseKeys } from '@/lib/resilience';
import { request, __resetSudoStateForTests } from '@/api/client';
import type {
  Drive,
  DriveDetail,
  DrivePosition,
  DriveTelemetryPoint,
  DriveScore,
  DrivingStats,
  DrivingDynamicsData,
  AccelerationDistributionData,
  DrivetrainHealthData,
  SpeedProfileData,
  SpeedBucket,
  RegenEfficiencyData,
  RouteEfficiencyData,
  RouteSummary,
  DrivingCoachData,
  CoachPatterns,
  CoachWeeklyTrend,
  CoachRecommendation,
  CoachDriveScore,
  TripLocation,
  TripPlanPreferences,
  TripPlanRequest,
  TripPlanRoute,
  TripLeg,
  TripChargeStop,
  TripWeatherImpact,
  TripSOCPoint,
  TripPlan,
  GeocodeResult,
} from './driving';

/* ── Runtime helpers ────────────────────────────────────────────────────── */

/** Asserts `v` is a non-null object and returns it as an indexable record. */
function asRecord(v: unknown): Record<string, unknown> {
  expect(v).not.toBeNull();
  expect(typeof v).toBe('object');
  return v as Record<string, unknown>;
}

/** Asserts every key in `keys` is present on `v`; returns the record. */
function expectHasKeys(v: unknown, keys: readonly string[]): Record<string, unknown> {
  const rec = asRecord(v);
  for (const k of keys) expect(rec).toHaveProperty(k);
  return rec;
}

/** A minimal fetch Response stand-in for the `request()` success path. */
function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetSudoStateForTests();
});

/* ── The producer itself ────────────────────────────────────────────────── */

describe('camelCaseKeys — the snake→camel bridge every interface relies on', () => {
  it('exposes BOTH snake and camel forms and preserves nulls + nesting', () => {
    const out = asRecord(
      camelCaseKeys({ avg_power_w: 5000, end_ts: null, nested: { start_lat: 47.6 } }),
    );
    // Dual-shape: consumers may read either casing.
    expect(out.avg_power_w).toBe(5000);
    expect(out.avgPowerW).toBe(5000);
    // Null survives the transform (not coerced to undefined/0).
    expect(out.endTs).toBeNull();
    // Recursion reaches nested objects.
    expect(asRecord(out.nested).startLat).toBe(47.6);
  });

  it('maps arrays element-by-element and leaves scalars untouched', () => {
    const out = camelCaseKeys([{ battery_level: 70 }, { battery_level: 55 }]) as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out[0].batteryLevel).toBe(70);
    expect(out[1].batteryLevel).toBe(55);
    // Primitives pass through unchanged.
    expect(camelCaseKeys(42)).toBe(42);
    expect(camelCaseKeys('x')).toBe('x');
    expect(camelCaseKeys(null)).toBeNull();
  });
});

/* ── Drive + DriveDetail ────────────────────────────────────────────────── */

const backendDrive = {
  id: 7,
  vehicle_id: 2,
  start_ts: '2025-03-01T10:00:00Z',
  end_ts: '2025-03-01T10:45:00Z',
  duration_s: 2700,
  distance_m: 36000,
  start_address: 'A St',
  end_address: 'B Ave',
  start_lat: 47.6,
  start_lon: -122.3,
  end_lat: 47.62,
  end_lon: -122.29,
  start_battery_pct: 82,
  end_battery_pct: 66,
  energy_used_wh: 7200,
  regen_energy_wh: 900,
  avg_speed_mps: 15,
  max_speed_mps: 30,
  avg_power_w: 4000,
  outside_temp_avg_c: 14,
  inside_temp_avg_c: 21,
  score: 88,
  ended_status: 'parked',
  created_at: '2025-03-01T10:45:05Z',
  updated_at: '2025-03-01T10:45:05Z',
};

const DRIVE_KEYS: ReadonlyArray<keyof Drive> = [
  'id', 'vehicleId', 'startTs', 'endTs', 'durationS', 'distanceM',
  'startAddress', 'endAddress', 'startLat', 'startLon', 'endLat', 'endLon',
  'startBatteryPct', 'endBatteryPct', 'energyUsedWh', 'regenEnergyWh',
  'avgSpeedMps', 'maxSpeedMps', 'avgPowerW', 'outsideTempAvgC', 'insideTempAvgC',
  'score', 'endedStatus', 'createdAt', 'updatedAt',
];

describe('Drive contract (via camelCaseKeys over a backend Drive payload)', () => {
  it('exposes every declared camelCase key with SI-canonical names + right types', () => {
    const drive = camelCaseKeys(backendDrive) as Drive;
    expectHasKeys(drive, DRIVE_KEYS as readonly string[]);

    // SI numerics arrive as real numbers under their canonical names.
    expect(typeof drive.durationS).toBe('number');
    expect(drive.distanceM).toBe(36000);
    expect(drive.energyUsedWh).toBe(7200);
    expect(drive.avgSpeedMps).toBe(15);
    expect(drive.avgPowerW).toBe(4000);
    expect(typeof drive.startTs).toBe('string');

    // Phase-48 guard: NO legacy unit-suffixed aliases leak through.
    expect(drive).not.toHaveProperty('avgPowerKw');
    expect(drive).not.toHaveProperty('distanceMi');
    expect(drive).not.toHaveProperty('avgSpeedMph');
  });

  it('keeps nullable fields as null (never coerced) when the API omits values', () => {
    const backendNulls = {
      ...backendDrive,
      id: 8,
      end_ts: null,
      start_address: null,
      end_address: null,
      start_lat: null,
      start_lon: null,
      end_lat: null,
      end_lon: null,
      start_battery_pct: null,
      end_battery_pct: null,
      energy_used_wh: null,
      regen_energy_wh: null,
      avg_speed_mps: null,
      max_speed_mps: null,
      avg_power_w: null,
      outside_temp_avg_c: null,
      inside_temp_avg_c: null,
      score: null,
      ended_status: null,
    };
    const drive = camelCaseKeys(backendNulls) as Drive;

    const nullable: ReadonlyArray<keyof Drive> = [
      'endTs', 'startAddress', 'endAddress', 'startLat', 'startLon', 'endLat', 'endLon',
      'startBatteryPct', 'endBatteryPct', 'energyUsedWh', 'regenEnergyWh',
      'avgSpeedMps', 'maxSpeedMps', 'avgPowerW', 'outsideTempAvgC', 'insideTempAvgC',
      'score', 'endedStatus',
    ];
    for (const k of nullable) expect(drive[k]).toBeNull();
    // Required, non-nullable fields still carry values.
    expect(drive.id).toBe(8);
    expect(drive.durationS).toBe(2700);
  });

  it('DriveDetail carries positions + telemetry arrays alongside the Drive fields', () => {
    const backendDetail = {
      ...backendDrive,
      positions: [{ latitude: 47.6, longitude: -122.3, battery_level: 70, timestamp: '2025-03-01T10:00:00Z' }],
      telemetry: [{ timestamp: '2025-03-01T10:00:00Z', speed: 12, battery_level: 69 }],
    };
    const detail = camelCaseKeys(backendDetail) as DriveDetail;

    expect(Array.isArray(detail.positions)).toBe(true);
    expect(Array.isArray(detail.telemetry)).toBe(true);
    expect(detail.positions).toHaveLength(1);
    // Inherited Drive field is still present + SI.
    expect(detail.distanceM).toBe(36000);
    // Array elements are camelCased too.
    expect(detail.positions[0].batteryLevel).toBe(70);
  });
});

/* ── DrivePosition + DriveTelemetryPoint ────────────────────────────────── */

describe('DrivePosition contract', () => {
  const backendPos = {
    latitude: 47.6,
    longitude: -122.3,
    speed: 20,
    power: 4,
    battery_level: 70,
    timestamp: '2025-03-01T10:00:00Z',
    created_at: '2025-03-01T10:00:01Z',
    inside_temp: 22,
    outside_temp: 12,
    ideal_range: 300000,
    rated_range: 290000,
    odometer: 900000,
    elevation: 90,
    fan_status: 2,
    is_climate_on: true,
  };

  it('maps every field and exposes the dual created_at / createdAt shape', () => {
    const pos = camelCaseKeys(backendPos) as DrivePosition;
    const keys: ReadonlyArray<keyof DrivePosition> = [
      'latitude', 'longitude', 'speed', 'power', 'batteryLevel', 'timestamp',
      'insideTemp', 'outsideTemp', 'idealRange', 'ratedRange', 'odometer',
      'elevation', 'fanStatus', 'isClimateOn',
    ];
    expectHasKeys(pos, keys as readonly string[]);

    expect(pos.batteryLevel).toBe(70);
    expect(pos.isClimateOn).toBe(true);
    // Both casings of the timestamp alias survive the transform.
    expect(pos.created_at).toBe('2025-03-01T10:00:01Z');
    expect(pos.createdAt).toBe('2025-03-01T10:00:01Z');
  });

  it('tolerates null sensor fields', () => {
    const pos = camelCaseKeys({
      ...backendPos,
      speed: null,
      power: null,
      inside_temp: null,
      outside_temp: null,
      ideal_range: null,
      rated_range: null,
      odometer: null,
      elevation: null,
      fan_status: null,
      is_climate_on: null,
    }) as DrivePosition;

    expect(pos.speed).toBeNull();
    expect(pos.elevation).toBeNull();
    expect(pos.isClimateOn).toBeNull();
    // Non-null required field unaffected.
    expect(pos.batteryLevel).toBe(70);
  });
});

describe('DriveTelemetryPoint contract', () => {
  it('maps the full telemetry sample including tire-pressure quartet', () => {
    const backend = {
      timestamp: '2025-03-01T10:00:00Z',
      created_at: '2025-03-01T10:00:01Z',
      speed: 12,
      power: 7,
      battery_level: 82,
      outside_temp: 14,
      inside_temp: 21,
      driver_temp: 20,
      passenger_temp: 19,
      elevation: 125,
      ideal_range: 400000,
      rated_range: 380000,
      est_range: 360000,
      odometer: 1_000_000,
      soc: 81.5,
      usable_soc: 80,
      tire_pressure_fl: 250000,
      tire_pressure_fr: 260000,
      tire_pressure_rl: 255000,
      tire_pressure_rr: 265000,
      is_climate_on: true,
      fan_status: 5,
      latitude: 47.6,
      longitude: -122.3,
    };
    const point = camelCaseKeys(backend) as DriveTelemetryPoint;
    const keys: ReadonlyArray<keyof DriveTelemetryPoint> = [
      'timestamp', 'speed', 'power', 'batteryLevel', 'outsideTemp', 'insideTemp',
      'driverTemp', 'passengerTemp', 'elevation', 'idealRange', 'ratedRange',
      'estRange', 'odometer', 'soc', 'usableSoc', 'tirePressureFl', 'tirePressureFr',
      'tirePressureRl', 'tirePressureRr', 'isClimateOn', 'fanStatus', 'latitude', 'longitude',
    ];
    expectHasKeys(point, keys as readonly string[]);

    expect(point.tirePressureFl).toBe(250000);
    expect(point.tirePressureRr).toBe(265000);
    expect(point.usableSoc).toBe(80);
    expect(point.isClimateOn).toBe(true);
  });
});

/* ── DriveScore + DrivingStats + DrivingDynamics + AccelerationDistribution ── */

describe('DriveScore contract', () => {
  it('maps aggregate fields and constrains trend to the declared union', () => {
    const score = camelCaseKeys({
      overall: 88,
      efficiency: 90,
      smoothness: 84,
      speed_discipline: 79,
      grade: 'A-',
      total_drives: 120,
      trend: 'up',
    }) as DriveScore;

    expectHasKeys(score, [
      'overall', 'efficiency', 'smoothness', 'speedDiscipline', 'grade', 'totalDrives', 'trend',
    ]);
    expect(score.speedDiscipline).toBe(79);
    expect(score.totalDrives).toBe(120);

    const TRENDS: ReadonlyArray<DriveScore['trend']> = ['up', 'down', 'flat'];
    expect(TRENDS).toContain(score.trend);
  });
});

describe('DrivingStats contract', () => {
  it('exposes distance/speed/efficiency aggregates under their canonical names', () => {
    const stats = camelCaseKeys({
      total_drives: 120,
      total_distance_km: 4200.5,
      total_duration_s: 360000,
      avg_efficiency_wh_km: 168,
      avg_speed_kmh: 42,
      top_speed_kmh: 140,
      regen_ratio: 0.18,
      regen_energy_wh: 30000,
      co2_saved_kg: 540,
    }) as DrivingStats;

    expectHasKeys(stats, [
      'totalDrives', 'totalDistanceKm', 'totalDurationS', 'avgEfficiencyWhKm',
      'avgSpeedKmh', 'topSpeedKmh', 'regenRatio', 'regenEnergyWh', 'co2SavedKg',
    ]);
    expect(stats.totalDistanceKm).toBe(4200.5);
    expect(stats.avgEfficiencyWhKm).toBe(168);
    expect(stats.co2SavedKg).toBe(540);
  });
});

describe('DrivingDynamicsData + AccelerationDistributionData contracts', () => {
  it('maps the g-force dynamics block', () => {
    const dyn = camelCaseKeys({
      max_acceleration_g: 0.4,
      max_braking_g: 0.5,
      max_cornering_g: 0.3,
      avg_acceleration_g: 0.1,
      avg_braking_g: 0.12,
      smoothness_score: 82,
    }) as DrivingDynamicsData;

    expectHasKeys(dyn, [
      'maxAccelerationG', 'maxBrakingG', 'maxCorneringG',
      'avgAccelerationG', 'avgBrakingG', 'smoothnessScore',
    ]);
    expect(dyn.maxAccelerationG).toBe(0.4);
    expect(dyn.smoothnessScore).toBe(82);
  });

  it('carries the acceleration histogram as a number array', () => {
    const dist = camelCaseKeys({ values: [0.1, 0.2, 0.3] }) as AccelerationDistributionData;
    expect(Array.isArray(dist.values)).toBe(true);
    expect(dist.values).toEqual([0.1, 0.2, 0.3]);
  });
});

/* ── DrivetrainHealthData ───────────────────────────────────────────────── */

describe('DrivetrainHealthData contract', () => {
  it('maps temps + status and constrains overallHealth to the declared union', () => {
    const health = camelCaseKeys({
      front_motor_temp_c: 45,
      rear_motor_temp_c: 50,
      inverter_temp_c: 55,
      battery_temp_c: 30,
      motor_status: 'ok',
      overall_health: 'good',
    }) as DrivetrainHealthData;

    expectHasKeys(health, [
      'frontMotorTempC', 'rearMotorTempC', 'inverterTempC', 'batteryTempC',
      'motorStatus', 'overallHealth',
    ]);
    expect(health.batteryTempC).toBe(30);
    expect(typeof health.motorStatus).toBe('string');

    const STATES: ReadonlyArray<DrivetrainHealthData['overallHealth']> = ['good', 'warning', 'critical'];
    expect(STATES).toContain(health.overallHealth);
  });

  it('tolerates null motor/inverter temps when no signal is present', () => {
    const health = camelCaseKeys({
      front_motor_temp_c: null,
      rear_motor_temp_c: null,
      inverter_temp_c: null,
      battery_temp_c: null,
      motor_status: 'unknown',
      overall_health: 'warning',
    }) as DrivetrainHealthData;

    expect(health.frontMotorTempC).toBeNull();
    expect(health.batteryTempC).toBeNull();
    expect(health.overallHealth).toBe('warning');
  });
});

/* ── SpeedProfileData + SpeedBucket (SI regression pin) ─────────────────── */

describe('SpeedProfileData + SpeedBucket contract', () => {
  const backendProfile = {
    distribution: [
      { speed_bucket: '0-20', readings: 100, avg_power_w: 5000 },
      { speed_bucket: '20-40', readings: 210, avg_power_w: 8000 },
    ],
    avg_speed_mps: 15,
    peak_speed_mps: 33,
    optimal_speed_mps: 20,
  };

  it('maps the distribution array and the SI hero aggregates', () => {
    const profile = camelCaseKeys(backendProfile) as SpeedProfileData;
    expectHasKeys(profile, ['distribution', 'avgSpeedMps', 'peakSpeedMps', 'optimalSpeedMps']);
    expect(Array.isArray(profile.distribution)).toBe(true);
    expect(profile.distribution).toHaveLength(2);
    expect(profile.optimalSpeedMps).toBe(20);
  });

  it('exposes SpeedBucket power as SI avg_power_w/avgPowerW — NOT legacy kW', () => {
    const profile = camelCaseKeys(backendProfile) as SpeedProfileData;
    const bucket: SpeedBucket = profile.distribution[0];

    // Dual-shape SI power under both casings.
    expect(bucket.avg_power_w).toBe(5000);
    expect(bucket.avgPowerW).toBe(5000);
    // Dual-shape bucket label.
    expect(bucket.speed_bucket).toBe('0-20');
    expect(bucket.speedBucket).toBe('0-20');
    expect(bucket.readings).toBe(100);

    // Regression pin: the legacy kW aliases must never resurface — a consumer
    // reading them (SpeedProfileWidget did) would get undefined → flat-zero.
    const raw = bucket as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty('avg_power_kw');
    expect(raw).not.toHaveProperty('avgPowerKw');
    // The removed dead legacy fields are likewise absent.
    expect(raw).not.toHaveProperty('percentage');
    expect(raw).not.toHaveProperty('driveCount');
  });
});

/* ── RegenEfficiencyData + RouteEfficiencyData ──────────────────────────── */

describe('RegenEfficiencyData contract', () => {
  it('maps regen totals and ratio', () => {
    const regen = camelCaseKeys({
      total_regen_wh: 30000,
      total_drive_wh: 150000,
      regen_ratio: 0.2,
      monthly_avg_regen: 2500,
      free_charges: 1.2,
    }) as RegenEfficiencyData;

    expectHasKeys(regen, [
      'totalRegenWh', 'totalDriveWh', 'regenRatio', 'monthlyAvgRegen', 'freeCharges',
    ]);
    expect(regen.totalRegenWh).toBe(30000);
    expect(regen.regenRatio).toBe(0.2);
    expect(regen.freeCharges).toBeCloseTo(1.2, 6);
  });
});

describe('RouteEfficiencyData + RouteSummary contract', () => {
  it('maps the routes array and per-route summary fields', () => {
    const eff = camelCaseKeys({
      routes: [
        {
          start_location: 'Home',
          end_location: 'Work',
          trip_count: 40,
          avg_distance_km: 22.5,
          avg_efficiency: 165,
          best_efficiency: 150,
          worst_efficiency: 190,
        },
      ],
      total_routes: 5,
      total_trips: 120,
    }) as RouteEfficiencyData;

    expectHasKeys(eff, ['routes', 'totalRoutes', 'totalTrips']);
    expect(Array.isArray(eff.routes)).toBe(true);
    expect(eff.totalTrips).toBe(120);

    const route: RouteSummary = eff.routes[0];
    expectHasKeys(route, [
      'startLocation', 'endLocation', 'tripCount', 'avgDistanceKm',
      'avgEfficiency', 'bestEfficiency', 'worstEfficiency',
    ]);
    expect(route.startLocation).toBe('Home');
    expect(route.avgDistanceKm).toBe(22.5);
    expect(route.tripCount).toBe(40);
  });
});

/* ── Driving Coach (snake-declared interfaces) ──────────────────────────── */

describe('DrivingCoachData contract', () => {
  const coach: DrivingCoachData = {
    overall_score: 82,
    efficiency_wh_km: 168,
    best_efficiency_wh_km: 140,
    total_drives_analyzed: 60,
    style_breakdown: { efficient: 30, moderate: 20, aggressive: 10 },
    patterns: {
      hard_accel_pct: 12,
      hard_brake_pct: 8,
      highway_pct: 40,
      short_trip_pct: 15,
      cold_start_pct: 10,
    },
    weekly_trend: [{ week: '2025-W09', score: 80, efficiency: 170, drives: 12 }],
    recommendations: [{ category: 'accel', impact: 'high', tip: 'Ease off the pedal' }],
    per_drive_scores: [
      { drive_id: 7, date: '2025-03-01', score: 88, style: 'efficient', efficiency: 160, distance: 36 },
    ],
  };

  it('preserves the snake_case keys the coach page reads directly', () => {
    const produced = camelCaseKeys(coach) as DrivingCoachData;
    expectHasKeys(produced, [
      'overall_score', 'efficiency_wh_km', 'best_efficiency_wh_km',
      'total_drives_analyzed', 'style_breakdown', 'patterns',
      'weekly_trend', 'recommendations', 'per_drive_scores',
    ]);
    expect(produced.overall_score).toBe(82);
    expect(produced.style_breakdown.efficient).toBe(30);
    expect(Array.isArray(produced.weekly_trend)).toBe(true);
  });

  it('models the nested patterns / trend / recommendation / per-drive shapes', () => {
    const patterns: CoachPatterns = coach.patterns;
    const trend: CoachWeeklyTrend = coach.weekly_trend[0];
    const rec: CoachRecommendation = coach.recommendations[0];
    const perDrive: CoachDriveScore = coach.per_drive_scores[0];

    expect(patterns.highway_pct).toBe(40);
    expect(trend.week).toBe('2025-W09');
    expect(trend.drives).toBe(12);

    const IMPACTS: ReadonlyArray<CoachRecommendation['impact']> = ['high', 'medium', 'low'];
    const STYLES: ReadonlyArray<CoachDriveScore['style']> = ['efficient', 'moderate', 'aggressive'];
    expect(IMPACTS).toContain(rec.impact);
    expect(STYLES).toContain(perDrive.style);
    expect(perDrive.drive_id).toBe(7);
  });
});

/* ── Trip Planner (snake-declared interfaces) ───────────────────────────── */

describe('Trip Planner contract', () => {
  const origin: TripLocation = { lat: 47.6, lng: -122.3, name: 'Seattle' };
  const destination: TripLocation = { lat: 45.5, lng: -122.7, name: 'Portland' };
  const prefs: TripPlanPreferences = {
    max_charge_stops: 2,
    speed_factor: 1,
    include_weather: true,
    prefer_superchargers: true,
  };

  it('models a fully-specified TripPlanRequest with optional preferences + waypoints', () => {
    const req: TripPlanRequest = {
      vehicle_id: 2,
      origin,
      destination,
      waypoints: [{ lat: 46.6, lng: -122.5, name: 'Rest Stop' }],
      current_soc: 80,
      charge_limit_soc: 90,
      min_arrival_soc: 15,
      departure_time: '2025-03-01T09:00:00Z',
      preferences: prefs,
    };
    expect(req.origin.name).toBe('Seattle');
    expect(req.waypoints).toHaveLength(1);
    expect(req.preferences?.max_charge_stops).toBe(2);
    expect(req.min_arrival_soc).toBe(15);
  });

  it('models the composite TripPlan (route, legs, stops, weather, soc curve) in SI', () => {
    const route: TripPlanRoute = {
      total_distance_m: 280000,
      total_duration_s: 12000,
      driving_duration_s: 10800,
      charging_duration_s: 1200,
      total_energy_wh: 52000,
      estimated_cost: 14.5,
      arrival_soc: 22,
      feasible: true,
      is_estimate: false,
    };
    const leg: TripLeg = {
      from: origin,
      to: destination,
      distance_m: 280000,
      duration_s: 10800,
      energy_wh: 52000,
      start_soc: 80,
      arrival_soc: 22,
    };
    const stop: TripChargeStop = {
      name: 'Centralia Supercharger',
      location: { lat: 46.7, lng: -122.9, name: 'Centralia' },
      charge_from_soc: 22,
      charge_to_soc: 80,
      charge_duration_s: 1200,
      energy_wh: 30000,
      cost: 9,
      is_recommended: true,
    };
    const weather: TripWeatherImpact = { avg_temp_c: 8, efficiency_factor: 0.95, note: 'Cool' };
    const socPoint: TripSOCPoint = { distance_m: 140000, soc: 51 };
    const plan: TripPlan = {
      route,
      legs: [leg],
      charge_stops: [stop],
      weather_impact: weather,
      soc_curve: [socPoint],
    };

    // SI units on disk: meters, seconds, watt-hours.
    expect(plan.route.total_distance_m).toBe(280000);
    expect(plan.route.feasible).toBe(true);
    expect(plan.legs[0].energy_wh).toBe(52000);
    expect(plan.charge_stops[0].is_recommended).toBe(true);
    expect(plan.soc_curve[0].soc).toBe(51);
    expect(plan.weather_impact.avg_temp_c).toBe(8);

    // camelCaseKeys keeps the snake keys the planner UI reads.
    const produced = camelCaseKeys(plan) as TripPlan;
    expectHasKeys(produced.route, ['total_distance_m', 'charging_duration_s', 'is_estimate']);
  });

  it('allows a null avg_temp_c on TripWeatherImpact', () => {
    const weather: TripWeatherImpact = { avg_temp_c: null, efficiency_factor: 1, note: 'n/a' };
    expect(weather.avg_temp_c).toBeNull();
    expect(weather.efficiency_factor).toBe(1);
  });

  it('models a GeocodeResult with snake display_name preserved', () => {
    const geo = camelCaseKeys({ display_name: 'Seattle, WA', lat: 47.6, lng: -122.3 }) as GeocodeResult;
    expect(geo.display_name).toBe('Seattle, WA');
    expect(geo.lat).toBe(47.6);
    expect(geo.lng).toBe(-122.3);
  });
});

/* ── End-to-end: the real request() client produces conforming objects ──── */

describe('request() end-to-end — the production path onto driving.ts shapes', () => {
  it('resolves a Drive-conforming object from a backend Drive payload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(backendDrive));
    vi.stubGlobal('fetch', fetchMock);

    const drive = await request<Drive>('/drives/7');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The single fetch hit the /api/v1-prefixed URL with no double prefix.
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/v1/drives/7');
    // Real snake→camel bridge produced SI camelCase fields.
    expect(drive.vehicleId).toBe(2);
    expect(drive.distanceM).toBe(36000);
    expect(drive.avgPowerW).toBe(4000);
    expect(drive).not.toHaveProperty('avgPowerKw');
  });

  it('resolves an array of Drives from a list payload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([backendDrive, { ...backendDrive, id: 9 }]));
    vi.stubGlobal('fetch', fetchMock);

    const drives = await request<Drive[]>('/drives');

    expect(Array.isArray(drives)).toBe(true);
    expect(drives).toHaveLength(2);
    expect(drives[0].energyUsedWh).toBe(7200);
    expect(drives[1].id).toBe(9);
  });
});

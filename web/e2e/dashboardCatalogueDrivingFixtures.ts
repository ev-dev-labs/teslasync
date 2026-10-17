import type { Page } from '@playwright/test';
import type { Drive, FleetAnalytics, StatsSummary, Trip } from '../src/api/types';
import type {
  AccelerationDistributionData, DriveScore, DriveTelemetryPoint, DrivingCoachData,
  DrivingDynamicsData, RegenEfficiencyData, RouteEfficiencyData, SpeedProfileData,
} from '../src/types/driving';
import { fulfillApiFixture, mockDrive, type MockApiController } from './mockApi';

export const drivingReadings: Record<string, RegExp> = {
  'recent-drives': /(?:Home|Office|17\.40)/,
  'drive-score': /Score: 100\.00/,
  'recent-drives-list': /(?:Home|Office|17\.40)/,
  'drive-score-gauge': /92/,
  'drive-efficiency-chart': /241\.38/,
  'speed-heatmap': /64\.80/,
  'driving-dynamics': /(?:Max g0\.40|0\.10[\s\S]*Accel)/,
  'speed-profile': /57\.60/,
  'regen-efficiency': /20\.00%/,
  'route-efficiency': /(?:Home|Office|160)/,
  'driving-coach': /92/,
  'trip-summary': /Review journey/,
  'drive-telemetry': /17\.40/,
};

export async function installCatalogueDrivingSources(page: Page, mocks: MockApiController) {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 1800_000).toISOString();
  const date = now.slice(0, 10);
  const drive: Drive = {
    ...mockDrive, start_ts: earlier, end_ts: now, duration_s: 1800, distance_m: 17_400,
    start_soc_pct: 78, end_soc_pct: 72, energy_used_wh: 4200, regen_energy_wh: 840,
    avg_speed_mps: 18, max_speed_mps: 28, inside_temp_avg_c: 21, score: 92,
    created_at: earlier, updated_at: now,
  };
  const stats = (value: number): StatsSummary => ({
    min: value, max: value, avg: value, median: value, p95: value, count: 1,
  });
  const fleet: FleetAnalytics = {
    period_days: 30, total_vehicles: 1, total_distance_km: 17.4, total_drives: 1,
    total_charging_sessions: 1, total_energy_kwh: 42.1, total_cost: 6.74,
    avg_efficiency_wh_km: 4200 / 17.4,
    most_efficient_vehicle: { id: 7, name: 'Aurora', efficiency: 4200 / 17.4 },
    vehicle_comparison: [{ id: 7, name: 'Aurora', distance: 17.4, energy: 4.2, efficiency: 4200 / 17.4, drives: 1 }],
    drive_analytics: {
      hourly_pattern: [{ hour: 8, drives: 1, distance: 17.4 }],
      day_of_week: [{ day: 'Saturday', drives: 1, distance: 17.4, avg_distance: 17.4 }],
      speed_distribution: [{ range: '60-80', count: 1 }],
      distance_distribution: [{ range: '10-20', count: 1 }],
      speed_stats: stats(64.8), power_stats: stats(9600), regen_stats: stats(840),
      duration_stats: stats(1800), distance_stats: stats(17_400),
      efficiency_stats: stats(4200 / 17.4),
      daily_trend: [{ date, drives: 1, distance: 17.4, efficiency: 4200 / 17.4 }],
      temp_vs_efficiency: [{ temp: 18, efficiency: 4200 / 17.4, distance: 17.4 }],
      temperature: { inside: stats(21), outside: stats(18) },
    },
    charging_analytics: {
      hourly_pattern: [{ hour: 23, charges: 1, energy: 42.1 }],
      charger_types: [{ type: 'AC', count: 1 }], charger_brands: [{ brand: 'Tesla', count: 1 }],
      monthly_trend: [{ month: date.slice(0, 7), energy: 42.1, cost: 6.74, sessions: 1,
        avg_power: 9800, gas_cost: 12, savings: 5.26 }],
      power_stats: stats(9800), duration_stats: stats(11400), energy_stats: stats(42_100),
      cost_stats: stats(6.74), start_battery_dist: [{ range: '20-30', count: 1 }],
      efficiency_stats: stats(90),
    },
    battery_trend: [{ date, health_score: 94, capacity_wh: 74_200, degradation_pct: 6, range_km: 438, cycle_count: 184 }],
  };
  const telemetry: DriveTelemetryPoint[] = [earlier, now].map((timestamp, index) => ({
    timestamp, speed: index ? 18 : 12, power: index ? 9600 : 7200, batteryLevel: index ? 72 : 78,
    outsideTemp: 18, insideTemp: 21, driverTemp: 21, passengerTemp: 21,
    elevation: 100 + index * 10, idealRange: 430_000, ratedRange: 410_000, estRange: 400_000,
    odometer: 32_100_000 + index * 17_400, soc: index ? 72 : 78, usableSoc: index ? 72 : 78,
    tirePressureFl: 290, tirePressureFr: 290, tirePressureRl: 290, tirePressureRr: 290,
    isClimateOn: false, fanStatus: 0, latitude: 37.4, longitude: -122.1,
  }));
  const fixtures: Record<string, unknown> = {
    '/drives': [drive],
    '/analytics/fleet': fleet,
    '/drives/101/telemetry': telemetry,
    '/drives/score': {
      overall: 92, efficiency: 94, smoothness: 88, speedDiscipline: 94,
      grade: 'A', totalDrives: 1, trend: 'up',
    } satisfies DriveScore,
    '/drives/dynamics': {
      maxAccelerationG: 0.3, maxBrakingG: 0.4, maxCorneringG: 0.2,
      avgAccelerationG: 0.1, avgBrakingG: 0.15, smoothnessScore: 88,
    } satisfies DrivingDynamicsData,
    '/drives/acceleration-distribution': { values: [0.05, 0.1, 0.15, 0.2, 0.3] } satisfies AccelerationDistributionData,
    '/analytics/speed-profile': {
      distribution: [
        { speed_bucket: '0-5', readings: 20, avg_power_w: 3000 },
        { speed_bucket: '16-22', readings: 80, avg_power_w: 9600 },
      ], avgSpeedMps: 18, peakSpeedMps: 28, optimalSpeedMps: 16,
    } satisfies SpeedProfileData,
    '/analytics/regen': {
      vehicleId: 7, totalRegenWh: 840, totalDriveWh: 4200, regenRatio: 20,
      monthlyAvgRegen: 9600, freeCharges: 0.011, batteryCapacityWh: 74_200, capacitySource: 'model_estimate',
      monthlySummary: [{ month: date.slice(0, 7), driveCount: 1, avgRegenPowerKw: 9.6, avgSpeed: 40, avgEfficiency: 241.38 }],
      // The legacy embedded per-drive shape is not used by the widget; canonical /drives carries the evidence.
      drives: [],
    } satisfies RegenEfficiencyData,
    '/analytics/route-efficiency': {
      totalRoutes: 1, totalTrips: 4, routes: [{
        startLocation: 'Home', endLocation: 'Office', tripCount: 4,
        avgDistanceKm: 17.4, avgEfficiency: 160, bestEfficiency: 150, worstEfficiency: 180,
      }],
    } satisfies RouteEfficiencyData,
    '/analytics/driving-coach': {
      overall_score: 92, efficiency_wh_km: 241.38, best_efficiency_wh_km: 220,
      total_drives_analyzed: 1, style_breakdown: { efficient: 100, moderate: 0, aggressive: 0 },
      patterns: { hard_accel_pct: 2, hard_brake_pct: 1, highway_pct: 40, short_trip_pct: 0, cold_start_pct: 0 },
      weekly_trend: [{ week: date, score: 92, efficiency: 241.38, drives: 1 }],
      recommendations: [{ category: 'efficiency', impact: 'medium', tip: 'Maintain smooth acceleration.' }],
      per_drive_scores: [{ drive_id: 101, date: earlier, score: 92, style: 'efficient', efficiency: 241.38, distance: 17.4 }],
    } satisfies DrivingCoachData,
    '/trips': [{
      id: 1, vehicle_id: 7, name: 'Review journey', start_date: earlier, end_date: now,
      started_at: earlier, ended_at: now, total_distance_m: 17_400, total_energy_wh: 4200,
      total_duration_s: 1800, total_cost: 1.2, drive_count: 1, charge_count: 0, created_at: now,
    }] satisfies Trip[],
  };
  for (const [path, json] of Object.entries(fixtures)) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, mocks, { json });
    });
  }
}

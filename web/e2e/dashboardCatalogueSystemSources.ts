import type { AuditLogEntry, BackupRun } from '../src/types/admin';
import type { ExportJobSummary } from '../src/api/hooks/useExports';
import type { DashboardStats } from '../src/types/dashboard';
import type { CaptureStats, VersionInfo, VehicleStateReadings } from '../src/api/types';
import type { SignalHistoryResponse } from '../src/types/telemetry';
import { catalogueWire, type CatalogueSources } from './dashboardCatalogueRemainingSources';
import { mockVehicle } from './mockApi';

export function catalogueSystemSources(now: string): CatalogueSources {
  const earlier = new Date(Date.parse(now) - 3_600_000).toISOString();
  const audit: AuditLogEntry[] = [{
    id: '1', action: 'Catalogue settings updated', resource: 'settings',
    details: 'Local acceptance record', createdAt: now,
  }];
  const backups: BackupRun[] = [{
    id: '1', configId: '1', status: 'completed', backupType: 'full',
    fileSize: 2_097_152, createdAt: earlier, completedAt: now, durationMs: 1250,
  }];
  const exports: ExportJobSummary[] = [{
    id: '1', type: 'drives', format: 'csv', status: 'processing',
    vehicle_id: 7, record_count: 12, file_size: 0, created_at: now,
  }, {
    id: '2', type: 'charging', format: 'json', status: 'processing',
    vehicle_id: 7, record_count: 22, file_size: 0, created_at: earlier,
  }];
  const stats: DashboardStats = {
    totalVehicles: 1, totalTrips: 123, totalChargingSessions: 22,
    totalM: 1_234_000, totalEnergyWh: 222120, avgEfficiency: 0.18, totalCostCents: 3554,
  };
  const version: VersionInfo = {
    app_version: 'catalogue-2026.10', chart_version: 'catalogue-2026.10',
    go_version: 'go1.25.0', os: 'linux', arch: 'amd64', uptime_seconds: 3600, goroutines: 12,
  };
  const capture: CaptureStats = {
    mongodb_enabled: false, capture_enabled: false, total_documents: 0, distinct_vins: [],
  };
  const state: VehicleStateReadings = {
    vehicle_id: 7, state: 'driving', latitude: 37.4, longitude: -122.1, heading: 90,
    speed: 18, power: 14000, battery_level: 72, rated_range: 410000, ideal_range: 430000,
    odometer: 32_100_000, inside_temp: 21, outside_temp: 18, is_climate_on: false,
    is_charging: false, charger_power: 0, charge_rate: 0, time_to_full_charge: 0,
    is_locked: true, sentry_mode: true, software_version: '2026.26.3',
  };
  const history: SignalHistoryResponse = {
    vehicleId: 7, signal: 'Soc', from: earlier, to: now, count: 4,
    data: [69, 70, 71, 72].map((valueNum, index) => ({
      timestamp: new Date(Date.parse(earlier) + index * 1_200_000).toISOString(),
      valueNum,
    })),
  };
  return {
    '/system/audit': catalogueWire(audit), '/backup/runs': catalogueWire(backups),
    '/export/jobs': exports,
    '/dashboard/stats': stats, '/system/version': version,
    '/dev-tools/telemetry-capture/stats': capture,
    '/vehicles/7/state': {
      vehicle: mockVehicle, state, live: true, observed_at: now, freshness: 'fresh',
      verified_fields: Object.keys(state), data_source: 'signal_store',
    },
    '/vehicles/states': {
      now, total: 1, limit: 100, offset: 0, counts: { resolved: 1, missing: 0, failed: 0 },
      vehicles: [{
        vehicle_id: 7, outcome: 'resolved', state, live: true, observed_at: now,
        freshness: 'fresh', verified_fields: Object.keys(state), data_source: 'signal_store',
      }],
    },
    '/signals/7/available': ['Soc'],
    '/signals/7/live': { signals: { Soc: { value: 72, timestamp: now } } },
    '/signals/7/Soc/history': catalogueWire(history),
  };
}

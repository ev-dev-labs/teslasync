import type { ClimateState } from '../src/types/vehicle-systems';
import type { RedisSignalsResponse } from '../src/api/devtools';
import type { TOTPStatus, VehicleInfoEnvelope, TeslaJSONValue } from '../src/api/types';
import type { ExportColumnsResponse } from '../src/api/hooks/useExports';
import type { AdvancedPage, ChargingForensicsPage, FirmwareCanary, FederatedStatusPage } from '../src/types/advancedIntelligence';
import { serviceReport, warrantyReport, catalogReport } from '../src/features/service-intelligence/pages/ServiceIntelligencePage.closure.fixtures';
import { firmware, hazards, forensicsItem, modelCard, quality, observation, sentinel } from '../src/features/advanced-intelligence/pages/advancedIntelligenceClosure.fixtures';
import { journeySession } from './operationalbrief-contracts/trips.fixtures';
import { catalogueWire } from './dashboardCatalogueRemainingSources';
import { cardLayoutSupplementalPaths, resolveCardLayoutSupplementalSource } from './cardLayoutSupplementalSources';
import { cardLayoutOwnershipSources, resolveCardLayoutDayLog } from './cardLayoutOwnershipSources';
import { cardLayoutObservabilitySources } from './cardLayoutObservabilitySources';
import { cardLayoutDiagnosticSources } from './cardLayoutDiagnosticSources';
import { cardLayoutWorkspaceSources } from './cardLayoutWorkspaceSources';
import { cardLayoutPhysicsSources } from './cardLayoutPhysicsSources';
import { cardLayoutRuntimeSources, resolveCardLayoutUsageHistory } from './cardLayoutRuntimeSources';
import { cardLayoutDownstreamSources } from './cardLayoutDownstreamSources';
import { catalogueDailyMileage } from './dashboardCatalogueVehicleFixtures';

const now = '2026-08-26T16:00:00.000Z';
const climate = [
  { timestamp: '2026-08-26T15:59:00.000Z', insideTemp: 22, outsideTemp: 18, driverTempSetting: 21, hvacPower: true, fanSpeed: 2 },
  { timestamp: now, insideTemp: 21, outsideTemp: 18, driverTempSetting: 21, hvacPower: true, fanSpeed: 2 },
] satisfies ClimateState[];
const redis = {
  vehicle_id: 7, signal_count: 1,
  signals: { BatteryLevel: { value: 70, type: 'number', observed_at: now, source: 'redis', timestamp_provenance: 'observation', freshness: 'stale', read_availability: 'available' } },
  meta: { live_signal_store_mode: 'hybrid', redis_key: 'vehicle:7:signals', redis_field_count: 1, l1_signal_count: 1, l1_last_seen_at: now, l2_last_seen_at: now },
} satisfies RedisSignalsResponse;
const roles = { data: { roles: ['owner', 'driver'] }, fetched_at: now } satisfies VehicleInfoEnvelope<TeslaJSONValue>;
const totp = { mode: 'session', activated: true, backup_codes_remaining: 3 } satisfies TOTPStatus;

const columns: Record<string, ExportColumnsResponse> = {
  drives: {
    type: 'drives', supports_selection: true,
    columns: [
      { name: 'id', label: 'ID', always_included: true },
      { name: 'vehicle_id', label: 'Vehicle ID', always_included: true },
      { name: 'start_date', label: 'Start date', always_included: false },
      { name: 'end_date', label: 'End date', always_included: false },
      { name: 'distance_m', label: 'Distance (m)', always_included: false },
      { name: 'duration_s', label: 'Duration (s)', always_included: false },
      { name: 'max_speed_mps', label: 'Max speed (m/s)', always_included: false },
    ],
  },
  charging: {
    type: 'charging', supports_selection: true,
    columns: [
      { name: 'id', label: 'ID', always_included: true },
      { name: 'vehicle_id', label: 'Vehicle ID', always_included: true },
      { name: 'started_at', label: 'Started at', always_included: false },
      { name: 'ended_at', label: 'Ended at', always_included: false },
      { name: 'total_energy_added_wh', label: 'Energy added (Wh)', always_included: false },
      { name: 'start_soc_pct', label: 'Start SoC (%)', always_included: false },
      { name: 'end_soc_pct', label: 'End SoC (%)', always_included: false },
      { name: 'peak_power_w', label: 'Peak power (W)', always_included: false },
      { name: 'duration_s', label: 'Duration (s)', always_included: false },
    ],
  },
};

const sources = {
  ...cardLayoutOwnershipSources,
  ...cardLayoutObservabilitySources,
  ...cardLayoutDiagnosticSources,
  ...cardLayoutWorkspaceSources,
  ...cardLayoutPhysicsSources,
  ...cardLayoutRuntimeSources,
  ...cardLayoutDownstreamSources,
  '/auth/totp': totp,
  '/climate': catalogueWire(climate),
  '/journey/sessions': [journeySession],
  '/dev-tools/redis-signals': redis,
  '/service-intelligence/vehicles/7': serviceReport,
  '/service-intelligence/vehicles/7/warranty': warrantyReport,
  '/admin/service-intelligence/communications/status': catalogReport,
  '/vehicles/7/enterprise-roles': roles,
};

export const cardLayoutContractPaths = Array.from(new Set([
  ...Object.keys(sources), '/exports/columns',
  '/day-log',
  '/system/api-usage/history',
  '/mileage/daily',
  ...cardLayoutSupplementalPaths,
  '/advanced-intelligence/firmware-canary',
  '/advanced-intelligence/charging-forensics',
  '/advanced-intelligence/road-hazards',
  '/advanced-intelligence/federated-learning/model-cards',
  '/advanced-intelligence/behavioral-sentinel',
]));

/** Unknown paths, vehicles and export catalogs must reach the strict unmatched handler. */
export function resolveCardLayoutContractSource(url: URL): unknown | undefined {
  const pathname = url.pathname.replace(/^\/api\/v1/, '');
  const vehicle = url.searchParams.get('vehicle_id');
  if (vehicle !== null && vehicle !== '7') return undefined;
  if (pathname === '/mileage/daily') {
    const query = [...url.searchParams.entries()].sort();
    if (query.length !== 3 || query[0][0] !== 'days' || !['90', '366'].includes(query[0][1])
      || query[1][0] !== 'timezone' || query[1][1] !== 'UTC'
      || query[2][0] !== 'vehicle_id' || query[2][1] !== '7') return undefined;
    return catalogueDailyMileage(now);
  }
  const dayLog = resolveCardLayoutDayLog(url);
  if (dayLog !== undefined) return dayLog;
  const usageHistory = resolveCardLayoutUsageHistory(url);
  if (usageHistory !== undefined) return usageHistory;
  const supplemental = resolveCardLayoutSupplementalSource(url);
  if (supplemental !== undefined) return supplemental;
  if (Object.hasOwn(sources, pathname)) return sources[pathname as keyof typeof sources];
  if (pathname === '/exports/columns') {
    const type = url.searchParams.get('type') ?? '';
    if (Object.hasOwn(columns, type)) return columns[type];
    if (['account', 'analytics', 'backup'].includes(type)) {
      return { type, supports_selection: false, columns: [] } satisfies ExportColumnsResponse;
    }
    return undefined;
  }
  const limit = Number(url.searchParams.get('limit') ?? 25);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return undefined;
  const page = { total: 1, limit, offset };
  if (pathname === '/advanced-intelligence/behavioral-sentinel') {
    return { ...sentinel, ...page, items: offset === 0 ? sentinel.items : [] };
  }
  if (pathname === '/advanced-intelligence/firmware-canary') {
    return { ...page, items: offset === 0 ? [firmware] : [] } satisfies AdvancedPage<FirmwareCanary>;
  }
  if (pathname === '/advanced-intelligence/charging-forensics') {
    return { ...page, items: offset === 0 ? [forensicsItem] : [], data_quality: quality, generated_at: now } satisfies ChargingForensicsPage;
  }
  if (pathname === '/advanced-intelligence/road-hazards') {
    return { ...hazards, ...page, items: offset === 0 ? hazards.items : [] };
  }
  if (pathname === '/advanced-intelligence/federated-learning/model-cards') {
    return {
      ...page, vehicle_id: 7, items: offset === 0 ? [modelCard] : [],
      total_epsilon_budget: 2, total_epsilon_spent: 1.5,
      privacy_statement: 'Synthetic local aggregate evidence; no raw trips or locations are uploaded.',
      data_quality: quality, evidence: [observation], generated_at: now,
    } satisfies FederatedStatusPage;
  }
  return undefined;
}

import type {
  APICallLogResponse, APIUsage, ErrorStats, PushSubscriptionRow, TeslaUsageSeries,
} from '../src/api/types';
import type { WebErrorsSummary } from '../src/types/admin';
import type { ActivityListResponse } from '../src/types/activity';
import type { SharedDriveData } from '../src/types/sharing';
import type { OcppChargePoint, OcppSession } from '../src/api/hooks/useOcpp';
import type { WaitOracleSite } from '../src/api/hooks/useCharging';
import type { ChargePlan } from '../src/types/charging';
import { measuredWindow } from './operationalbrief-contracts/charging.fixtures';
import { RULES } from './operationalbrief-contracts/actions.fixtures';
import { catalogueWire } from './dashboardCatalogueRemainingSources';

const now = '2026-08-26T16:00:00.000Z';
const earlier = '2026-08-26T15:00:00.000Z';
const amounts = { signals: 100, commands: 0, data_requests: 1, wakes: 0, estimated_usd: 0.01 };
const cycle = { start: '2026-08-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z', ...amounts };
const usage = {
  current: cycle, history: [], rate_source: 'synthetic',
  disclaimer: 'Synthetic local usage model; not a billing statement.',
} satisfies APIUsage;
const logs = {
  data: [{
    id: 1, ts: now, vehicle_id: 7, service: 'synthetic', http_method: 'GET',
    endpoint: '/vehicles', status_code: 200, duration_ms: 10, error_message: null,
    rate_limited: false, request_body: null, response_body: null,
  }],
  total: 1, limit: 25, offset: 0,
} satisfies APICallLogResponse;
const errors = { total_errors: 0, uptime: '1h', by_code: {} } satisfies ErrorStats;
const webErrors = {
  window_seconds: 3600, windowSeconds: 3600, total: 0, top: [], as_of: now, asOf: now,
} satisfies WebErrorsSummary;
const points = [{
  id: 'synthetic-local', vendor: 'Synthetic', model: 'Local charger',
  serial_number: 'synthetic', firmware_version: '1.0', last_boot_at: earlier,
  last_seen_at: now, active_sessions: 0,
  connectors: [{ connector_id: 1, status: 'Available', error_code: 'NoError', info: '', updated_at: now }],
}] satisfies OcppChargePoint[];
const sessions = [{
  transaction_id: 1, charge_point_id: 'synthetic-local', connector_id: 1,
  started_at: earlier, start_meter_wh: 0, ended_at: now, end_meter_wh: 1000,
  stop_reason: 'Local', energy_delivered_wh: 1000,
}] satisfies OcppSession[];
const plans = [{
  id: 1, vehicle_id: 7, target_soc: 80, depart_by: null,
  scheduled_start: earlier, scheduled_end: now, rate_plan: 'synthetic-flat',
  estimated_kwh: 1, estimated_cost: 0.16, charge_now_cost: 0.16, savings: 0,
  status: 'completed', applied_at: earlier, completed_at: now, created_at: earlier,
}] satisfies ChargePlan[];
const sites = [{ name: 'Synthetic local charger', sessions: 1, lat: 0, lng: 0, last_session: now }] satisfies WaitOracleSite[];
const activity = {
  items: [{
    id: 'drives:101', kind: 'drive', occurred_at: now, vehicle_id: 7,
    title: 'Synthetic recorded drive', summary: 'Recorded local layout evidence.',
    status: 'completed', source_table: 'drives', source_id: 101, path: '/drives/101',
    duration_s: 3600,
  }],
  total: 1, limit: 50, offset: 0, generated_at: now,
} satisfies ActivityListResponse;
const shared = {
  payload_version: 'v2', share_type: 'drive', title: 'Synthetic shared drive',
  description: 'Local browser fixture; no real shared data.',
  drive: {
    date: earlier.slice(0, 10), distance_m: 12000, duration_s: 3600,
    start_address: 'Synthetic origin', end_address: 'Synthetic destination',
    start_battery: 72, end_battery: 70, elevation_gain: 10, elevation_loss: 5,
    max_speed_mps: 10, avg_speed_mps: 12000 / 3600, efficiency_wh_per_m: 0.2,
  },
  vehicle: { model: 'Model Y', color: 'White' },
  map_points: [{ lat: 0, lng: 0 }, { lat: 0.01, lng: 0.01 }],
  elevation_profile: [{ distance_m: 0, elevation_m: 5 }, { distance_m: 12000, elevation_m: 10 }],
  speed_profile: [{ distance_m: 0, speed_mps: 0 }, { distance_m: 12000, speed_mps: 0 }],
  telemetry: [{ distance_m: 0, battery_level: 72, power: 1000, elevation: 5 }],
} satisfies SharedDriveData;
const push = [] satisfies PushSubscriptionRow[];
const openapi = `openapi: 3.0.3
info:
  title: Synthetic local API schema
  version: "1"
paths:
  /vehicles:
    get:
      summary: List synthetic vehicles
      responses:
        "200":
          description: Synthetic vehicle list
`;

export const cardLayoutRuntimeSources: Record<string, unknown> = {
  '/system/api-usage': usage,
  '/api-logs': logs,
  '/system/errors/stats': errors,
  '/admin/web-errors/summary': catalogueWire(webErrors),
  '/ocpp/charge-points': points,
  '/ocpp/sessions': sessions,
  '/charge-planner/history': plans,
  '/waitoracle/sites': sites,
  '/activity': activity,
  '/share/e2e-token': shared,
  '/push/subscribe': push,
  '/automations/1': { ...RULES[0], id: 1 },
  '/charging-sessions': catalogueWire(measuredWindow),
  '/system/openapi': openapi,
};

export function resolveCardLayoutUsageHistory(url: URL): unknown | undefined {
  if (url.pathname !== '/api/v1/system/api-usage/history') return undefined;
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const bucket = url.searchParams.get('bucket');
  if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))
    || Date.parse(start) >= Date.parse(end) || (bucket !== 'day' && bucket !== 'week')) return undefined;
  return {
    start, end, bucket, total: { start, end, ...amounts },
    points: [{ bucket_start: start, ...amounts }],
  } satisfies TeslaUsageSeries;
}

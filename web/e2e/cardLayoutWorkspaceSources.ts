import type { CarbonIntensityCurve, CarbonRecommendation, CarbonSummary } from '../src/api/hooks/useCarbon';
import type { PeriodStats } from '../src/api/hooks/usePeriodStats';
import type { VehicleSilence } from '../src/api/hooks/useVehicles';
import type { SignalDiffServerResponse } from '../src/api/hooks/useTelemetry';
import type { useTeslaFeatureConfig, useTeslaUserOrders, useTeslaUserProfile } from '../src/api/hooks/useUser';
import type { FleetTelemetryCoverageResponse, VehicleSettingsResponse } from '../src/api/types';
import type { UserActivityEntry } from '../src/types/admin';
import type { TcoLedgerResponse } from '../src/types/analytics';

const now = '2026-08-26T16:00:00.000Z';
const carbonCurve = {
  curve: Array.from({ length: 24 }, (_, hour_of_day) => ({ hour_of_day, g_co2_per_kwh: hour_of_day < 6 ? 100 : 200 })),
  min: 100, max: 200, greenest_hours: [0, 1, 2, 3, 4, 5],
  dirtiest_hours: Array.from({ length: 18 }, (_, i) => i + 6),
} satisfies CarbonIntensityCurve;
const carbonSummary = {
  total_energy_kwh: 20, total_co2_kg: 2, gas_equiv_co2_kg: 19.2,
  co2_saved_kg: 17.2, green_score: 100, sessions_scored: 1,
  monthly: [{ month: '2026-08', co2_kg: 2, energy_kwh: 20 }],
} satisfies CarbonSummary;
const carbonRecommendation = {
  current_avg_intensity: 100,
  greenest_window: { start_hour: 0, end_hour: 4, avg_intensity: 100 },
  potential_co2_saving_kg: 0, potential_saving_pct: 0,
} satisfies CarbonRecommendation;
const period = {
  total_distance: 100, total_drives: 4, energy_used: 20,
  avg_efficiency: 200, total_cost: 3.2, co2_saved: 17.2,
} satisfies PeriodStats;
const silence = {
  vehicle_id: 7, status: 'ok', last_seen_at: now, silent_for_s: 0,
  checked_at: now, explanation: 'Synthetic telemetry observed at the review instant.',
} satisfies VehicleSilence;
const settings = {
  settings: [{ key: 'nickname', value: 'Synthetic vehicle', source: 'vehicle' }],
} satisfies VehicleSettingsResponse;
const coverage = {
  categories: [{
    category: 'battery', total_fields: 1, destinations: { signal_log: 1 },
    fields: [{ field: 'BatteryLevel', destination: 'signal_log', subscribed: true }],
  }],
  destination_totals: { signal_log: 1 }, orphan_fields: [],
} satisfies FleetTelemetryCoverageResponse;
const diff = {
  vehicle_id: 7, at_a: '2026-08-26T15:00:00.000Z', at_b: now, count: 1,
  data: [{ name: 'BatteryLevel', value_a: 72, value_b: 70, changed: true }],
} satisfies SignalDiffServerResponse;
const userActivity = [{
  id: 1, ts: now, action: 'settings.updated', entity_type: 'settings',
  entity_id: '1', detail: 'Synthetic local review', ip: null, user_agent: null,
}] satisfies UserActivityEntry[];
const profile = {
  profile: {
    id: 1, email: 'preview@example.invalid', full_name: 'Synthetic account',
    profile_image_url: null, fetched_at: now, created_at: now, updated_at: now,
  },
  fetched_at: now,
} satisfies NonNullable<ReturnType<typeof useTeslaUserProfile>['data']>;
const orders = { orders: [], fetched_at: now } satisfies NonNullable<ReturnType<typeof useTeslaUserOrders>['data']>;
const config = { data: { synthetic_preview: true }, fetched_at: now } satisfies NonNullable<ReturnType<typeof useTeslaFeatureConfig>['data']>;
const ledger = {
  vehicle_id: 7,
  entries: [{
    id: 1, vehicle_id: 7, category: 'maintenance', amount: 25, currency: 'USD',
    incurred_on: '2026-08-26', note: 'Synthetic maintenance', created_at: now,
  }],
  totals: { by_category: { maintenance: 25 }, grand_total: 25, entries: 1 },
} satisfies TcoLedgerResponse;

export const cardLayoutWorkspaceSources: Record<string, unknown> = {
  '/carbon/intensity': carbonCurve,
  '/vehicles/7/carbon/summary': carbonSummary,
  '/vehicles/7/carbon/recommendation': carbonRecommendation,
  '/analytics/period-stats': period,
  '/vehicles/7/silence': silence,
  '/vehicles/7/settings': settings,
  '/tesla/fleet-telemetry/coverage': coverage,
  '/signals/7/diff': diff,
  '/users/me/activity': userActivity,
  '/tesla/user/profile': profile,
  '/tesla/user/orders': orders,
  '/tesla/user/feature-config': config,
  '/analytics/tco/ledger': ledger,
};

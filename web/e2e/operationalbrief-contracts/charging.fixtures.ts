import type { ChargingSession, PhysicsLedger } from '../../src/api/types';
import type { ChargePhysics } from '../../src/types/teslaPhysics';
import type {
  TeslaChargingHistoryEntry,
  TeslaChargingHistoryResponse,
  TeslaChargingSession,
  TeslaChargingSessionResponse,
} from '../../src/api/hooks/useCharging';
import type {
  AutopilotPreview, AutopilotProfile, AutopilotSavings, BillVarianceReport, ChargingOptimizerData,
  CostForecastData, OptimizeChargeResponse, RatePlanInfo,
} from '../../src/types/charging';
import { mockVehicle } from '../mockApi';

export const analysisWindow = '?from=2026-08-01&to=2026-08-31';

// Reuses the evidence-page session with explicit API activity aliases.
export const measuredSession = {
  id: 201, vehicle_id: 7,
  started_at: '2026-08-25T08:00:00.000Z', ended_at: '2026-08-25T09:00:00.000Z',
  startedAt: '2026-08-25T08:00:00.000Z', duration_min: 60,
  start_soc_pct: 0, end_soc_pct: 80, delta_soc_pct: 80,
  start_odometer_m: 100000, end_odometer_m: 100000,
  start_lat: null, start_lng: null, start_place: 'Synthetic home charger',
  total_energy_added_wh: 18000, peak_power_w: 22000, avg_power_w: 18000,
  cost_decimal: 0, cost_currency: 'USD', charger_type: 'AC', cable_type: 'Type 2',
  live: false,
} satisfies ChargingSession;

export const measuredWindow: ChargingSession[] = [
  measuredSession,
  {
    ...measuredSession, id: 202, start_place: 'Synthetic public charger',
    started_at: '2026-08-24T08:00:00.000Z', ended_at: '2026-08-24T09:30:00.000Z',
    startedAt: '2026-08-24T08:00:00.000Z', duration_min: 90,
    start_soc_pct: 10, delta_soc_pct: 70,
    total_energy_added_wh: 36000, peak_power_w: 44000, avg_power_w: 18000,
    cost_decimal: 10.8, charger_type: 'DC',
  },
];

export const zeroSession: ChargingSession = {
  ...measuredSession, total_energy_added_wh: 0, peak_power_w: 0, avg_power_w: 0,
};
export const incompleteSession: ChargingSession = {
  ...measuredSession, ended_at: null, end_soc_pct: null, delta_soc_pct: null,
  duration_min: 0, peak_power_w: null, avg_power_w: null, cost_decimal: null,
  live: true,
};

export const invoicedSession: ChargingSession = {
  ...measuredSession, charger_type: 'Tesla', billed_energy_wh: 20000,
  billed_cost_decimal: 6, billed_currency: 'USD', billed_rate_per_kwh: 0.3,
  billed_source: 'tesla', billed_site: 'Synthetic invoice site', billed_fee_type: 'energy',
};

export const unavailableChargePhysics = {
  session_id: 201, vehicle_id: 7, started_at: measuredSession.started_at,
  ended_at: measuredSession.ended_at, story: [], at_limit_still_plugged_s: null,
  etiquette: { applicable: false, complete_at: null, unplug_at: null, dwell_s: null, honesty: 'No synthetic unplug observations.' },
  schedule: {
    scheduled_mode: null, scheduled_start_at: null, stopped_at: null, charging_resumed_at: null,
    waited_for_schedule: null, charged_anyway: null, unknown: true,
    honesty: 'No synthetic schedule observations.',
  },
  honesty: 'No synthetic physics observations; the session record is independent.',
} satisfies ChargePhysics;

export const unavailableChargeLedger = {
  vehicle_id: 7, kind: 'charge', start: measuredSession.started_at, end: measuredSession.ended_at,
  dynamics: null, drive: null, charge: null, park: null, thermal: null,
  range: null, tires: null, epochs: null, unknown_intervals: [{
    started_at: measuredSession.started_at, ended_at: measuredSession.ended_at,
    duration_s: 3600, reason: 'Synthetic fixture contains no ledger samples.',
  }],
  unknown_hours: 1, black_box: null, truncated: false,
  honesty: 'No synthetic ledger samples; no energy-efficiency claim is available.',
} satisfies PhysicsLedger;

export const optimizer = {
  current_schedule: {
    most_common_start_hour: 0, most_common_day: 'Monday',
    avg_sessions_per_week: 2, home_charging_pct: 0, avg_charge_to_pct: 80,
  },
  cost_analysis: {
    peak_hours: [17, 18], offpeak_hours: [0, 1],
    peak_cost_per_kwh: 0.3, offpeak_cost_per_kwh: 0.1,
    sessions_during_peak_pct: 0, potential_monthly_savings: 0,
  },
  battery_health_score: 80, recommendations: [], weekly_heatmap: [],
} satisfies ChargingOptimizerData;

export const costForecast = {
  historical: [{ month: '2026-08', cost: 10.8, kwh: 54, sessions: 2, cost_per_kwh: 0.2 }],
  forecast: [],
  breakdown: {
    home: { pct: 33.33, avg_cost_per_kwh: 0, monthly_avg: 0 },
    supercharger: { pct: 66.67, avg_cost_per_kwh: 0.3, monthly_avg: 10.8 },
  },
  gas_comparison: {
    avg_km_per_month: 100, gas_cost_per_month: 20, ev_cost_per_month: 10.8,
    monthly_savings: 9.2, annual_savings: 110.4, lifetime_savings: 0,
  },
  insights: [],
} satisfies CostForecastData;

export const billVariance = {
  vehicle_id: 7, measured_sessions: 2, measured_energy_wh: 54000, measured_cost: 10.8,
  invoiced_sessions: 2, invoiced_energy_wh: 56000, invoiced_cost: 16.8,
  energy_delta_wh: -2000, energy_delta_pct: -3.57, cost_delta: -6, cost_delta_pct: -35.71,
  cabinet_loss_pct: 3.57, verdict: 'review',
  explanation: 'Synthetic invoice and measured records cover an independent reconciliation window.',
} satisfies BillVarianceReport;

export const ratePlans: RatePlanInfo[] = [
  { id: 'synthetic-flat', name: 'Synthetic flat rate', utility: 'Synthetic utility' },
];
export const autopilotProfile = {
  vehicle_id: 7, enabled: false, target_soc: 80, ready_by: '07:30',
  rate_plan: 'synthetic-flat', daily_cap_soc: 80, trip_override: false,
  precondition: false, max_amps: 32, battery_capacity_kwh: 75,
} satisfies AutopilotProfile;
export const autopilotSavings = { total_savings: 0, runs: 0 } satisfies AutopilotSavings;
export const optimizedCharge = {
  plan_id: 301, current_soc: 56, target_soc: 80, kwh_needed: 18,
  estimated_duration_hours: 2,
  schedule: {
    start_time: '2026-08-26T22:00:00.000Z', end_time: '2026-08-27T00:00:00.000Z',
    rate_cents_kwh: 10, estimated_cost: 1.8, rate_tier: 'Synthetic flat rate',
  },
  comparison: { charge_now_cost: 5.4, optimized_cost: 1.8, savings: 3.6, savings_percent: 66.67 },
  alternative_windows: [],
  hourly_rates: [
    { hour: 22, rate_cents: 10, tier: 'Synthetic flat rate' },
    { hour: 23, rate_cents: 10, tier: 'Synthetic flat rate' },
  ],
} satisfies OptimizeChargeResponse;

export const autopilotPreview = {
  effective_target_soc: 80, capped_by_health_guardrail: false, ready_by: '07:30',
  kwh_needed: 22.5, estimated_duration_hours: 2.5,
  window: {
    ...optimizedCharge.schedule, end_time: '2026-08-27T00:30:00.000Z', estimated_cost: 2.25,
  },
  charge_now_cost: 6.75, optimized_cost: 2.25, savings: 4.5, savings_percent: 66.67,
  hourly_rates: optimizedCharge.hourly_rates,
  explanation: 'Synthetic estimate from 50% SOC to 80% of a 75 kWh battery; no schedule has been applied.',
} satisfies AutopilotPreview;

const historyEntry = {
  id: 1, session_id: 201, vin: mockVehicle.vin,
  site_location_name: 'Synthetic August site',
  charge_start_datetime: measuredSession.started_at,
  charge_stop_datetime: measuredSession.ended_at,
  country: null, state: null, county: null, postal_code: null,
  billing_type: null, fee_type: null, currency_code: 'USD',
  pricing_type: 'energy', rate_base: 0.3, usage_wh: 18000, total_due: 5.4,
  has_invoice: false, invoice_content_id: null,
  fetched_at: '2026-08-26T16:00:00.000Z', created_at: '2026-08-26T16:00:00.000Z',
} satisfies TeslaChargingHistoryEntry;

export const billingHistory = {
  entries: [
    historyEntry,
    {
      ...historyEntry, id: 2, session_id: 202, site_location_name: 'Synthetic July site',
      charge_start_datetime: '2026-07-25T08:00:00.000Z',
      charge_stop_datetime: '2026-07-25T10:00:00.000Z',
      usage_wh: 36000, total_due: 10.8,
    },
  ],
  // Intentionally differs from both the loaded records and August table.
  summary: { total_sessions: 40, total_wh: 720000, total_spend: 216, avg_cost_per_kwh: 0.3 },
} satisfies TeslaChargingHistoryResponse;

const fleetSession = {
  id: 1, session_id: 201, vin: mockVehicle.vin, charger_id: null,
  site_location_name: 'Synthetic August site',
  charge_start_datetime: measuredSession.started_at,
  charge_stop_datetime: measuredSession.ended_at,
  total_energy_added_wh: 18000, peak_power_kw: 22, max_charge_rate_kw: 18,
  charge_duration_s: 3600, charger_type: 'AC', currency_code: 'USD',
  total_cost: 0, per_kwh_rate: 0, idle_fee: 0, congestion_fee: 0,
  latitude: null, longitude: null,
  fetched_at: '2026-08-26T16:00:00.000Z', created_at: '2026-08-26T16:00:00.000Z',
} satisfies TeslaChargingSession;

export const fleetHistory = {
  sessions: [
    fleetSession,
    {
      ...fleetSession, id: 2, session_id: 202, site_location_name: 'Synthetic July site',
      charge_start_datetime: '2026-07-25T08:00:00.000Z',
      charge_stop_datetime: '2026-07-25T10:00:00.000Z',
      total_energy_added_wh: 36000, total_cost: 10.8, charge_duration_s: 7200,
    },
  ],
  summary: {
    total_sessions: 40, total_wh: 720000, total_cost: 216,
    avg_cost_per_kwh: 0.3, peak_power_kw: 44,
  },
} satisfies TeslaChargingSessionResponse;

export const powershareFields = [
  'PowershareStatus', 'PowershareType', 'PowershareStopReason',
  'PowershareHoursLeft', 'PowershareInstantaneousPowerKW',
] as const;

interface ObservationEnvelope {
  count: number;
  total: number;
  observations: {
    vehicle_id: number;
    ts: string;
    field: string;
    value_kind: 'ValueKindDouble';
    value: number;
  }[];
}

export function zeroPowershareObservation(field: string): ObservationEnvelope {
  const numeric = field === 'PowershareHoursLeft' || field === 'PowershareInstantaneousPowerKW';
  return {
    count: numeric ? 1 : 0,
    total: numeric ? 1 : 0,
    observations: numeric ? [{
      vehicle_id: 7, ts: '2026-08-26T16:00:00.000Z',
      field, value_kind: 'ValueKindDouble', value: 0,
    }] : [],
  };
}

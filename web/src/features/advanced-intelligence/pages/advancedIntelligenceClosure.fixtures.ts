import type {
  CausalExperiment, ChargingForensicsItem, ChargingSiteTwinResponse,
  ComponentSurvival, DataQuality, Evidence, FederatedModelCard,
  FirmwareCanary, HazardPage, JourneyAssuranceResponse, ResiliencePlanResponse,
  SentinelPage, TCOOptimizerResponse, TwinLabResponse,
} from '@/types/advancedIntelligence';
import type { StormguardEvent, StormguardStatus } from '@/api/hooks/useStormguard';

export const quality: DataQuality = {
  status: 'limited',
  sample_count: 0,
  coverage_pct: null,
  window_start: '2026-08-01T00:00:00Z',
  window_end: '2026-08-03T00:00:00Z',
  reasons: ['No meter coverage; do not infer a measured loss.'],
};

export const observation: Evidence = {
  source: 'recorded-session-ledger',
  summary: 'Observed vehicle energy, not a simulated outcome.',
  observed_at: '2026-08-02T00:00:00Z',
  sample_count: 0,
};

export const forensicsItem: ChargingForensicsItem = {
  session_id: 44, started_at: '2026-08-01T00:00:00Z', ended_at: null,
  vehicle_energy_wh: 12000, meter_energy_wh: 15000,
  estimated_loss_wh: 3000, estimated_loss_low_wh: 2000, estimated_loss_high_wh: 4000,
  recorded_cost_minor: 450, expected_cost_minor: 420, cost_discrepancy_minor: 30,
  currency: 'USD', status: 'reconciled',
  evidence: [observation], limitations: ['Loss interval is an estimate, not a meter measurement.'],
};

export const unsupportedForensicsItem: ChargingForensicsItem = {
  ...forensicsItem, session_id: 45,
  vehicle_energy_wh: 0, meter_energy_wh: null,
  estimated_loss_wh: null, estimated_loss_low_wh: null, estimated_loss_high_wh: null,
  recorded_cost_minor: 0, expected_cost_minor: null, cost_discrepancy_minor: null,
  status: 'partial', evidence: [], limitations: ['Tariff unavailable.'],
};

export const firmware: FirmwareCanary = {
  vehicle_id: 7, version: '2026.20', decision: 'insufficient',
  vehicle_regression_pct: 0, peer_regression_pct: null, matched_excess_pct: null,
  window_quality: quality, evidence: [observation],
  limitations: ['Matched peers are incomplete.'], generated_at: '2026-08-03T00:00:00Z',
};

export const survival: ComponentSurvival = {
  vehicle_id: 7, component: 'front-bearing', survival_probability_pct: null,
  horizon_p10_s: 0, horizon_p50_s: null, horizon_p90_s: 7200,
  competing_risks: [
    { risk: 'observed-wear', probability_pct: 0, evidence_count: 0 },
    { risk: 'unmeasured-corrosion', probability_pct: null, evidence_count: 0 },
  ],
  intervention_sensitivity: {
    intervention: 'modeled service only', assumed_hazard_delta_pct: -10, adjusted_p50_s: null,
  },
  data_quality: quality, evidence: [observation], limitations: ['No guaranteed failure date.'],
  generated_at: '2026-08-03T00:00:00Z',
};

export const hazards: HazardPage = {
  items: [{
    hazard_type: 'rough-surface', severity: 'high', confidence_pct: 0,
    observation_count: 0, coarse_cell: 'coarse-cell-only', last_seen: '2026-08-02T00:00:00Z',
    evidence: [observation],
  }],
  total: 36, limit: 18, offset: 0, data_quality: quality,
  limitations: ['No route reconstruction.'], generated_at: '2026-08-03T00:00:00Z',
};

export const sentinel: SentinelPage = {
  items: [{
    finding_type: 'command-observation', severity: 'high', confidence_pct: 0,
    explanation: 'Recorded anomaly; intent is not inferred.', observed_at: observation.observed_at,
    evidence: [observation], limitations: ['Not personal attribution.'],
  }],
  total: 40, limit: 20, offset: 0, data_quality: quality,
  limitations: ['No identity inference.'], generated_at: '2026-08-03T00:00:00Z',
};

export const causal: CausalExperiment = {
  id: 1, vehicle_id: 7, intervention_kind: 'observed-charging-window',
  metric: 'charging_success_pct',
  baseline_start: '2026-08-01T00:00:00Z', baseline_end: '2026-08-03T00:00:00Z',
  treatment_start: '2026-08-04T00:00:00Z', treatment_end: '2026-08-06T00:00:00Z',
  state: 'non_causal', version: 3, baseline_sample_count: 0, treatment_sample_count: 2,
  confounder_coverage_pct: null,
  baseline_energy_wh_per_m: null, treatment_energy_wh_per_m: null, effect_energy_wh_per_m: null,
  baseline_success_pct: 0, treatment_success_pct: null, effect_success_pct: null,
  baseline_speed_mps: null, treatment_speed_mps: null, effect_speed_mps: null,
  created_at: '2026-08-06T00:00:00Z', updated_at: '2026-08-06T00:00:00Z',
  data_quality: quality, evidence: [observation], limitations: ['Association does not prove causality.'],
};

export const modelCard: FederatedModelCard = {
  id: 31, vehicle_id: 7, model_name: 'local-observation-model', model_version: 'v4',
  task: 'efficiency', version: 8, epsilon_budget: 2, epsilon_spent: 1.5, round_count: 4,
  latest_sample_count: 0, latest_metric_wh_per_m: null, latest_status: 'insufficient',
  updated_at: '2026-08-03T00:00:00Z', limitations: ['Local aggregates are not raw uploads.'],
};

export const twin: TwinLabResponse = {
  vehicle_id: 7, model_name: 'calibrated-not-guaranteed',
  baseline: {
    efficiency_wh_per_m: null, usable_battery_wh: 0, ambient_temp_c: null,
    calibration_sample_count: 0,
  },
  scenarios: [
    {
      name: 'Modeled A', horizon_s: 3600,
      battery_delta_wh: null, battery_low_wh: null, battery_high_wh: null,
      range_delta_m: 0, range_low_m: -1000, range_high_m: 2000,
      thermal_delta_c: null, thermal_low_c: null, thermal_high_c: null,
      wear_delta_pct: null, wear_low_pct: null, wear_high_pct: null,
      sensitivity_drivers: [
        { driver: 'first-assumption', effect_pct: 0 },
        { driver: 'second-assumption', effect_pct: -5 },
      ],
    },
    {
      name: 'Unsupported B', horizon_s: 7200,
      battery_delta_wh: null, battery_low_wh: null, battery_high_wh: null,
      range_delta_m: null, range_low_m: null, range_high_m: null,
      thermal_delta_c: null, thermal_low_c: null, thermal_high_c: null,
      wear_delta_pct: null, wear_low_pct: null, wear_high_pct: null,
      sensitivity_drivers: [],
    },
  ],
  data_quality: quality, evidence: [observation],
  limitations: ['Modeled range is not an observed route.'], generated_at: '2026-08-03T00:00:00Z',
};

export const site: ChargingSiteTwinResponse = {
  vehicle_id: 7, utilization_pct: 0, queue_wait_p50_s: 0, queue_wait_p90_s: null,
  peak_demand_w: 0, panel_constraint_pct: 0, projected_unstable: false,
  mitigations: [
    { rank: 2, mitigation: 'Caller order first', queue_delta_pct: -20, peak_delta_w: -2000, assumption: 'Assumed arrivals only.' },
    { rank: 1, mitigation: 'Caller order second', queue_delta_pct: 0, peak_delta_w: 0, assumption: 'No site command.' },
  ],
  assumptions: ['Poisson arrivals are modeled, not live charger telemetry.'],
  data_quality: quality, evidence: [observation], limitations: ['Design approximation only.'],
  generated_at: '2026-08-03T00:00:00Z',
};

export const journey: JourneyAssuranceResponse = {
  vehicle_id: 7, readiness_score_pct: 0, arrival_soc_low_pct: 0,
  arrival_soc_high_pct: null, energy_required_wh: null,
  factors: [
    { factor: 'observed charge', status: 'supported', score_pct: 0, explanation: 'Observed charge, not readiness proof.' },
    { factor: 'modeled weather', status: 'unsupported', score_pct: null, explanation: 'Unknown weather is not zero degrees.' },
  ],
  data_quality: quality, evidence: [observation], limitations: ['No live charger reservations.'],
  generated_at: '2026-08-03T00:00:00Z',
};

export const resilience: ResiliencePlanResponse = {
  vehicle_id: 7, survival_horizon_s: 7200,
  risk_timeline: [
    { time_s: 0, remaining_energy_wh: 12000, risk: 'supported' },
    { time_s: 3600, remaining_energy_wh: 6000, risk: 'modeled' },
    { time_s: 7200, remaining_energy_wh: 0, risk: 'depleted' },
  ],
  load_priorities: [
    { priority: 2, load: 'Caller priority first', action: 'Recommendation only.' },
    { priority: 1, load: 'Caller priority second', action: 'No dispatch performed.' },
  ],
  recommendations: ['Review evacuation reserve.', 'No automatic shedding.'],
  data_quality: quality, evidence: [observation], limitations: ['Modeled outage, not a weather observation.'],
  generated_at: '2026-08-03T00:00:00Z',
};

export const tco: TCOOptimizerResponse = {
  vehicle_id: 7, horizon_s: 31536000, currency: 'USD',
  strategies: [
    {
      name: 'unsupported-price-strategy', home_charging_pct: 80, public_charging_pct: 20,
      projected_cost_minor: null, risk_score_pct: null, convenience_score_pct: 0,
      within_budget: null, pareto_efficient: false, constraints: ['No complete maintenance source.'],
    },
    {
      name: 'zero-recorded-cost-strategy', home_charging_pct: 100, public_charging_pct: 0,
      projected_cost_minor: 0, risk_score_pct: 0, convenience_score_pct: 80,
      within_budget: true, pareto_efficient: true, constraints: ['Supported zero cost only.'],
    },
  ],
  data_quality: quality, evidence: [observation], limitations: ['Optimization is not a purchase.'],
  generated_at: '2026-08-03T00:00:00Z',
};

export const storm: StormguardStatus = {
  config: { vehicle_id: 7, enabled: true, lat: 37.7, lng: -122.4, target_soc: 95, updated_at: '' },
  assessment: { level: 'warning', reason: 'Observed forecast, not modeled outage.', starts_at: null, peak_gust_ms: 28 },
  current_soc: 0,
};

export const stormEvents: StormguardEvent[] = Array.from({ length: 6 }, (_, index): StormguardEvent => ({
  id: index + 1, vehicle_id: 7, level: 'watch', reason: `Recorded storm event ${index + 1}`,
  acted: index === 0, created_at: '2026-08-01T00:00:00Z',
}));

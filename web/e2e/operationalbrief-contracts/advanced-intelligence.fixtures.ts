import type {
  ChargingSiteTwinRequest, ChargingSiteTwinResponse, FederatedRoundResult, FederatedStatusPage,
  JourneyAssuranceRequest, JourneyAssuranceResponse, ResiliencePlanRequest,
  ResiliencePlanResponse, TwinLabRequest, TwinLabResponse,
} from '../../src/types/advancedIntelligence';
import {
  journey, modelCard, observation, quality, resilience, site, storm, stormEvents,
  survival, twin,
} from '../../src/features/advanced-intelligence/pages/advancedIntelligenceClosure.fixtures';

export { observation, quality, storm, stormEvents, survival };

export interface MetricExpectation {
  key: string;
  text: string;
  state: 'value' | 'missing';
}

type SimulationResponse = TwinLabResponse | JourneyAssuranceResponse
  | ChargingSiteTwinResponse | ResiliencePlanResponse;

export interface SimulationCase {
  name: string;
  route: string;
  briefId: string;
  title: string;
  source: string;
  endpoint: string;
  button: string;
  request: TwinLabRequest | Omit<JourneyAssuranceRequest, 'departure_at'>
    | ChargingSiteTwinRequest | ResiliencePlanRequest;
  variants: readonly {
    name: string;
    response: SimulationResponse;
    metrics: readonly MetricExpectation[];
  }[];
}

const value = (key: string, text: string): MetricExpectation => ({ key, text, state: 'value' });
const missing = (key: string): MetricExpectation => ({ key, text: '—', state: 'missing' });

// The zero/unknown responses and all prose come from the released domain fixtures.
// Numeric SI variants exercise display boundaries, not new model conclusions.
export const simulations: readonly SimulationCase[] = [
  {
    name: 'twin', route: '/intelligence/twin-lab',
    briefId: 'advanced-intelligence-twin-brief', title: 'Calibrated baseline',
    source: 'Calibrated twin simulation', endpoint: '/advanced-intelligence/twin-lab/scenarios',
    button: 'Run confirmed simulation',
    request: {
      vehicle_id: 7, confirmed: true,
      scenarios: [
        { name: 'Scenario 1', horizon_s: 3600, distance_m: 50000, speed_mps: 22, outside_temp_c: 20, auxiliary_load_w: 1000 },
        { name: 'Scenario 2', horizon_s: 3600, distance_m: 60000, speed_mps: 27, outside_temp_c: 20, auxiliary_load_w: 1000 },
      ],
    } satisfies TwinLabRequest,
    variants: [
      { name: 'zero-unknown', response: twin, metrics: [
        value('model', twin.model_name), missing('efficiency'),
        value('usable-battery', '0.00 kWh'), value('calibration-samples', '0'),
      ] },
      { name: 'si-values', response: {
        ...twin, baseline: { ...twin.baseline, efficiency_wh_per_m: 0.18, usable_battery_wh: 60000, calibration_sample_count: 12 },
      } satisfies TwinLabResponse, metrics: [
        value('model', twin.model_name), value('efficiency', '0.18 kWh/km'),
        value('usable-battery', '60.00 kWh'), value('calibration-samples', '12'),
      ] },
    ],
  },
  {
    name: 'journey', route: '/intelligence/journey-assurance',
    briefId: 'advanced-intelligence-journey-brief', title: 'Readiness and arrival range',
    source: 'Journey readiness assessment', endpoint: '/advanced-intelligence/journey-assurance/scenarios',
    button: 'Run confirmed readiness assessment',
    request: {
      vehicle_id: 7, confirmed: true, route_distance_m: 250000, reserve_target_pct: 15,
      outside_temp_c: null, average_speed_mps: null, auxiliary_load_w: null,
    } satisfies Omit<JourneyAssuranceRequest, 'departure_at'>,
    variants: [
      { name: 'zero-unknown', response: journey, metrics: [
        value('readiness', '0.00%'), value('arrival-low', '0.00%'),
        missing('arrival-high'), missing('energy-required'),
      ] },
      { name: 'si-values', response: {
        ...journey, readiness_score_pct: 72.5, arrival_soc_low_pct: 15,
        arrival_soc_high_pct: 25, energy_required_wh: 18000,
      } satisfies JourneyAssuranceResponse, metrics: [
        value('readiness', '72.50%'), value('arrival-low', '15.00%'),
        value('arrival-high', '25.00%'), value('energy-required', '18.00 kWh'),
      ] },
    ],
  },
  {
    name: 'site', route: '/intelligence/charging-site-twin',
    briefId: 'advanced-intelligence-site-brief', title: 'Utilization and constraints',
    source: 'Charging site simulation', endpoint: '/advanced-intelligence/charging-site-twin/scenarios',
    button: 'Run confirmed site simulation',
    request: {
      vehicle_id: 7, confirmed: true, charger_count: 8, charger_power_w: 11500,
      panel_limit_w: 100000, arrival_rate_per_s: 0.0008, mean_service_s: 7200,
      arrival_distribution: 'poisson', service_distribution: 'exponential',
      solar_power_w: null, storage_energy_wh: null, fleet_growth_pct: 10,
    } satisfies ChargingSiteTwinRequest,
    variants: [
      { name: 'zero-unknown', response: site, metrics: [
        value('utilization', '0.00%'), value('queue-p50', '0.00 h'), missing('queue-p90'),
        value('peak', '0.00 kW'), value('panel', '0.00%'), value('projection-status', 'Stable'),
      ] },
      { name: 'si-values', response: {
        ...site, utilization_pct: 72.5, queue_wait_p50_s: 3600, queue_wait_p90_s: 7200,
        peak_demand_w: 11500, panel_constraint_pct: 10, projected_unstable: true,
      } satisfies ChargingSiteTwinResponse, metrics: [
        value('utilization', '72.50%'), value('queue-p50', '1.00 h'), value('queue-p90', '2.00 h'),
        value('peak', '11.50 kW'), value('panel', '10.00%'), value('projection-status', 'Unstable'),
      ] },
    ],
  },
  {
    name: 'resilience', route: '/intelligence/emergency-resilience',
    briefId: 'advanced-intelligence-resilience-brief', title: 'Survival horizon',
    source: 'Modeled outage plan', endpoint: '/advanced-intelligence/resilience/plans',
    button: 'Create confirmed outage plan',
    request: {
      vehicle_id: 7, confirmed: true, vehicle_energy_wh: 60000, stationary_storage_wh: 13500,
      expected_solar_wh: 12000, essential_load_w: 1200, outage_duration_s: 172800,
      evacuation_reserve_wh: 15000, restoration_uncertainty_pct: 25,
    } satisfies ResiliencePlanRequest,
    variants: [
      { name: 'zero-checkpoints', response: { ...resilience, survival_horizon_s: 0, risk_timeline: [] } satisfies ResiliencePlanResponse,
        metrics: [value('survival-horizon', '0.00 h'), value('risk-checkpoints', '0')] },
      { name: 'si-values', response: resilience,
        metrics: [value('survival-horizon', '2.00 h'), value('risk-checkpoints', '3')] },
    ],
  },
];

export const federated = {
  vehicle_id: 7, items: [modelCard], total: 1, limit: 12, offset: 0,
  total_epsilon_budget: 2, total_epsilon_spent: 1.5,
  privacy_statement: 'Rounds use local aggregates only. No raw trips, locations, video, command payloads, or gradients are uploaded.',
  data_quality: quality, evidence: [observation], generated_at: '2026-08-03T00:00:00Z',
} satisfies FederatedStatusPage;

export const zeroFederated = {
  ...federated, total_epsilon_budget: 0, total_epsilon_spent: 0,
} satisfies FederatedStatusPage;

export const insufficientRound = {
  model_card: modelCard,
  round: {
    id: 1, model_card_id: modelCard.id, round_number: 5,
    requested_epsilon: 0.1, epsilon_spent: 0, sample_count: 0,
    local_metric_wh_per_m: null, clipped_update_pct: null, status: 'insufficient',
    started_at: '2026-08-03T00:00:00Z', completed_at: '2026-08-03T00:00:00Z',
  },
  data_quality: quality, evidence: [observation],
} satisfies FederatedRoundResult;

/**
 * Advanced Intelligence v1 wire contracts.
 *
 * Property names intentionally mirror the Go `json` tags in
 * `internal/domain/advancedintelligence` exactly. Measurements remain in the
 * API's canonical SI units and are converted only by renderers.
 */

export type QualityStatus = 'sufficient' | 'limited' | 'insufficient';

export interface DataQuality {
  status: QualityStatus;
  sample_count: number;
  coverage_pct: number | null;
  window_start: string | null;
  window_end: string | null;
  reasons: string[];
}

export interface Evidence {
  source: string;
  observed_at: string | null;
  sample_count: number | null;
  summary: string;
}

export interface AdvancedPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface TwinScenarioInput {
  name: string;
  horizon_s: number;
  distance_m: number;
  speed_mps: number;
  outside_temp_c: number | null;
  auxiliary_load_w: number;
}

export interface TwinLabRequest {
  vehicle_id: number;
  confirmed: boolean;
  scenarios: TwinScenarioInput[];
}

export interface TwinBaseline {
  efficiency_wh_per_m: number | null;
  usable_battery_wh: number | null;
  ambient_temp_c: number | null;
  calibration_sample_count: number;
}

export interface SensitivityDriver {
  driver: string;
  effect_pct: number;
}

export interface TwinScenarioOutput {
  name: string;
  horizon_s: number;
  battery_delta_wh: number | null;
  battery_low_wh: number | null;
  battery_high_wh: number | null;
  range_delta_m: number | null;
  range_low_m: number | null;
  range_high_m: number | null;
  thermal_delta_c: number | null;
  thermal_low_c: number | null;
  thermal_high_c: number | null;
  wear_delta_pct: number | null;
  wear_low_pct: number | null;
  wear_high_pct: number | null;
  sensitivity_drivers: SensitivityDriver[];
}

export interface TwinLabResponse {
  vehicle_id: number;
  model_name: string;
  baseline: TwinBaseline;
  scenarios: TwinScenarioOutput[];
  data_quality: DataQuality;
  evidence: Evidence[];
  limitations: string[];
  generated_at: string;
}

export type CanaryDecision = 'rollout' | 'hold' | 'investigate' | 'insufficient';

export interface FirmwareCanary {
  vehicle_id: number;
  version: string | null;
  decision: CanaryDecision;
  vehicle_regression_pct: number | null;
  peer_regression_pct: number | null;
  matched_excess_pct: number | null;
  window_quality: DataQuality;
  evidence: Evidence[];
  limitations: string[];
  generated_at: string;
}

export interface CompetingRisk {
  risk: string;
  probability_pct: number | null;
  evidence_count: number;
}

export interface InterventionSensitivity {
  intervention: string;
  assumed_hazard_delta_pct: number;
  adjusted_p50_s: number | null;
}

export interface ComponentSurvival {
  vehicle_id: number;
  component: string;
  survival_probability_pct: number | null;
  horizon_p10_s: number | null;
  horizon_p50_s: number | null;
  horizon_p90_s: number | null;
  competing_risks: CompetingRisk[];
  intervention_sensitivity: InterventionSensitivity;
  data_quality: DataQuality;
  evidence: Evidence[];
  limitations: string[];
  generated_at: string;
}

export interface HazardCluster {
  hazard_type: string;
  severity: string;
  confidence_pct: number;
  observation_count: number;
  coarse_cell: string;
  last_seen: string;
  evidence: Evidence[];
}

export interface HazardPage extends AdvancedPage<HazardCluster> {
  data_quality: DataQuality;
  limitations: string[];
  generated_at: string;
}

export interface SentinelFinding {
  finding_type: string;
  severity: string;
  confidence_pct: number;
  explanation: string;
  observed_at: string | null;
  evidence: Evidence[];
  limitations: string[];
}

export interface SentinelPage extends AdvancedPage<SentinelFinding> {
  data_quality: DataQuality;
  limitations: string[];
  generated_at: string;
}

export interface ChargingForensicsItem {
  session_id: number;
  started_at: string;
  ended_at: string | null;
  vehicle_energy_wh: number | null;
  meter_energy_wh: number | null;
  estimated_loss_wh: number | null;
  estimated_loss_low_wh: number | null;
  estimated_loss_high_wh: number | null;
  recorded_cost_minor: number | null;
  expected_cost_minor: number | null;
  cost_discrepancy_minor: number | null;
  currency: string | null;
  status: string;
  evidence: Evidence[];
  limitations: string[];
}

export interface ChargingForensicsPage extends AdvancedPage<ChargingForensicsItem> {
  data_quality: DataQuality;
  generated_at: string;
}

export interface JourneyAssuranceRequest {
  vehicle_id: number;
  route_distance_m: number;
  departure_at: string;
  reserve_target_pct: number;
  outside_temp_c: number | null;
  average_speed_mps: number | null;
  auxiliary_load_w: number | null;
  confirmed: boolean;
}

export interface ReadinessFactor {
  factor: string;
  status: string;
  score_pct: number | null;
  explanation: string;
}

export interface JourneyAssuranceResponse {
  vehicle_id: number;
  readiness_score_pct: number | null;
  arrival_soc_low_pct: number | null;
  arrival_soc_high_pct: number | null;
  energy_required_wh: number | null;
  factors: ReadinessFactor[];
  data_quality: DataQuality;
  evidence: Evidence[];
  limitations: string[];
  generated_at: string;
}

export interface ChargingSiteTwinRequest {
  vehicle_id: number;
  charger_count: number;
  charger_power_w: number;
  panel_limit_w: number;
  arrival_rate_per_s: number;
  mean_service_s: number;
  arrival_distribution: 'poisson' | 'fixed';
  service_distribution: 'exponential' | 'deterministic';
  solar_power_w: number | null;
  storage_energy_wh: number | null;
  fleet_growth_pct: number;
  confirmed: boolean;
}

export interface RankedMitigation {
  rank: number;
  mitigation: string;
  queue_delta_pct: number;
  peak_delta_w: number;
  assumption: string;
}

export interface ChargingSiteTwinResponse {
  vehicle_id: number;
  utilization_pct: number;
  queue_wait_p50_s: number | null;
  queue_wait_p90_s: number | null;
  peak_demand_w: number;
  panel_constraint_pct: number;
  projected_unstable: boolean;
  mitigations: RankedMitigation[];
  assumptions: string[];
  data_quality: DataQuality;
  evidence: Evidence[];
  limitations: string[];
  generated_at: string;
}

export interface FederatedModelCard {
  id: number;
  vehicle_id: number;
  model_name: string;
  model_version: string;
  task: string;
  version: number;
  epsilon_budget: number;
  epsilon_spent: number;
  round_count: number;
  latest_sample_count: number | null;
  latest_metric_wh_per_m: number | null;
  latest_status: string | null;
  updated_at: string;
  limitations: string[];
}

export interface FederatedRound {
  id: number;
  model_card_id: number;
  round_number: number;
  requested_epsilon: number;
  epsilon_spent: number;
  sample_count: number;
  local_metric_wh_per_m: number | null;
  clipped_update_pct: number | null;
  status: string;
  started_at: string;
  completed_at: string | null;
}

export interface FederatedStatusPage extends AdvancedPage<FederatedModelCard> {
  vehicle_id: number;
  total_epsilon_budget: number;
  total_epsilon_spent: number;
  privacy_statement: string;
  data_quality: DataQuality;
  evidence: Evidence[];
  generated_at: string;
}

export interface StartFederatedRoundRequest {
  vehicle_id: number;
  model_name: string;
  model_version: string;
  task: string;
  epsilon: number;
  epsilon_budget: number;
  expected_version: number;
  confirmed: boolean;
}

export interface FederatedRoundResult {
  model_card: FederatedModelCard;
  round: FederatedRound;
  data_quality: DataQuality;
  evidence: Evidence[];
}

export interface ResiliencePlanRequest {
  vehicle_id: number;
  vehicle_energy_wh: number;
  stationary_storage_wh: number;
  expected_solar_wh: number;
  essential_load_w: number;
  outage_duration_s: number;
  evacuation_reserve_wh: number;
  restoration_uncertainty_pct: number;
  confirmed: boolean;
}

export interface ResilienceTimelinePoint {
  time_s: number;
  remaining_energy_wh: number;
  risk: string;
}

export interface LoadPriority {
  priority: number;
  load: string;
  action: string;
}

export interface ResiliencePlanResponse {
  vehicle_id: number;
  survival_horizon_s: number;
  risk_timeline: ResilienceTimelinePoint[];
  load_priorities: LoadPriority[];
  recommendations: string[];
  data_quality: DataQuality;
  evidence: Evidence[];
  limitations: string[];
  generated_at: string;
}

export type CausalMetric =
  | 'drive_energy_wh_per_m'
  | 'charging_success_pct'
  | 'average_speed_mps';

export interface CausalExperiment {
  id: number;
  vehicle_id: number;
  intervention_kind: string;
  metric: CausalMetric;
  baseline_start: string;
  baseline_end: string;
  treatment_start: string;
  treatment_end: string;
  state: string;
  version: number;
  baseline_sample_count: number;
  treatment_sample_count: number;
  confounder_coverage_pct: number | null;
  baseline_energy_wh_per_m: number | null;
  treatment_energy_wh_per_m: number | null;
  effect_energy_wh_per_m: number | null;
  baseline_success_pct: number | null;
  treatment_success_pct: number | null;
  effect_success_pct: number | null;
  baseline_speed_mps: number | null;
  treatment_speed_mps: number | null;
  effect_speed_mps: number | null;
  created_at: string;
  updated_at: string;
  data_quality: DataQuality;
  evidence: Evidence[];
  limitations: string[];
}

export interface CreateCausalExperimentRequest {
  vehicle_id: number;
  intervention_kind: string;
  metric: CausalMetric;
  baseline_start: string;
  baseline_end: string;
  treatment_start: string;
  treatment_end: string;
  confirmed: boolean;
}

export interface TCOOptimizerRequest {
  vehicle_id: number;
  horizon_s: number;
  annual_distance_m: number;
  home_charging_pct: number;
  public_charging_pct: number;
  risk_tolerance_pct: number;
  budget_minor: number;
  currency: string;
  confirmed: boolean;
}

export interface TCOStrategy {
  name: string;
  home_charging_pct: number;
  public_charging_pct: number;
  projected_cost_minor: number | null;
  risk_score_pct: number | null;
  convenience_score_pct: number;
  within_budget: boolean | null;
  pareto_efficient: boolean;
  constraints: string[];
}

export interface TCOOptimizerResponse {
  vehicle_id: number;
  horizon_s: number;
  currency: string;
  strategies: TCOStrategy[];
  data_quality: DataQuality;
  evidence: Evidence[];
  limitations: string[];
  generated_at: string;
}

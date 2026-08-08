/**
 * Ownership intelligence API contract.
 *
 * Mirrors `internal/domain/ownershipintel/*.go` exactly. Field names are the Go
 * JSON tags (snake_case). Every numeric quantity is SI-canonical — metres,
 * seconds, watt-hours, watts, metres per second — and every monetary quantity
 * is expressed in ISO-4217 minor units, so no field here carries a legacy
 * `_mi` / `_min` / `_mph` / `_kwh` / `_kw` suffix. Convert at the render
 * boundary with `useUnits()` and `formatCurrencyMinor()`.
 */

export type QualityStatus = 'sufficient' | 'limited' | 'insufficient';

export interface DataQuality {
  status: QualityStatus;
  sample_count: number;
  coverage_pct: number | null;
  window_start: string | null;
  window_end: string | null;
  reasons: string[] | null;
}

export interface Evidence {
  source: string;
  observed_at: string | null;
  sample_count: number | null;
  summary: string;
}

export interface OwnershipPage<T> {
  items: T[] | null;
  total: number;
  limit: number;
  offset: number;
}

export interface OwnershipWindow {
  from: string;
  to: string;
  days: number;
}

/** The `{ items, total }` envelope returned by the un-paginated list routes. */
export interface OwnershipList<T> {
  items: T[] | null;
  total: number;
}

// ---------------------------------------------------------------------------
// 1. Insurance telematics
// ---------------------------------------------------------------------------

export type RiskGrade = 'preferred' | 'standard' | 'substandard' | 'high';
export type RiskFactorDirection = 'higher_is_worse' | 'higher_is_better';

export interface InsurancePolicy {
  id: number;
  vehicle_id: number;
  insurer: string;
  policy_ref: string;
  currency: string;
  annual_premium_minor: number;
  deductible_minor: number;
  coverage_start: string;
  coverage_end: string | null;
  telematics_program: boolean;
  max_discount_pct: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertInsurancePolicyRequest {
  vehicle_id: number;
  insurer: string;
  policy_ref: string;
  currency: string;
  annual_premium_minor: number;
  deductible_minor: number;
  coverage_start: string;
  coverage_end: string | null;
  telematics_program: boolean;
  max_discount_pct: number;
}

export interface RiskFactor {
  code: string;
  label: string;
  direction: RiskFactorDirection;
  observed_rate: number;
  baseline_rate: number;
  rate_unit: string;
  weight: number;
  score: number;
  contribution_pct: number;
  percentile: number | null;
  sample_count: number;
  narrative: string;
}

export interface RiskTrendPoint {
  bucket_start: string;
  risk_score: number;
  distance_m: number;
  drive_count: number;
  loss_cost_index: number;
}

export interface PremiumSimulation {
  currency: string;
  baseline_premium_minor: number;
  modelled_premium_minor: number;
  delta_minor: number;
  delta_pct: number;
  applied_discount_pct: number;
  max_discount_pct: number;
  expected_loss_minor: number | null;
  deductible_minor: number;
  cost_per_distance_minor_per_m: number | null;
}

export interface RiskLever {
  factor_code: string;
  label: string;
  target_reduction_pct: number;
  projected_score_delta: number;
  projected_premium_save_minor: number | null;
  difficulty: string;
  confidence: number;
  payoff_rank: number;
  effort_hours_per_week: number | null;
}

export interface InsuranceRiskProfile {
  vehicle_id: number;
  window: OwnershipWindow;
  policy: InsurancePolicy | null;
  exposure_distance_m: number;
  exposure_duration_s: number;
  drive_count: number;
  night_distance_m: number;
  risk_score: number;
  risk_grade: RiskGrade;
  frequency_index: number;
  severity_index: number;
  loss_cost_index: number;
  peer_percentile: number | null;
  factors: RiskFactor[] | null;
  trend: RiskTrendPoint[] | null;
  premium: PremiumSimulation | null;
  levers: RiskLever[] | null;
  evidence_packet_hash: string;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

// ---------------------------------------------------------------------------
// 2. Utility tariff arbitrage
// ---------------------------------------------------------------------------

export type TariffStructure = 'flat' | 'tou' | 'tiered' | 'real_time' | 'demand';

export interface TariffRate {
  id: number;
  label: string;
  day_mask: number;
  start_minute: number;
  end_minute: number;
  price_minor_per_wh: number;
  tier_upper_wh: number | null;
  season_start_month: number;
  season_end_month: number;
}

export interface Tariff {
  id: number;
  name: string;
  provider: string;
  currency: string;
  structure: TariffStructure;
  standing_charge_minor_per_day: number;
  demand_charge_minor_per_w: number;
  export_price_minor_per_wh: number;
  is_current: boolean;
  version: number;
  rates: TariffRate[] | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTariffRequest {
  name: string;
  provider: string;
  currency: string;
  structure: TariffStructure;
  standing_charge_minor_per_day: number;
  demand_charge_minor_per_w: number;
  export_price_minor_per_wh: number;
  is_current: boolean;
  rates: TariffRate[];
}

export interface TariffSimulationRequest {
  vehicle_id: number;
  window_days: number;
  tariff_ids: number[];
  shiftable_pct: number;
  switch_fee_minor: number;
  confirmed: boolean;
}

export interface TariffBandUsage {
  label: string;
  energy_wh: number;
  share_pct: number;
  price_minor_per_wh: number;
  cost_minor: number;
}

export interface TariffSimulationResult {
  tariff_id: number;
  name: string;
  provider: string;
  structure: TariffStructure;
  currency: string;
  is_current: boolean;
  rank: number;
  observed_energy_wh: number;
  annualised_energy_wh: number;
  energy_cost_minor: number;
  standing_cost_minor: number;
  demand_cost_minor: number;
  annual_cost_minor: number;
  effective_price_minor_per_wh: number;
  delta_vs_current_minor: number | null;
  break_even_days: number | null;
  load_shift_saving_minor: number;
  peak_demand_w: number | null;
  bands: TariffBandUsage[] | null;
  warnings: string[] | null;
}

export interface TariffSimulationResponse {
  vehicle_id: number;
  window: OwnershipWindow;
  session_count: number;
  observed_energy_wh: number;
  shiftable_pct: number;
  results: TariffSimulationResult[] | null;
  best_tariff_id: number | null;
  current_tariff_id: number | null;
  max_saving_minor: number | null;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

// ---------------------------------------------------------------------------
// 3. Charging invoice reconciliation
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'open' | 'reconciled' | 'disputed' | 'settled';
export type MatchState =
  | 'exact'
  | 'probable'
  | 'ambiguous'
  | 'unmatched'
  | 'duplicate'
  | 'uninvoiced';

export interface InvoiceLine {
  id: number;
  line_ref: string;
  occurred_at: string;
  location: string;
  billed_energy_wh: number;
  billed_energy_minor: number;
  billed_idle_minor: number;
  billed_tax_minor: number;
  billed_total_minor: number;
}

export interface ChargingInvoice {
  id: number;
  vehicle_id: number;
  provider: string;
  invoice_ref: string;
  currency: string;
  period_start: string;
  period_end: string;
  billed_total_minor: number;
  status: InvoiceStatus;
  line_count: number;
  version: number;
  lines: InvoiceLine[] | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceRequest {
  vehicle_id: number;
  provider: string;
  invoice_ref: string;
  currency: string;
  period_start: string;
  period_end: string;
  billed_total_minor: number;
  lines: InvoiceLine[];
}

export interface ReconciledLine {
  line: InvoiceLine;
  match_state: MatchState;
  match_confidence_pct: number;
  session_id: number | null;
  session_started_at: string | null;
  measured_energy_wh: number | null;
  energy_delta_wh: number | null;
  energy_delta_pct: number | null;
  time_delta_s: number | null;
  expected_cost_minor: number | null;
  variance_minor: number;
  variance_reasons: string[] | null;
  recoverable: boolean;
  ambiguous: boolean;
}

export interface UninvoicedSession {
  session_id: number;
  started_at: string;
  energy_wh: number;
  location: string;
  narrative: string;
}

export interface VarianceBucket {
  reason: string;
  label: string;
  line_count: number;
  amount_minor: number;
  share_pct: number;
  recoverable: boolean;
}

export interface InvoiceDispute {
  id: number;
  invoice_id: number;
  claimed_minor: number;
  recovered_minor: number;
  status: string;
  reasons: string[] | null;
  note: string;
  opened_at: string;
  resolved_at: string | null;
}

export interface CreateDisputeRequest {
  claimed_minor: number;
  reasons: string[];
  note: string;
  confirmed: boolean;
}

export interface ReconciliationReport {
  invoice: ChargingInvoice;
  lines: ReconciledLine[] | null;
  uninvoiced_sessions: UninvoicedSession[] | null;
  variance_buckets: VarianceBucket[] | null;
  matched_line_count: number;
  unmatched_line_count: number;
  billed_total_minor: number;
  expected_total_minor: number;
  net_variance_minor: number;
  recoverable_minor: number;
  measured_energy_wh: number;
  billed_energy_wh: number;
  energy_variance_wh: number;
  dispute_packet_digest: string;
  disputes: InvoiceDispute[] | null;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

// ---------------------------------------------------------------------------
// 4. Driver fingerprinting
// ---------------------------------------------------------------------------

export interface DriverProfile {
  id: number;
  vehicle_id: number;
  name: string;
  accent: string;
  is_primary: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDriverProfileRequest {
  vehicle_id: number;
  name: string;
  accent: string;
  is_primary: boolean;
}

export interface AssignDriveRequest {
  drive_id: number;
  driver_profile_id: number;
  confirmed: boolean;
}

export interface FingerprintFeature {
  code: string;
  label: string;
  raw_value: number;
  si_unit: string;
  normalised: number;
  weight: number;
}

export interface DriveFingerprint {
  drive_id: number;
  started_at: string;
  distance_m: number;
  duration_s: number;
  features: FingerprintFeature[] | null;
  cluster_id: number;
  driver_profile_id: number | null;
  driver_name: string | null;
  source: string;
  confidence_pct: number;
  distance_to_own_centroid: number;
  distance_to_next_centroid: number | null;
  ambiguous: boolean;
}

export interface DriverCluster {
  cluster_id: number;
  driver_profile_id: number | null;
  driver_name: string | null;
  accent: string;
  drive_count: number;
  share_pct: number;
  distance_m: number;
  duration_s: number;
  energy_wh: number;
  efficiency_wh_per_m: number | null;
  avg_speed_mps: number | null;
  peak_power_w: number | null;
  regen_share_pct: number | null;
  night_share_pct: number;
  aggression_score: number;
  cost_share_minor: number | null;
  centroid: FingerprintFeature[] | null;
  cohesion: number;
  labelled_count: number;
}

export interface DriverAttributionReport {
  vehicle_id: number;
  window: OwnershipWindow;
  profiles: DriverProfile[] | null;
  clusters: DriverCluster[] | null;
  fingerprints: DriveFingerprint[] | null;
  total: number;
  limit: number;
  offset: number;
  separation_score: number | null;
  separation_verdict: string;
  labelled_drive_count: number;
  inferred_drive_count: number;
  ambiguous_drive_count: number;
  currency: string;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

// ---------------------------------------------------------------------------
// 5. Warranty command
// ---------------------------------------------------------------------------

export type WarrantyKind =
  | 'basic'
  | 'drivetrain'
  | 'battery'
  | 'corrosion'
  | 'tires'
  | 'aftermarket'
  | 'extended';

export interface Warranty {
  version: number;
  id: number;
  vehicle_id: number;
  kind: WarrantyKind;
  label: string;
  provider: string;
  start_at: string;
  start_odometer_m: number;
  term_s: number;
  term_distance_m: number;
  capacity_floor_pct: number | null;
  deductible_minor: number;
  currency: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CreateWarrantyRequest {
  vehicle_id: number;
  kind: WarrantyKind;
  label: string;
  provider: string;
  start_at: string;
  start_odometer_m: number;
  term_s: number;
  term_distance_m: number;
  capacity_floor_pct: number | null;
  deductible_minor: number;
  currency: string;
  notes: string;
}

/** Mirrors the warranty_claims_status_check database constraint. */
export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'denied' | 'closed';

export interface WarrantyClaim {
  id: number;
  warranty_id: number;
  title: string;
  status: ClaimStatus;
  opened_at: string;
  closed_at: string | null;
  amount_minor: number;
  evidence_note: string;
  created_at: string;
  updated_at: string;
}

export interface CreateClaimRequest {
  warranty_id: number;
  title: string;
  status: ClaimStatus;
  amount_minor: number;
  evidence_note: string;
  confirmed: boolean;
}

export interface ReadinessCheck {
  code: string;
  label: string;
  satisfied: boolean;
  detail: string;
  severity: string;
}

export interface WarrantyCoverage {
  warranty: Warranty;
  active: boolean;
  elapsed_s: number;
  remaining_s: number;
  time_used_pct: number;
  distance_used_m: number;
  distance_remaining_m: number;
  distance_used_pct: number;
  observed_pace_m_per_s: number | null;
  time_expiry_at: string;
  distance_expiry_at: string | null;
  projected_expiry_at: string;
  binding_limit: string;
  capacity_retention_pct: number | null;
  capacity_floor_breach_at: string | null;
  capacity_headroom_pct: number | null;
  claim_window_closing_s: number | null;
  readiness: ReadinessCheck[] | null;
  readiness_score: number;
  claims: WarrantyClaim[] | null;
  status: string;
  narrative: string;
}

export interface WarrantyOverview {
  vehicle_id: number;
  as_of: string;
  odometer_m: number | null;
  coverages: WarrantyCoverage[] | null;
  active_count: number;
  expiring_soon_count: number;
  next_expiry_at: string | null;
  total_claimed_minor: number;
  currency: string;
  evidence_bundle_hash: string;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

// ---------------------------------------------------------------------------
// 6. Data retention governance
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  id: number;
  dataset: string;
  retention_s: number;
  downsample_after_s: number | null;
  downsample_bucket_s: number | null;
  legal_hold: boolean;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertRetentionPolicyRequest {
  dataset: string;
  retention_s: number;
  downsample_after_s: number | null;
  downsample_bucket_s: number | null;
  legal_hold: boolean;
  enabled: boolean;
}

export interface DatasetInventory {
  dataset: string;
  label: string;
  row_count: number;
  total_bytes: number;
  oldest_at: string | null;
  newest_at: string | null;
  span_s: number | null;
  bytes_per_row: number | null;
  is_hypertable: boolean;
  governed: boolean;
}

export interface RetentionImpact {
  dataset: string;
  label: string;
  policy_id: number | null;
  retention_s: number;
  rows_scanned: number;
  rows_expiring: number;
  rows_downsampling: number;
  rows_retained: number;
  bytes_reclaimable: number;
  reclaim_share_pct: number;
  fidelity_loss_pct: number;
  blocked_by_legal_hold: boolean;
  projected_daily_growth_bytes: number | null;
  runway_days: number | null;
  warnings: string[] | null;
}

export interface RetentionRun {
  id: number;
  dataset: string;
  mode: string;
  rows_scanned: number;
  rows_expiring: number;
  rows_downsampling: number;
  bytes_reclaimable: number;
  fidelity_loss_pct: number;
  blocked_by_hold: boolean;
  executed_at: string;
}

export interface GovernanceSimulationRequest {
  datasets: string[];
  confirmed: boolean;
}

export interface GovernanceOverview {
  as_of: string;
  policies: RetentionPolicy[] | null;
  inventory: DatasetInventory[] | null;
  total_bytes: number;
  governed_bytes: number;
  ungoverned_bytes: number;
  governed_share_pct: number;
  legal_hold_count: number;
  plan_only: boolean;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

export interface GovernanceSimulationResponse {
  as_of: string;
  impacts: RetentionImpact[] | null;
  total_rows_expiring: number;
  total_bytes_reclaimable: number;
  total_fidelity_loss_pct: number;
  plan_only: boolean;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

// ---------------------------------------------------------------------------
// 7. Model trust
// ---------------------------------------------------------------------------

export type TrustGrade = 'trusted' | 'watch' | 'unreliable' | 'unevaluated';

export interface RecordPredictionRequest {
  vehicle_id: number;
  model_name: string;
  target: string;
  si_unit: string;
  predicted_at: string;
  horizon_s: number;
  predicted_value: number;
  predicted_low: number | null;
  predicted_high: number | null;
  reference: string;
}

export interface RecordOutcomeRequest {
  prediction_id: number;
  observed_value: number;
  observed_at: string;
}

export interface Prediction {
  id: number;
  vehicle_id: number;
  model_name: string;
  target: string;
  si_unit: string;
  predicted_at: string;
  horizon_s: number;
  predicted_value: number;
  predicted_low: number | null;
  predicted_high: number | null;
  reference: string;
  observed_value: number | null;
  observed_at: string | null;
  error_value: number | null;
  abs_error_pct: number | null;
  in_interval: boolean | null;
  created_at: string;
}

export interface CalibrationBin {
  lower_pct: number;
  upper_pct: number;
  sample_count: number;
  mean_abs_error: number;
  mean_bias: number;
  coverage_pct: number | null;
}

export interface ModelScorecard {
  model_name: string;
  target: string;
  si_unit: string;
  sample_count: number;
  scored_count: number;
  pending_count: number;
  bias: number | null;
  mean_abs_error: number | null;
  root_mean_square_error: number | null;
  mean_abs_pct_error: number | null;
  median_abs_pct_error: number | null;
  interval_coverage_pct: number | null;
  skill_vs_naive_pct: number | null;
  drift_ratio: number | null;
  drift_status: string;
  trust_grade: TrustGrade;
  trust_score: number;
  calibration: CalibrationBin[] | null;
  narrative: string;
  first_scored_at: string | null;
  last_scored_at: string | null;
  quality: DataQuality;
}

export interface ModelTrustReport {
  vehicle_id: number;
  window: OwnershipWindow;
  scorecards: ModelScorecard[] | null;
  total_predictions: number;
  total_scored: number;
  trusted_count: number;
  watch_count: number;
  unreliable_count: number;
  portfolio_trust_score: number | null;
  recent_predictions: Prediction[] | null;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

// ---------------------------------------------------------------------------
// 8. Jurisdictional compliance
// ---------------------------------------------------------------------------

export interface JurisdictionRate {
  id: number;
  jurisdiction_code: string;
  label: string;
  currency: string;
  road_usage_minor_per_m: number;
  registration_fee_minor: number;
  grid_intensity_g_per_wh: number;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateJurisdictionRateRequest {
  jurisdiction_code: string;
  label: string;
  currency: string;
  road_usage_minor_per_m: number;
  registration_fee_minor: number;
  grid_intensity_g_per_wh: number;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
}

export interface JurisdictionApportionment {
  jurisdiction_code: string;
  label: string;
  currency: string;
  distance_m: number;
  distance_share_pct: number;
  energy_wh: number;
  drive_count: number;
  road_usage_charge_minor: number;
  registration_fee_minor: number;
  total_liability_minor: number;
  emissions_g: number;
  emissions_g_per_m: number | null;
  confidence_pct: number;
}

export interface ComplianceApportionment {
  vehicle_id: number;
  window: OwnershipWindow;
  currency: string;
  jurisdictions: JurisdictionApportionment[] | null;
  total_distance_m: number;
  total_energy_wh: number;
  assigned_distance_m: number;
  unassigned_distance_m: number;
  unassigned_share_pct: number;
  total_road_usage_charge_minor: number;
  total_registration_fee_minor: number;
  total_liability_minor: number;
  total_emissions_g: number;
  drive_count: number;
  digest: string;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

export interface ComplianceFiling {
  id: number;
  vehicle_id: number;
  period_start: string;
  period_end: string;
  status: string;
  total_distance_m: number;
  total_energy_wh: number;
  total_charge_minor: number;
  currency: string;
  digest: string;
  filed_at: string | null;
  created_at: string;
}

export interface CreateFilingRequest {
  vehicle_id: number;
  period_start: string;
  period_end: string;
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// 9. Consumables lifecycle
// ---------------------------------------------------------------------------

export type ConsumableCategory =
  | 'tire'
  | 'cabin_filter'
  | 'hepa_filter'
  | 'wiper'
  | 'brake_fluid'
  | 'coolant'
  | 'brake_pad'
  | 'suspension'
  | 'key_battery'
  | 'other';

export interface ConsumableItem {
  id: number;
  vehicle_id: number;
  category: ConsumableCategory;
  label: string;
  position: string;
  installed_at: string;
  installed_odometer_m: number;
  rated_life_m: number | null;
  rated_life_s: number | null;
  cost_minor: number;
  currency: string;
  retired_at: string | null;
  notes: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateConsumableItemRequest {
  vehicle_id: number;
  category: ConsumableCategory;
  label: string;
  position: string;
  installed_at: string;
  installed_odometer_m: number;
  rated_life_m: number | null;
  rated_life_s: number | null;
  cost_minor: number;
  currency: string;
  notes: string;
}

/** Mirrors the consumable_events_kind_check database constraint. */
export type ConsumableEventKind = 'inspect' | 'rotate' | 'service' | 'replace' | 'note';

export interface ConsumableEvent {
  id: number;
  item_id: number;
  kind: ConsumableEventKind;
  occurred_at: string;
  odometer_m: number | null;
  cost_minor: number;
  note: string;
  created_at: string;
}

export interface CreateConsumableEventRequest {
  item_id: number;
  kind: ConsumableEventKind;
  occurred_at: string;
  odometer_m: number | null;
  cost_minor: number;
  note: string;
}

export interface DutyCycleStress {
  code: string;
  label: string;
  multiplier: number;
  observed_value: number;
  baseline_value: number;
  si_unit: string;
  narrative: string;
}

export interface ConsumableLifecycle {
  item: ConsumableItem;
  events: ConsumableEvent[] | null;
  distance_used_m: number;
  duration_used_s: number;
  distance_life_used_pct: number | null;
  time_life_used_pct: number | null;
  stress_multiplier: number;
  stress_factors: DutyCycleStress[] | null;
  adjusted_life_m: number | null;
  remaining_m: number | null;
  remaining_s: number | null;
  health_pct: number;
  projected_replace_at: string | null;
  binding_limit: string;
  cost_per_m_minor: number | null;
  replacement_cost_minor: number;
  status: string;
  narrative: string;
}

export interface ConsumablesReport {
  vehicle_id: number;
  as_of: string;
  odometer_m: number | null;
  currency: string;
  items: ConsumableLifecycle[] | null;
  due_soon_count: number;
  overdue_count: number;
  next_replace_at: string | null;
  twelve_month_cost_minor: number;
  lifetime_spend_minor: number;
  blended_cost_per_m_minor: number | null;
  fleet_stress_average: number;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

// ---------------------------------------------------------------------------
// 10. Subscription ROI
// ---------------------------------------------------------------------------

export type UsageMetric =
  | 'supercharging_energy'
  | 'driving_distance'
  | 'connectivity_time'
  | 'charging_sessions'
  | 'drive_count'
  | 'none';

export type SubscriptionVerdict = 'keep' | 'review' | 'cancel' | 'unknown' | 'too_early';

/** Mirrors the vehicle_subscriptions_kind_check database constraint. */
export type SubscriptionKind = 'subscription' | 'one_time';

/**
 * Mirrors vehicle_subscriptions_billing_period_check. Valid pairings are
 * enforced by vehicle_subscriptions_billing_kind: `one_time` bills `once`,
 * `subscription` bills `monthly` or `annual`.
 */
export type BillingPeriod = 'monthly' | 'annual' | 'once';

export interface Subscription {
  id: number;
  vehicle_id: number;
  name: string;
  kind: SubscriptionKind;
  billing_period: BillingPeriod;
  price_minor: number;
  currency: string;
  usage_metric: UsageMetric;
  benchmark_minor_per_unit: number;
  started_at: string;
  ended_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSubscriptionRequest {
  vehicle_id: number;
  name: string;
  kind: SubscriptionKind;
  billing_period: BillingPeriod;
  price_minor: number;
  currency: string;
  usage_metric: UsageMetric;
  benchmark_minor_per_unit: number;
  started_at: string;
  ended_at: string | null;
}

export interface SubscriptionROI {
  subscription: Subscription;
  active_days: number;
  spend_to_date_minor: number;
  monthly_cost_minor: number;
  usage_quantity: number | null;
  usage_unit: string;
  usage_per_month: number | null;
  realised_value_minor: number | null;
  net_value_minor: number | null;
  roi_pct: number | null;
  break_even_usage_per_month: number | null;
  utilisation_pct: number | null;
  verdict: SubscriptionVerdict;
  confidence: number;
  narrative: string;
  quality: DataQuality;
}

export interface SubscriptionROIReport {
  vehicle_id: number;
  window: OwnershipWindow;
  currency: string;
  items: SubscriptionROI[] | null;
  total_monthly_cost_minor: number;
  total_spend_to_date_minor: number;
  total_realised_value_minor: number | null;
  portfolio_roi_pct: number | null;
  cancel_candidate_saving_minor: number;
  quality: DataQuality;
  evidence: Evidence[] | null;
}

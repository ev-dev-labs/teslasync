import type {
  ChargingInvoice, ComplianceApportionment, ConsumablesReport, DataQuality,
  DriverAttributionReport, GovernanceOverview, GovernanceSimulationResponse,
  InsuranceRiskProfile, ModelTrustReport, ReconciliationReport, RetentionPolicy,
  Subscription, SubscriptionROIReport, Tariff, TariffSimulationResponse,
  WarrantyOverview,
} from '../../src/types/ownership';

export const recordedWindow = {
  from: '2026-05-01T00:00:00.000Z',
  to: '2026-08-01T00:00:00.000Z',
  days: 92,
};
export const quality: DataQuality = {
  status: 'limited', sample_count: 12, coverage_pct: 75,
  window_start: recordedWindow.from, window_end: recordedWindow.to,
  reasons: ['Synthetic recorded window; not lifetime coverage'],
};
export const evidence = [{
  source: 'recorded ownership fixture', observed_at: recordedWindow.to,
  sample_count: 12, summary: 'Returned operands are not inferred from the loaded list.',
}];

export const subscription: Subscription = {
  id: 901, vehicle_id: 7, name: 'Recorded connectivity', kind: 'subscription',
  billing_period: 'monthly', price_minor: 1250, currency: 'USD',
  usage_metric: 'connectivity_time', benchmark_minor_per_unit: 0.01,
  started_at: '2025-01-01T00:00:00.000Z', ended_at: null, version: 1,
  created_at: recordedWindow.from, updated_at: recordedWindow.to,
};
export const subscriptionReport: SubscriptionROIReport = {
  vehicle_id: 7, window: recordedWindow, currency: 'USD',
  items: [{
    subscription, active_days: 365, spend_to_date_minor: 15000,
    monthly_cost_minor: 1250, usage_quantity: 90000, usage_unit: 's',
    usage_per_month: 30000, realised_value_minor: 900,
    net_value_minor: -14100, roi_pct: -94, break_even_usage_per_month: 125000,
    utilisation_pct: 24, verdict: 'review', confidence: 0.75,
    narrative: 'Recorded usage only; subscription spend is independently returned.',
    quality,
  }],
  total_monthly_cost_minor: 2500, total_spend_to_date_minor: 50000,
  total_realised_value_minor: 55000, portfolio_roi_pct: 10,
  cancel_candidate_saving_minor: 1250, quality, evidence,
};
export const consumablesReport: ConsumablesReport = {
  vehicle_id: 7, as_of: recordedWindow.to, odometer_m: 160934.4, currency: 'USD',
  items: [], due_soon_count: 2, overdue_count: 0, next_replace_at: null,
  twelve_month_cost_minor: 12345, lifetime_spend_minor: 67890,
  blended_cost_per_m_minor: 0.125, fleet_stress_average: 1.25, quality, evidence,
};
export const warrantyReport: WarrantyOverview = {
  vehicle_id: 7, as_of: recordedWindow.to, odometer_m: 160934.4, coverages: [],
  active_count: 3, expiring_soon_count: 0, next_expiry_at: null,
  total_claimed_minor: 43210, currency: 'USD',
  evidence_bundle_hash: 'recorded-warranty-digest', quality, evidence,
};
export const insuranceReport: InsuranceRiskProfile = {
  vehicle_id: 7, window: recordedWindow, policy: {
    id: 401, vehicle_id: 7, insurer: 'Recorded insurer', policy_ref: 'POLICY-401',
    currency: 'USD', annual_premium_minor: 120000, deductible_minor: 50000,
    coverage_start: '2026-01-01T00:00:00.000Z', coverage_end: '2027-01-01T00:00:00.000Z',
    telematics_program: true, max_discount_pct: 25, version: 1,
    created_at: recordedWindow.from, updated_at: recordedWindow.to,
  },
  exposure_distance_m: 160934.4, exposure_duration_s: 7200, drive_count: 12,
  night_distance_m: 16093.44, risk_score: 25, risk_grade: 'preferred',
  frequency_index: 0.8, severity_index: 1.25, loss_cost_index: 1,
  peer_percentile: null, factors: [], trend: [], levers: [],
  premium: {
    currency: 'USD', baseline_premium_minor: 120000, modelled_premium_minor: 96000,
    delta_minor: -24000, delta_pct: -20, applied_discount_pct: 20,
    max_discount_pct: 25, expected_loss_minor: null, deductible_minor: 50000,
    cost_per_distance_minor_per_m: 0.125,
  },
  evidence_packet_hash: 'recorded-risk-digest', quality, evidence,
};
export const driverReport: DriverAttributionReport = {
  vehicle_id: 7, window: recordedWindow, profiles: [], clusters: [], fingerprints: [],
  total: 80, limit: 100, offset: 0, separation_score: null,
  separation_verdict: 'insufficient', labelled_drive_count: 5,
  inferred_drive_count: 72, ambiguous_drive_count: 3, currency: 'USD', quality, evidence,
};
export const trustReport: ModelTrustReport = {
  vehicle_id: 7, window: recordedWindow, scorecards: [], total_predictions: 23,
  total_scored: 7, trusted_count: 2, watch_count: 1, unreliable_count: 0,
  portfolio_trust_score: null, recent_predictions: [], quality, evidence,
};
export const complianceReport: ComplianceApportionment = {
  vehicle_id: 7, window: recordedWindow, currency: 'USD', jurisdictions: [],
  total_distance_m: 160934.4, total_energy_wh: 42000,
  assigned_distance_m: 144840.96, unassigned_distance_m: 16093.44,
  unassigned_share_pct: 10, total_road_usage_charge_minor: 12345,
  total_registration_fee_minor: 5000, total_liability_minor: 17345,
  total_emissions_g: 123400, drive_count: 12, digest: 'recorded-period-digest',
  quality, evidence,
};
export const invoice: ChargingInvoice = {
  id: 801, vehicle_id: 7, provider: 'Recorded provider', invoice_ref: 'STATEMENT-801',
  currency: 'USD', period_start: recordedWindow.from, period_end: recordedWindow.to,
  billed_total_minor: 12345, status: 'open', line_count: 3, version: 1,
  lines: [{
    id: 1, line_ref: 'LINE-1', occurred_at: '2026-07-01T12:00:00.000Z',
    location: 'Recorded site', billed_energy_wh: 42000, billed_energy_minor: 12000,
    billed_idle_minor: 0, billed_tax_minor: 345, billed_total_minor: 12345,
  }],
  created_at: recordedWindow.from, updated_at: recordedWindow.to,
};
export const reconciliationReport: ReconciliationReport = {
  invoice, lines: [], uninvoiced_sessions: [], variance_buckets: [],
  matched_line_count: 2, unmatched_line_count: 1, billed_total_minor: 12345,
  expected_total_minor: 12000, net_variance_minor: 345, recoverable_minor: 345,
  measured_energy_wh: 40000, billed_energy_wh: 42000, energy_variance_wh: 2000,
  dispute_packet_digest: 'recorded-statement-digest', disputes: [], quality, evidence,
};
export const tariff: Tariff = {
  id: 701, name: 'Recorded flat plan', provider: 'Recorded utility', currency: 'USD',
  structure: 'flat', standing_charge_minor_per_day: 25, demand_charge_minor_per_w: 0,
  export_price_minor_per_wh: 0, is_current: true, version: 1, rates: [],
  created_at: recordedWindow.from, updated_at: recordedWindow.to,
};
export const tariffReplay: TariffSimulationResponse = {
  vehicle_id: 7, window: recordedWindow, session_count: 12,
  observed_energy_wh: 42000, shiftable_pct: 35, best_tariff_id: 702,
  current_tariff_id: 701, max_saving_minor: 12345,
  results: [{
    tariff_id: 702, name: 'Recorded alternative plan', provider: tariff.provider, structure: 'flat',
    currency: 'USD', is_current: false, rank: 1, observed_energy_wh: 42000,
    annualised_energy_wh: 168000, energy_cost_minor: 4200, standing_cost_minor: 9125,
    demand_cost_minor: 0, annual_cost_minor: 13325, effective_price_minor_per_wh: 0.1,
    delta_vs_current_minor: -12345, break_even_days: null, load_shift_saving_minor: 0,
    peak_demand_w: null, bands: [], warnings: [],
  }, {
    tariff_id: 701, name: tariff.name, provider: tariff.provider, structure: 'flat',
    currency: 'USD', is_current: true, rank: 2, observed_energy_wh: 42000,
    annualised_energy_wh: 168000, energy_cost_minor: 16545, standing_cost_minor: 9125,
    demand_cost_minor: 0, annual_cost_minor: 25670, effective_price_minor_per_wh: 0.39393,
    delta_vs_current_minor: 0, break_even_days: null, load_shift_saving_minor: 0,
    peak_demand_w: null, bands: [], warnings: [],
  }],
  quality, evidence,
};
export const retentionPolicy: RetentionPolicy = {
  id: 601, dataset: 'signal_log', retention_s: 31536000,
  downsample_after_s: null, downsample_bucket_s: null, legal_hold: false,
  enabled: true, version: 1, created_at: recordedWindow.from, updated_at: recordedWindow.to,
};
export const governanceReport: GovernanceOverview = {
  as_of: recordedWindow.to, policies: [retentionPolicy],
  inventory: [{
    dataset: 'signal_log', label: 'Signal history', row_count: 1000,
    total_bytes: 2048, oldest_at: recordedWindow.from, newest_at: recordedWindow.to,
    span_s: 7948800, bytes_per_row: 2.048, is_hypertable: true, governed: true,
  }],
  total_bytes: 4096, governed_bytes: 2048, ungoverned_bytes: 2048,
  governed_share_pct: 50, legal_hold_count: 0, plan_only: true, quality, evidence,
};
export const governancePlan: GovernanceSimulationResponse = {
  as_of: recordedWindow.to, impacts: [{
    dataset: 'signal_log', label: 'Signal history', policy_id: 601,
    retention_s: 31536000, rows_scanned: 1000, rows_expiring: 10,
    rows_downsampling: 0, rows_retained: 990, bytes_reclaimable: 1024,
    reclaim_share_pct: 25, fidelity_loss_pct: 0, blocked_by_legal_hold: false,
    projected_daily_growth_bytes: null, runway_days: null, warnings: [],
  }],
  total_rows_expiring: 10, total_bytes_reclaimable: 1024,
  total_fidelity_loss_pct: 0, plan_only: true, quality, evidence,
};

import type { SmartChargingSitePerformanceReview, SmartChargingTripProjection, SmartDepartureWindow, SmartSolarDecision } from './smartCharging';
import type { SmartCommuteRouteEnergy } from './smartCommute';
import type { WarrantyDistanceProjection } from './warrantyReminders';
import type { TripMaintenanceProjection } from './smartTripMaintenance';
import type { ColdTireDrift } from './coldTireReview';
import type { RecallCampaignMatch } from './recallWatch';
import type { ClimateScheduleEvidence } from './climateScheduleReview';

export type ActionCenterSourceFeature =
  | 'active_alerts'
  | 'advanced_intelligence'
  | 'battery_health'
  | 'charging_reliability'
  | 'charging_site_performance'
  | 'drive_efficiency'
  | 'fleet_maintenance'
  | 'signal_health'
  | 'smart_charging'
  | 'smart_commute'
  | 'system_health'
  | 'vehicle_readiness'
  | 'warranty_distance'
  | 'trip_maintenance'
  | 'cold_tire_drift'
  | 'recall_watch'
  | 'service_case'
  | 'climate_schedule'
  | 'subscription_renewal';

export type ActionCenterPriority = 'critical' | 'high' | 'medium' | 'low';
export type ActionCenterSeverity = 'critical' | 'warning' | 'info';
export type ActionCenterConfidenceLabel = 'high' | 'medium' | 'low';
export type ActionCenterFreshnessStatus = 'fresh' | 'aging' | 'stale' | 'unknown';
export type ActionCenterState = 'open' | 'acknowledged' | 'snoozed' | 'dismissed';
export type ActionCenterProviderAvailability = 'available' | 'degraded' | 'unavailable';
export type ActionCenterImpactRiskLevel = 'low' | 'moderate' | 'high';
export type ActionCenterAction =
  | 'acknowledge'
  | 'snooze'
  | 'dismiss'
  | 'restore'
  | 'navigate'
  | 'smart_charging_snooze'
  | 'smart_commute_use'
  | 'smart_commute_edit'
  | 'smart_commute_decline'
  | 'smart_commute_snooze';
export type ActionCenterStateAction = Exclude<ActionCenterAction,
  'navigate' | 'smart_charging_snooze' | 'smart_commute_use' | 'smart_commute_edit' | 'smart_commute_decline' | 'smart_commute_snooze'>;

export interface ActionCenterVehicleRef {
  id: number;
  display_name: string;
}

export interface ActionCenterRank {
  score: number;
  basis: string[];
}

export interface ActionCenterConfidence {
  score: number;
  label: ActionCenterConfidenceLabel;
  basis: string[];
}

export interface ActionCenterEvidenceProvenance {
  source: string;
  record_id: string;
  source_url: string | null;
}

export interface ActionCenterRecurringDriveEvidence {
  routine_id: number;
  weekday: number;
  matching_days: number;
  window_start_s: number;
  window_end_s: number;
  time_zone: string;
  destination_latitude: number;
  destination_longitude: number;
}

export interface ActionCenterChargingReadinessEvidence {
  plan_id: number;
  kind?: 'plug_in' | 'slow_charging' | 'trip_review' | 'schedule_conflict' | 'early_stop';
  place_name: string;
  battery_pct: number;
  arrival_low_pct: number;
  arrival_high_pct: number;
  reserve_pct: number;
  charging_power_w?: number;
  current_limit?: { requested_a: number; maximum_a: number };
  trip_projection?: SmartChargingTripProjection;
  departure_at: string;
  scheduled_start_at?: string;
  scheduled_power_ceiling_w?: number;
  interrupted_at?: string;
}

export interface ActionCenterEvidence {
  id: string;
  kind: string;
  summary: string;
  provenance: ActionCenterEvidenceProvenance;
  observed_at: string | null;
  recurring_drive?: ActionCenterRecurringDriveEvidence;
  charging_readiness?: ActionCenterChargingReadinessEvidence;
  departure_overlap?: SmartDepartureWindow & { plan_id: number; departure_at: string; kind: 'service' | 'software' };
  commute_traffic?: {
    usual_s: number;
    alternative_s: number;
    arrival_deadline_at?: string;
    latest_departure_at?: string;
    time_zone?: string;
    route_energy?: SmartCommuteRouteEnergy;
    route_energy_only?: boolean;
  };
  site_performance?: SmartChargingSitePerformanceReview;
  solar_surplus?: SmartSolarDecision;
  backup_charging?: { vehicle_power_w: number; minimum_battery_to_load_w: number; observed_at: string; expires_at: string };
  warranty_distance?: WarrantyDistanceProjection;
  trip_maintenance?: TripMaintenanceProjection;
  cold_tire_drift?: ColdTireDrift;
  recall_watch_match?: RecallCampaignMatch;
  climate_schedule?: ClimateScheduleEvidence;
}

export interface ActionCenterProjectedImpact {
  energy_wh: number | null;
  cost_minor: number | null;
  currency: string | null;
  time_s: number | null;
  risk_level: ActionCenterImpactRiskLevel | null;
  basis: string[];
}

export interface ActionCenterFreshness {
  status: ActionCenterFreshnessStatus;
  observed_at: string | null;
  age_s: number | null;
}

export interface ActionCenterCurrentState {
  status: ActionCenterState;
  version: number;
  snoozed_until: string | null;
  updated_at: string | null;
}

export interface ActionCenterActionEvent {
  id: number;
  recommendation_id: string;
  fingerprint: string;
  action: ActionCenterStateAction;
  from_state: ActionCenterState;
  to_state: ActionCenterState;
  outcome: 'applied';
  state_version: number;
  occurred_at: string;
}

export interface ActionCenterRecommendation {
  id: string;
  fingerprint: string;
  source_feature: ActionCenterSourceFeature;
  related_sources: ActionCenterSourceFeature[];
  vehicle: ActionCenterVehicleRef | null;
  title: string;
  summary: string;
  rationale: string;
  priority: ActionCenterPriority;
  severity: ActionCenterSeverity;
  rank: ActionCenterRank;
  confidence: ActionCenterConfidence;
  evidence: ActionCenterEvidence[];
  projected_impact: ActionCenterProjectedImpact | null;
  safe_actions: ActionCenterAction[];
  navigation_path: string | null;
  expires_at: string;
  freshness: ActionCenterFreshness;
  limitations: string[];
  current_state: ActionCenterCurrentState;
  action_history: ActionCenterActionEvent[];
}

export interface ActionCenterProviderStatus {
  source_feature: ActionCenterSourceFeature;
  status: ActionCenterProviderAvailability;
  item_count: number;
  limitations: string[];
}

export interface ActionCenterSummary {
  open: number;
  acknowledged: number;
  snoozed: number;
  dismissed: number;
  critical: number;
  high: number;
}

export interface ActionCenterResponse {
  items: ActionCenterRecommendation[];
  total: number;
  limit: number;
  offset: number;
  generated_at: string;
  summary: ActionCenterSummary;
  provider_status: ActionCenterProviderStatus[];
}

export interface ActionCenterActionResult {
  recommendation: ActionCenterRecommendation;
  event: ActionCenterActionEvent;
}

export interface ActionCenterHistoryPage {
  items: ActionCenterActionEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface ActionCenterFilter {
  vehicle_id?: number;
  priority?: ActionCenterPriority;
  source_feature?: ActionCenterSourceFeature;
  state?: ActionCenterState;
  limit?: number;
  offset?: number;
}

export interface ApplyActionCenterActionInput {
  recommendation_id: string;
  fingerprint: string;
  action: ActionCenterStateAction;
  expected_version: number;
  confirmed: true;
  snoozed_until: string | null;
}

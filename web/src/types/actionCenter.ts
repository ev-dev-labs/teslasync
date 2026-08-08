export type ActionCenterSourceFeature =
  | 'active_alerts'
  | 'advanced_intelligence'
  | 'charging_reliability'
  | 'fleet_maintenance'
  | 'signal_health';

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
  | 'navigate';
export type ActionCenterStateAction = Exclude<ActionCenterAction, 'navigate'>;

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

export interface ActionCenterEvidence {
  id: string;
  kind: string;
  summary: string;
  provenance: ActionCenterEvidenceProvenance;
  observed_at: string | null;
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

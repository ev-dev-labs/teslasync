import { expect, type Page } from '@playwright/test';
import type {
  Automation,
  AutomationHistory,
  AutomationHistoryListResponse,
  AutomationPresetsResponse,
  RoutineTemplate,
} from '../../src/api/types';
import type {
  BenchmarkPrivacyStatus,
  BenchmarkReleasePage,
} from '../../src/api/hooks/useBenchmarks';
import type { ComfortNext, ComfortRun } from '../../src/api/hooks/useComfort';
import type { ActionCenterResponse, ActionCenterHistoryPage } from '../../src/types/actionCenter';
import { fulfillApiFixture, type MockApiController } from '../mockApi';

// Removed root compatibility keys are required-never in the UI type, but absent on the wire.
type AutomationWire = Omit<Automation, 'trigger_type' | 'trigger_config' | 'conditions' | 'actions'>;
type ActionCenterWire = Omit<ActionCenterResponse, 'summary'> & {
  summary: ActionCenterResponse['summary'] | null;
};

export const RULES: AutomationWire[] = [
  { id: 701, name: 'Morning cabin preparation', enabled: true, auto_disabled: false, execution_count: 12, failure_count: 0 },
  { id: 702, name: 'Disabled departure reminder', enabled: false, auto_disabled: false, execution_count: 5, failure_count: 1 },
  { id: 703, name: 'Guarded charging reminder', enabled: true, auto_disabled: true, execution_count: 3, failure_count: 2 },
].map((rule) => ({
  ...rule,
  description: 'Typed local rule fixture; no vehicle command is issued.',
  vehicle_id: 7,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-26T00:00:00Z',
  stop_on_failure: true,
  notify_on_run: false,
  notify_on_failure: true,
  seasonal_start: null,
  seasonal_end: null,
  last_triggered_at: null,
  last_success_at: null,
  last_failure_at: null,
  consecutive_failures: rule.auto_disabled ? 3 : 0,
  auto_disabled_reason: rule.auto_disabled ? 'Three consecutive source failures' : null,
  preset_id: null,
}));

export const ACTION_CENTER: ActionCenterResponse = {
  items: [{
    id: 'brief-source-701',
    fingerprint: 'synthetic-local-source-701',
    source_feature: 'charging_reliability',
    related_sources: [],
    vehicle: { id: 7, display_name: 'Aurora' },
    title: 'Review interrupted charging evidence',
    summary: 'One interrupted session in the bounded source window.',
    rationale: 'Review the stored evidence before changing any vehicle setting.',
    priority: 'high',
    severity: 'warning',
    rank: { score: 73, basis: ['Source priority; not a fleet-wide confidence measure'] },
    confidence: { score: 0.8, label: 'high', basis: ['Completed session evidence'] },
    evidence: [{
      id: 'brief-evidence-701',
      kind: 'charging_session',
      summary: 'Stored session 201 was interrupted.',
      provenance: { source: 'charging_sessions', record_id: '201', source_url: null },
      observed_at: '2026-08-25T09:00:00Z',
    }],
    projected_impact: { energy_wh: 2500, cost_minor: null, currency: null, time_s: 600, risk_level: 'low', basis: ['Estimate from the stored session, not a promised saving'] },
    safe_actions: ['navigate', 'acknowledge', 'snooze', 'dismiss'],
    navigation_path: '/charging',
    expires_at: '2099-01-01T00:00:00Z',
    freshness: { status: 'fresh', observed_at: '2026-08-25T09:00:00Z', age_s: 60 },
    limitations: ['Only completed sessions in the provider window were considered.'],
    current_state: { status: 'open', version: 1, snoozed_until: null, updated_at: null },
    action_history: [],
  }],
  total: 14,
  limit: 50,
  offset: 0,
  generated_at: '2026-08-26T12:00:00Z',
  // Provider-generated summary precedes inbox state, priority and pagination.
  summary: { open: 7, critical: 0, high: 3, acknowledged: 2, snoozed: 1, dismissed: 4 },
  provider_status: [{
    source_feature: 'charging_reliability',
    status: 'available',
    item_count: 14,
    limitations: ['Completed charging sessions; provider window is bounded.'],
  }],
};

const recommendation = ACTION_CENTER.items[0];
ACTION_CENTER.items = Array.from({ length: 14 }, (_, index) => ({
  ...structuredClone(recommendation),
  id: index === 0 ? recommendation.id : `brief-source-${701 + index}`,
  fingerprint: `synthetic-local-source-${701 + index}`,
  title: index === 0 ? recommendation.title : `Bounded charging finding ${index + 1}`,
  priority: index === 0 || index === 7 || index === 10 ? 'high' as const : 'medium' as const,
  current_state: {
    ...recommendation.current_state,
    status: index < 7 ? 'open' as const : index < 9 ? 'acknowledged' as const
      : index < 10 ? 'snoozed' as const : 'dismissed' as const,
  },
}));

const historyRow: AutomationHistory = {
    id: 801, automation_id: 701, automation_name: RULES[0].name, vehicle_id: 7,
    triggered_at: '2026-08-25T09:00:00Z', completed_at: '2026-08-25T09:00:01.500Z',
    duration_ms: 1500, trigger_type: 'trigger_schedule', trigger_snapshot: null,
    conditions_met: true, conditions_snapshot: [], actions_executed: [],
    actions_total: 1, actions_succeeded: 1, actions_failed: 0,
    status: 'success', error: null, fsm_state: 'completed', created_at: '2026-08-25T09:00:00Z',
};

export const HISTORY: AutomationHistoryListResponse = {
  items: Array.from({ length: 25 }, (_, index) => ({
    ...historyRow, id: historyRow.id + index,
  })),
  total: 40, limit: 25, offset: 0,
  summary: { total_executions: 40, succeeded: 30, failed: 8, partial: 2, success_rate: 75, avg_duration_ms: 1500 },
  trend: [
    { day: '2026-08-25', status: 'success', count: 30 },
    { day: '2026-08-25', status: 'failed', count: 8 },
    { day: '2026-08-25', status: 'partial', count: 2 },
  ],
};

export const NO_RUNS: AutomationHistoryListResponse = {
  items: [], total: 0, limit: 25, offset: 0, trend: [],
  summary: { total_executions: 0, succeeded: 0, failed: 0, partial: 0, success_rate: 0, avg_duration_ms: 0 },
};

export const PRIVACY: BenchmarkPrivacyStatus = {
  vehicle_id: 7, opted_in: true, opted_in_at: '2026-08-01T00:00:00Z', revoked_at: null,
  epsilon_budget: 10, epsilon_spent: 0.5, epsilon_remaining: 9.5,
  minimum_cohort_size: 5, mechanism_version: 2,
};

export const RELEASES: BenchmarkReleasePage = {
  limit: 12, offset: 0,
  items: [{
    release_id: 901, period_start: '2026-08-01', period_end: '2026-08-26',
    model_family: 'model_3', model_year_bucket: 2020, mechanism_version: 2,
    minimum_cohort_size: 5, epsilon_spent: 0.5, suppressed: false,
    suppression_reason: null, created_at: '2026-08-26T12:00:00Z',
    metrics: ([
      { metric_name: 'degradation_pct', unit: 'pct', target_value: 0, lower_bound: 0, upper_bound: 100, higher_is_better: false },
      { metric_name: 'efficiency_wh_per_km', unit: 'wh_per_km', target_value: 180, lower_bound: 0, upper_bound: 600, higher_is_better: false },
      { metric_name: 'charging_reliability_pct', unit: 'pct', target_value: 95, lower_bound: 0, upper_bound: 100, higher_is_better: true },
      { metric_name: 'operation_reliability_pct', unit: 'pct', target_value: null, lower_bound: 0, upper_bound: 100, higher_is_better: true },
    ] as const).map((metric) => ({
      ...metric, epsilon_spent: 0.125, noisy_cohort_size: 12, noisy_mean: 50,
      noisy_p25: 20, noisy_p75: 80, noise_scale: 0.5,
      suppressed: false, quality: 'moderate' as const, percentile: 60,
    })),
  }],
};

const comfort: ComfortNext = {
  config: { vehicle_id: 7, enabled: false, target_temp_c: 21, lead_minutes: 20, ics_url: '', updated_at: '2026-08-26T00:00:00Z' },
};
const comfortRuns: ComfortRun[] = [];
const presets: AutomationPresetsResponse = { categories: [], presets: [] };
const routines: RoutineTemplate[] = [];
const actionHistory: ActionCenterHistoryPage = { items: [], total: 0, limit: 25, offset: 0 };

export interface ActionsFixtureState {
  actionCenter: ActionCenterWire;
  rules: AutomationWire[];
  history: AutomationHistoryListResponse;
  privacy: BenchmarkPrivacyStatus;
  releases: BenchmarkReleasePage;
  failActionRefresh: boolean;
}

export function actionsFixtureState(): ActionsFixtureState {
  return {
    actionCenter: structuredClone(ACTION_CENTER), rules: structuredClone(RULES),
    history: structuredClone(HISTORY), privacy: structuredClone(PRIVACY),
    releases: structuredClone(RELEASES), failActionRefresh: false,
  };
}

export async function installActionsFixtures(
  page: Page,
  controller: MockApiController | null,
  state: ActionsFixtureState,
): Promise<void> {
  if (!controller) throw new Error('OperationalBrief action contracts require the strict mocked harness');
  const endpoints: ReadonlyArray<{
    path: string;
    query: readonly string[];
    body: (url: URL) => unknown;
  }> = [
    { path: '/action-center', query: ['vehicle_id', 'priority', 'source_feature', 'state', 'limit', 'offset'], body: (url) => {
      const items = state.actionCenter.items.filter((item) =>
        (!url.searchParams.get('state') || item.current_state.status === url.searchParams.get('state'))
        && (!url.searchParams.get('priority') || item.priority === url.searchParams.get('priority'))
        && (!url.searchParams.get('source_feature') || item.source_feature === url.searchParams.get('source_feature')));
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return { ...state.actionCenter, items: items.slice(offset, offset + limit), total: items.length, limit, offset };
    } },
    { path: '/action-center/brief-source-701/history', query: ['limit', 'offset'], body: () => actionHistory },
    { path: '/automations', query: [], body: () => state.rules },
    { path: '/automations/history', query: ['limit', 'offset', 'since', 'until', 'status'], body: () => state.history },
    { path: '/automations/701/history', query: ['limit', 'offset', 'since', 'until', 'status'], body: () => state.history },
    { path: '/automations/presets', query: ['category'], body: () => presets },
    { path: '/automations/routine-templates', query: [], body: () => routines },
    { path: '/comfort/next', query: ['vehicle_id'], body: () => comfort },
    { path: '/comfort/runs', query: ['vehicle_id', 'limit'], body: () => comfortRuns },
    { path: '/benchmarks/privacy', query: ['vehicle_id'], body: () => state.privacy },
    { path: '/benchmarks/releases', query: ['vehicle_id', 'limit', 'offset'], body: () => state.releases },
  ];
  for (const endpoint of endpoints) {
    await page.route((url) => url.pathname === `/api/v1${endpoint.path}`, async (route) => {
      const url = new URL(route.request().url());
      expect(url.origin).toBe(new URL(page.url()).origin);
      expect(route.request().method(), `No real or mocked domain mutation: ${endpoint.path}`).toBe('GET');
      expect([...url.searchParams.keys()].filter((key) => !endpoint.query.includes(key))).toEqual([]);
      if (url.searchParams.has('vehicle_id')) expect(url.searchParams.get('vehicle_id')).toBe('7');
      const failed = endpoint.path === '/action-center' && state.failActionRefresh;
      await fulfillApiFixture(route, controller, {
        status: failed ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(failed ? { error: 'Synthetic refresh unavailable' } : endpoint.body(url)),
      });
    });
  }
}

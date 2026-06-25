import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

const INTERVALS = {
  STANDARD: 30_000,
} as const;

const STALE_TIMES = {
  STATIC: Infinity,
} as const;

const JSON_HEADERS = {'Content-Type': 'application/json'} as const;

export const nativeAutomationHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void qc.invalidateQueries(filters);
}

export interface AutomationModel {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  vehicle_id: number | null;
  created_at: string;
  updated_at: string;
}

export type AutomationTriggerKind =
  | 'trigger_signal'
  | 'trigger_geofence'
  | 'trigger_schedule'
  | 'trigger_event';

export type AutomationConditionKind =
  | 'condition_signal'
  | 'condition_time_window'
  | 'condition_geofence'
  | 'condition_other_automation';

export type AutomationActionKind =
  | 'action_command'
  | 'action_notify'
  | 'action_set_setting'
  | 'action_call_automation';

export type AutomationStepKind =
  | AutomationTriggerKind
  | AutomationConditionKind
  | AutomationActionKind;

export type AutomationStepLane = 'trigger' | 'condition' | 'action';

export type AutomationTriggerSignalOp =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'changed'
  | 'crossed_above'
  | 'crossed_below';

export type AutomationConditionSignalOp =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'between'
  | 'in';

export type AutomationGeofenceEvent =
  | 'enter'
  | 'exit'
  | 'leave'
  | 'both'
  | 'dwell';

export type AutomationGeofenceState = 'inside' | 'outside' | 'dwell';

export type AutomationEventType =
  | 'drive_start'
  | 'drive_end'
  | 'charge_start'
  | 'charge_end'
  | 'sleep_start'
  | 'sleep_end'
  | 'online'
  | 'offline'
  | 'sentry_alert';

export type AutomationOtherAutomationState =
  | 'enabled'
  | 'disabled'
  | 'recently_triggered';

export interface AutomationStepSummary {
  id: number;
  automation_id: number;
  step_order: number;
  kind: AutomationStepKind;
}

export interface AutomationStepBase {
  id?: number;
  automation_id?: number;
  step_id?: number;
  kind: AutomationStepKind;
  step_order?: number;
}

export interface AutomationStepTriggerSignal extends AutomationStepBase {
  kind: 'trigger_signal';
  signal: string;
  op: AutomationTriggerSignalOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
}

export interface AutomationStepTriggerGeofence extends AutomationStepBase {
  kind: 'trigger_geofence';
  place_id: number;
  event: AutomationGeofenceEvent;
  dwell_minutes?: number | null;
}

export interface AutomationStepTriggerSchedule extends AutomationStepBase {
  kind: 'trigger_schedule';
  cron_expr: string;
  timezone: string;
}

export interface AutomationStepTriggerEvent extends AutomationStepBase {
  kind: 'trigger_event';
  event_type: AutomationEventType;
}

export interface AutomationStepConditionSignal extends AutomationStepBase {
  kind: 'condition_signal';
  signal: string;
  op: AutomationConditionSignalOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
}

export interface AutomationStepConditionTimeWindow extends AutomationStepBase {
  kind: 'condition_time_window';
  start_time: string;
  end_time: string;
  timezone: string;
  days_of_week: number[];
}

export interface AutomationStepConditionGeofence extends AutomationStepBase {
  kind: 'condition_geofence';
  place_id: number;
  state: AutomationGeofenceState;
}

export interface AutomationStepConditionOtherAutomation
  extends AutomationStepBase {
  kind: 'condition_other_automation';
  other_automation_id: number;
  state: AutomationOtherAutomationState;
}

export interface AutomationStepActionCommand extends AutomationStepBase {
  kind: 'action_command';
  command_name: string;
  command_params?: Record<string, unknown>;
}

export interface AutomationStepActionNotify extends AutomationStepBase {
  kind: 'action_notify';
  channel_id: number;
  template: string;
}

export interface AutomationStepActionSetSetting extends AutomationStepBase {
  kind: 'action_set_setting';
  setting_key: string;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
}

export interface AutomationStepActionCallAutomation extends AutomationStepBase {
  kind: 'action_call_automation';
  target_automation_id: number;
}

export type AutomationTriggerStep =
  | AutomationStepTriggerSignal
  | AutomationStepTriggerGeofence
  | AutomationStepTriggerSchedule
  | AutomationStepTriggerEvent;

export type AutomationConditionStep =
  | AutomationStepConditionSignal
  | AutomationStepConditionTimeWindow
  | AutomationStepConditionGeofence
  | AutomationStepConditionOtherAutomation;

export type AutomationActionStep =
  | AutomationStepActionCommand
  | AutomationStepActionNotify
  | AutomationStepActionSetSetting
  | AutomationStepActionCallAutomation;

export type AutomationStep =
  | AutomationTriggerStep
  | AutomationConditionStep
  | AutomationActionStep;

type AutomationStepInputBase<T extends AutomationStep> = Omit<
  T,
  'id' | 'automation_id' | 'step_id'
>;

export type AutomationTriggerInput =
  AutomationStepInputBase<AutomationTriggerStep>;
export type AutomationConditionInput =
  AutomationStepInputBase<AutomationConditionStep>;
export type AutomationActionInput =
  AutomationStepInputBase<AutomationActionStep>;

export interface AutomationConflict {
  automation_id: number;
  automation_name: string;
  reason: string;
  severity: 'warning' | 'info';
}

type RemovedAutomationTriggerTypeKey = `trigger_${'type'}`;
type RemovedAutomationTriggerConfigKey = `trigger_${'config'}`;
type RemovedAutomationRootCompatibilityKey =
  | RemovedAutomationTriggerTypeKey
  | RemovedAutomationTriggerConfigKey
  | 'conditions'
  | 'actions';

type RemovedAutomationRootCompatibility = {
  [K in RemovedAutomationRootCompatibilityKey]: never;
};

export type Automation = AutomationModel & {
  stop_on_failure: boolean;
  notify_on_run: boolean;
  notify_on_failure: boolean;
  seasonal_start: number | null;
  seasonal_end: number | null;
  last_triggered_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  execution_count: number;
  failure_count: number;
  consecutive_failures: number;
  auto_disabled: boolean;
  auto_disabled_reason: string | null;
  preset_id: string | null;
  next_fire_time?: string | null;
  conflicts?: AutomationConflict[];
} & RemovedAutomationRootCompatibility;

export type AutomationFull = AutomationModel & {
  steps?: AutomationStepSummary[];
  triggers: AutomationTriggerStep[];
  conditions: AutomationConditionStep[];
  actions: AutomationActionStep[];
};

export type AutomationStepInput =
  | AutomationTriggerInput
  | AutomationConditionInput
  | AutomationActionInput;

export type AutomationFullInput = {
  name: string;
  description?: string;
  vehicle_id?: number | null;
  enabled?: boolean;
  triggers: AutomationTriggerInput[];
  conditions: AutomationConditionInput[];
  actions: AutomationActionInput[];
};

export type AutomationHistoryStatus =
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'test'
  | 'undo'
  | string;

export interface AutomationHistory {
  id: number;
  automation_id: number;
  automation_name: string;
  vehicle_id: number | null;
  triggered_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  trigger_type: string;
  trigger_snapshot: Record<string, unknown> | null;
  conditions_met: boolean;
  conditions_snapshot: Record<string, unknown>[] | null;
  actions_executed: Record<string, unknown>[] | null;
  actions_total: number;
  actions_succeeded: number;
  actions_failed: number;
  status: AutomationHistoryStatus;
  error: string | null;
  fsm_state: string | null;
  created_at: string;
}

export interface AutomationHistoryStats {
  total_executions: number;
  succeeded: number;
  failed: number;
  partial: number;
  success_rate: number;
  avg_duration_ms: number;
}

export interface AutomationHistoryListResponse {
  items: AutomationHistory[];
  total: number;
  limit: number;
  offset: number;
  summary?: AutomationHistoryStats | null;
}

export interface AutomationPresetCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface AutomationPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  triggers: AutomationTriggerInput[];
  conditions?: AutomationConditionInput[];
  actions: AutomationActionInput[];
  stop_on_failure: boolean;
  notify_on_run: boolean;
  notify_on_failure: boolean;
}

export interface AutomationPresetsResponse {
  categories: AutomationPresetCategory[];
  presets: AutomationPreset[];
}

export const automationKeys = {
  all: ['automations'] as const,
  detail: (id: number) => ['automations', id] as const,
  history: (limit?: number) => ['automation-history', limit] as const,
};

export type OptimisticUpdater<TVariables, TPrev> = (
  prev: TPrev | undefined,
  vars: TVariables,
  key: QueryKey,
) => TPrev | undefined;

export interface OptimisticContext<TPrev> {
  snapshots: Array<[QueryKey, TPrev | undefined]>;
  keys: QueryKey[];
}

export interface UseOptimisticMutationOptions<TData, TVariables, TPrev> {
  mutationFn: (vars: TVariables) => Promise<TData>;
  queryKeys: QueryKey[] | ((vars: TVariables) => QueryKey[]);
  updater: OptimisticUpdater<TVariables, TPrev>;
  broadcast?: boolean;
  onMutate?: (vars: TVariables) => void;
  onSuccess?: (
    data: TData,
    vars: TVariables,
    ctx: OptimisticContext<TPrev>,
  ) => void;
  onError?: (
    err: Error,
    vars: TVariables,
    ctx: OptimisticContext<TPrev> | undefined,
  ) => void;
  onSettled?: (
    data: TData | undefined,
    err: Error | null,
    vars: TVariables,
    ctx: OptimisticContext<TPrev> | undefined,
  ) => void;
}

function resolveKeys<TVariables>(
  spec: QueryKey[] | ((vars: TVariables) => QueryKey[]),
  vars: TVariables,
): QueryKey[] {
  return typeof spec === 'function' ? spec(vars) : spec;
}

function invalidate(qc: QueryClient, key: QueryKey, broadcast: boolean): void {
  if (broadcast) {
    invalidateAndBroadcast(qc, {queryKey: key});
  } else {
    void qc.invalidateQueries({queryKey: key});
  }
}

export function useOptimisticMutation<TData, TVariables, TPrev = unknown>(
  opts: UseOptimisticMutationOptions<TData, TVariables, TPrev>,
): UseMutationResult<TData, Error, TVariables, OptimisticContext<TPrev>> {
  const qc = useQueryClient();
  const broadcast = opts.broadcast ?? false;

  return useMutation<TData, Error, TVariables, OptimisticContext<TPrev>>({
    mutationFn: opts.mutationFn,
    onMutate: async vars => {
      const keys = resolveKeys(opts.queryKeys, vars);
      const snapshots: Array<[QueryKey, TPrev | undefined]> = [];
      for (const key of keys) {
        await qc.cancelQueries({queryKey: key});
        const matches = qc.getQueriesData<TPrev>({queryKey: key});
        for (const [matchKey, prev] of matches) {
          snapshots.push([matchKey, prev]);
          qc.setQueryData<TPrev>(matchKey, old =>
            opts.updater(old, vars, matchKey),
          );
        }
      }
      opts.onMutate?.(vars);
      return {snapshots, keys};
    },
    onError: (err, vars, ctx) => {
      ctx?.snapshots.forEach(([key, prev]) => {
        qc.setQueryData(key, prev);
      });
      opts.onError?.(err, vars, ctx);
    },
    onSettled: (data, err, vars, ctx) => {
      const keys = ctx?.keys ?? resolveKeys(opts.queryKeys, vars);
      for (const key of keys) {
        invalidate(qc, key, broadcast);
      }
      opts.onSettled?.(data, err, vars, ctx);
    },
    onSuccess: opts.onSuccess
      ? (data, vars, ctx) => opts.onSuccess?.(data, vars, ctx)
      : undefined,
  });
}

export function useAutomations() {
  return useQuery({
    queryKey: automationKeys.all,
    queryFn: ({signal}) => request<Automation[]>('/automations', {signal}),
    refetchInterval: INTERVALS.STANDARD,
    select: safeArray,
  });
}

export function useAutomationHistory(limit = 20) {
  return useQuery({
    queryKey: automationKeys.history(limit),
    queryFn: ({signal}) =>
      request<AutomationHistoryListResponse>(
        `/automations/history?limit=${limit}`,
        {signal},
      ),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useToggleAutomation() {
  const {success, error} = useMutationToast();
  return useOptimisticMutation<
    {id: number; enabled: boolean},
    {id: number; enabled: boolean},
    Automation[]
  >({
    mutationFn: ({id, enabled}) =>
      request<{id: number; enabled: boolean}>(`/automations/${id}/toggle`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({enabled}),
      }),
    queryKeys: [automationKeys.all],
    updater: (prev, {id, enabled}) =>
      prev?.map(a => (a.id === id ? {...a, enabled} : a)),
    broadcast: true,
    onMutate: () => {
      // Optimistic flip already applied; success feedback waits for the server.
    },
    onSuccess: (_data, {enabled}) => {
      if (enabled) {
        success('toast.automation.enabled', 'Automation enabled');
      } else {
        success('toast.automation.disabled', 'Automation disabled');
      }
    },
    onError: err =>
      error(err, 'toast.automation.toggle.error', 'Failed to toggle automation'),
  });
}

export function useReEnableAutomation() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<{id: number; enabled: boolean; auto_disabled: boolean}>(
        `/automations/${id}/re-enable`,
        {method: 'PATCH'},
      ),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: automationKeys.all});
      success('toast.automation.reEnable.success', 'Automation re-enabled');
    },
    onError: err =>
      error(
        err,
        'toast.automation.reEnable.error',
        'Failed to re-enable automation',
      ),
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/automations/${id}`, {method: 'DELETE'}),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: automationKeys.all});
      invalidateAndBroadcast(qc, {queryKey: ['automation-history']});
      success('toast.automation.delete.success', 'Automation deleted');
    },
    onError: err =>
      error(err, 'toast.automation.delete.error', 'Failed to delete automation'),
  });
}

export type AutomationBulkOp = 'enable' | 'disable' | 'delete';

export interface AutomationBulkResult {
  updated?: number;
  deleted?: number;
  failed: {id: number; reason: string}[];
}

export function useBulkAutomationsUpdate() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (vars: {ids: number[]; op: AutomationBulkOp}) =>
      request<AutomationBulkResult>('/automations/bulk', {
        method: 'POST',
        body: JSON.stringify({ids: vars.ids, op: vars.op}),
      }),
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, {queryKey: automationKeys.all});
      invalidateAndBroadcast(qc, {queryKey: ['automation-history']});
      const key = `toast.automation.bulk.${vars.op}.success`;
      const fallback =
        vars.op === 'delete'
          ? 'Automations deleted'
          : vars.op === 'enable'
            ? 'Automations enabled'
            : 'Automations disabled';
      success(key, fallback);
    },
    onError: err =>
      error(
        err,
        'toast.automation.bulk.error',
        'Bulk automation update failed',
      ),
  });
}

export function useTestRunAutomation() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/automations/${id}/test-run`, {method: 'POST'}),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: ['automation-history']});
      success('toast.automation.testRun.success', 'Test run started');
    },
    onError: err =>
      error(
        err,
        'toast.automation.testRun.error',
        'Failed to start test run',
      ),
  });
}

export function useAutomation(id: number | string | undefined) {
  const numericId = typeof id === 'string' ? Number(id) : id;
  return useQuery({
    queryKey: automationKeys.detail(numericId!),
    queryFn: ({signal}) => request<AutomationFull>(`/automations/${id}`, {signal}),
    enabled: numericId != null && !Number.isNaN(numericId) && numericId > 0,
  });
}

export function useCreateAutomationFull() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (input: AutomationFullInput) =>
      request<AutomationFull>('/automations', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: automationKeys.all});
      success('toast.automation.create.success', 'Automation created');
    },
    onError: err =>
      error(
        err,
        'toast.automation.create.error',
        'Failed to create automation',
      ),
  });
}

export function useUpdateAutomationFull() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: ({id, input}: {id: number; input: AutomationFullInput}) =>
      request<AutomationFull>(`/automations/${id}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      }),
    onSuccess: (_d, vars) => {
      invalidateAndBroadcast(qc, {queryKey: automationKeys.all});
      invalidateAndBroadcast(qc, {queryKey: automationKeys.detail(vars.id)});
      success('toast.automation.update.success', 'Automation updated');
    },
    onError: err =>
      error(
        err,
        'toast.automation.update.error',
        'Failed to update automation',
      ),
  });
}

export const presetKeys = {
  all: ['automation-presets'] as const,
  category: (cat: string) => ['automation-presets', cat] as const,
  detail: (id: string) => ['automation-preset', id] as const,
};

export function useAutomationPresets(category?: string) {
  const queryParam = category ? `?category=${category}` : '';
  return useQuery({
    queryKey: category ? presetKeys.category(category) : presetKeys.all,
    queryFn: ({signal}) =>
      request<AutomationPresetsResponse>(
        `/automations/presets${queryParam}`,
        {signal},
      ),
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useAutomationPreset(id: string | undefined) {
  return useQuery({
    queryKey: presetKeys.detail(id!),
    queryFn: ({signal}) =>
      request<AutomationPreset>(`/automations/presets/${id}`, {signal}),
    enabled: !!id,
    staleTime: STALE_TIMES.STATIC,
  });
}

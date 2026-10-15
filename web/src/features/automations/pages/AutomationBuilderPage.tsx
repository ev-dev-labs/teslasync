import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  ListChecks,
  PlayCircle,
  Save,
  X,
  Zap,
} from 'lucide-react';
import { PageLayout, SourceContent } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  Icon,
  Input as UiInput,
  PanelTitle,
  Select as UiSelect,
  Button as UiButton,
  Text,
  Toggle,
  Textarea as UiTextarea,
} from '@/components/ui';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import {
  AlertBanner,
  DraftRecoveryBanner,
  EmptyState,
  EditConflictBanner,
  OperationalWriteNotice,
  StaleRefreshWarning,
} from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { FormSection } from '@/components/forms';
import { AINLAutomationBuilder } from '@/components/ai';
import { AIGeofenceAwareAutomationSuggestions } from '@/components/ai';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useDirtyForm } from '@/hooks/useDirtyForm';
import { useFormDraft } from '@/hooks/useFormDraft';
import { useNavigationGuard } from '@/hooks/useNavigationGuard';
import { useEditLease } from '@/hooks/useEditLease';
import { useConfirm } from '@/hooks/useConfirm';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { ConfirmDialog } from '@/components/ui';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useNotificationChannels } from '@/api/hooks/useNotifications';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useAutomation,
  useCreateAutomationFull,
  useUpdateAutomationFull,
  useTestRunAutomation,
  useAutomationPreset,
  type AutomationFullInput,
} from '@/api/hooks/useAutomations';
import {
  TriggerConfigurator,
  TRIGGER_TYPES,
  createDefaultTrigger,
} from './TriggerConfigurator';
import { ConditionBuilder } from './ConditionBuilder';
import { ActionBuilder } from './ActionBuilder';
import { ConflictWarnings } from './ConflictWarnings';
import type {
  AutomationActionStep,
  AutomationConditionStep,
  AutomationConflict,
  AutomationFull,
  AutomationTriggerStep,
} from '@/api/types';
import type {
  AutomationTriggerKind,
} from '@/types/automations';
import type {
  AutomationActionStepInput,
  AutomationConditionStepInput,
  AutomationTriggerStepInput,
} from '../components/stepInputTypes';
import { VisuallyHidden } from '@/components/a11y';
import { neonColorMap, typography } from '@/lib/tokens';
import { BOOL_FIELD_KEYS } from '@/lib/signals';

interface FormState {
  name: string;
  description: string;
  vehicle_id: number | null;
  enabled: boolean;
  triggers: AutomationTriggerStepInput[];
  conditions: AutomationConditionStepInput[];
  actions: AutomationActionStepInput[];
}

export function getInitialForm(): FormState {
  return {
    name: '',
    description: '',
    vehicle_id: null,
    enabled: true,
    triggers: [],
    conditions: [],
    actions: [{ kind: 'action_command', command_name: 'climate_on' }],
  };
}

export function normalizeTriggerInput(
  trigger: AutomationTriggerStepInput | AutomationTriggerStep,
): AutomationTriggerStepInput {
  switch (trigger.kind) {
    case 'trigger_schedule':
      return {
        kind: 'trigger_schedule',
        cron_expr: trigger.cron_expr,
        timezone: trigger.timezone,
      };
    case 'trigger_event':
      return {
        kind: 'trigger_event',
        event_type: trigger.event_type,
      };
    case 'trigger_geofence':
      return {
        kind: 'trigger_geofence',
        place_id: trigger.place_id,
        event: trigger.event,
        ...(trigger.dwell_minutes != null ? { dwell_minutes: trigger.dwell_minutes } : {}),
      };
    case 'trigger_signal': {
      const input: AutomationTriggerStepInput = {
        kind: 'trigger_signal',
        signal: trigger.signal,
        op: trigger.op,
      };
      if (trigger.value_num != null) input.value_num = trigger.value_num;
      if (trigger.value_text != null) input.value_text = trigger.value_text;
      if (trigger.value_bool != null) input.value_bool = trigger.value_bool;
      return input;
    }
  }
}

export function normalizeConditionInput(
  condition: AutomationConditionStepInput | AutomationConditionStep,
): AutomationConditionStepInput {
  switch (condition.kind) {
    case 'condition_signal': {
      const input: AutomationConditionStepInput = {
        kind: 'condition_signal',
        signal: condition.signal,
        op: condition.op,
      };
      if (condition.value_num != null) input.value_num = condition.value_num;
      if (condition.value_text != null) input.value_text = condition.value_text;
      if (condition.value_bool != null) input.value_bool = condition.value_bool;
      if (condition.value_min != null) input.value_min = condition.value_min;
      if (condition.value_max != null) input.value_max = condition.value_max;
      return input;
    }
    case 'condition_time_window':
      return {
        kind: 'condition_time_window',
        start_time: condition.start_time,
        end_time: condition.end_time,
        timezone: condition.timezone,
        days_of_week: [...condition.days_of_week],
      };
    case 'condition_geofence':
      return {
        kind: 'condition_geofence',
        place_id: condition.place_id,
        state: condition.state,
      };
    case 'condition_other_automation':
      return {
        kind: 'condition_other_automation',
        other_automation_id: condition.other_automation_id,
        state: condition.state,
      };
  }
}

export function normalizeActionInput(
  action: AutomationActionStepInput | AutomationActionStep,
): AutomationActionStepInput {
  switch (action.kind) {
    case 'action_wait':
      return { kind: 'action_wait', duration_s: action.duration_s };
    case 'action_command':
      return {
        kind: 'action_command',
        command_name: action.command_name,
        ...(action.command_params ? { command_params: action.command_params } : {}),
      };
    case 'action_notify':
      return {
        kind: 'action_notify',
        channel_id: action.channel_id,
        template: action.template,
      };
    case 'action_set_setting': {
      const input: AutomationActionStepInput = {
        kind: 'action_set_setting',
        setting_key: action.setting_key,
      };
      if (action.value_num != null) input.value_num = action.value_num;
      if (action.value_text != null) input.value_text = action.value_text;
      if (action.value_bool != null) input.value_bool = action.value_bool;
      return input;
    }
    case 'action_call_automation':
      return {
        kind: 'action_call_automation',
        target_automation_id: action.target_automation_id,
      };
  }
}

export function automationToForm(automation: AutomationFull): FormState {
  return {
    name: automation.name,
    description: automation.description ?? '',
    vehicle_id: automation.vehicle_id,
    enabled: automation.enabled,
    triggers: (automation.triggers ?? []).map(normalizeTriggerInput),
    conditions: (automation.conditions ?? []).map(normalizeConditionInput),
    actions: (automation.actions ?? []).map(normalizeActionInput),
  };
}

export function formToPayload(form: FormState): AutomationFullInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    vehicle_id: form.vehicle_id,
    enabled: form.enabled,
    triggers: form.triggers.map(normalizeTriggerInput),
    conditions: form.conditions.map(normalizeConditionInput),
    actions: form.actions.map(normalizeActionInput),
  };
}

export function applyDraftToForm(previous: FormState, proposedDraft: AutomationFullInput): FormState {
  return {
    ...previous,
    name: proposedDraft.name,
    description: proposedDraft.description ?? '',
    vehicle_id: proposedDraft.vehicle_id ?? null,
    enabled: proposedDraft.enabled ?? true,
    triggers: proposedDraft.triggers.map(normalizeTriggerInput),
    conditions: proposedDraft.conditions.map(normalizeConditionInput),
    actions: proposedDraft.actions.map(normalizeActionInput),
  };
}

export function triggerNeedsPlace(trigger: AutomationTriggerStepInput): boolean {
  return trigger.kind === 'trigger_geofence' && trigger.place_id <= 0;
}

export function conditionNeedsPlace(condition: AutomationConditionStepInput): boolean {
  return condition.kind === 'condition_geofence'
    && (!Number.isSafeInteger(condition.place_id) || condition.place_id <= 0);
}

export function conditionIsIncomplete(condition: AutomationConditionStepInput): boolean {
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  switch (condition.kind) {
    case 'condition_geofence':
      return conditionNeedsPlace(condition) || !['inside', 'outside', 'dwell'].includes(condition.state);
    case 'condition_other_automation':
      return !Number.isSafeInteger(condition.other_automation_id) || condition.other_automation_id <= 0
        || !['enabled', 'disabled', 'recently_triggered'].includes(condition.state);
    case 'condition_time_window':
      return !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(condition.start_time)
        || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(condition.end_time)
        || !condition.timezone?.trim()
        || !Array.isArray(condition.days_of_week)
        || condition.days_of_week.some((day) => !Number.isInteger(day) || day < 0 || day > 6);
    case 'condition_signal':
      if (!condition.signal?.trim() || !['=', '!=', '<', '<=', '>', '>=', 'between', 'in'].includes(condition.op)) return true;
      if (condition.op === 'between') {
        return !finite(condition.value_min) || !finite(condition.value_max)
          || condition.value_min > condition.value_max;
      }
      if (condition.op === 'in') {
        const values = condition.value_text?.split(',').map((value) => value.trim()) ?? [];
        return values.length === 0 || values.some((value) => value === ''
          || (BOOL_FIELD_KEYS.has(condition.signal) ? !['true', 'false'].includes(value)
            : condition.signal !== 'state' && !finite(Number(value))));
      }
      if (BOOL_FIELD_KEYS.has(condition.signal)) {
        return !['=', '!='].includes(condition.op) || typeof condition.value_bool !== 'boolean';
      }
      if (condition.signal === 'state') {
        return !['=', '!='].includes(condition.op) || !condition.value_text?.trim();
      }
      return !finite(condition.value_num);
  }
}

export function actionIsIncomplete(action: AutomationActionStepInput): boolean {
  switch (action.kind) {
    case 'action_wait':
      return !Number.isInteger(action.duration_s) || action.duration_s < 1 || action.duration_s > 3600;
    case 'action_command':
      if (!action.command_name.trim()) return true;
      if (action.command_name === 'set_charge_limit') {
        const percent = action.command_params?.percent;
        return typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100;
      }
      if (action.command_name === 'set_charging_amps') {
        const amps = action.command_params?.charging_amps;
        return typeof amps !== 'number' || !Number.isFinite(amps) || amps < 1;
      }
      if (action.command_name === 'set_temps') {
        return ['driver_temp', 'passenger_temp'].some((key) => {
          const temp = action.command_params?.[key];
          return typeof temp !== 'number' || !Number.isFinite(temp) || temp < 15 || temp > 30;
        });
      }
      return false;
    case 'action_notify':
      return action.channel_id <= 0 || action.template.trim() === '';
    case 'action_set_setting':
      return action.setting_key.trim() === ''
        || [action.value_text, action.value_num, action.value_bool]
          .filter((value) => value != null).length !== 1;
    case 'action_call_automation':
      return action.target_automation_id <= 0;
  }
}

export default function AutomationBuilderPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetId = searchParams.get('preset') ?? undefined;
  const isEdit = id != null;
  const automationId = id ? Number.parseInt(id, 10) : undefined;

  // Per-automation edit lease so a second tab
  // editing the SAME automation surfaces a conflict banner before its
  // save can silently overwrite this tab's work. New-automation drafts
  // are scoped per-preset (or "new") because two tabs editing two
  // independent new automations are not in conflict; only same-id edits
  // race.
  const leaseKey = isEdit
    ? `automation/${automationId ?? 'unknown'}`
    : presetId
      ? `automation/preset/${presetId}`
      : 'automation/new';
  useEditLease(leaseKey);
  const { vehicleId: aiVehicleId } = useSelectedVehicle();

  usePageTitle(
    isEdit
      ? t('automations.builder.editTitle', 'Edit automation')
      : presetId
        ? t('automations.builder.presetTitle', 'Install preset')
        : t('automations.builder.createTitle', 'Create automation'),
  );

  const automationQuery = useAutomation(automationId);
  const automationState = useDataState(automationQuery);
  const {
    data: existingAutomation,
    isLoading: isLoadingAutomation,
  } = automationQuery;
  const loadError = automationState.fatalError;
  const vehiclesQuery = useVehicles();
  const vehiclesState = useDataState(vehiclesQuery);
  const { data: vehicles } = vehiclesQuery;
  const channelsQuery = useNotificationChannels();
  const channelsState = useDataState(channelsQuery);
  const { data: channels } = channelsQuery;
  const presetQuery = useAutomationPreset(presetId);
  const presetState = useDataState(presetQuery);
  const { data: preset } = presetQuery;

  const breadcrumbLabels = {
    '/automations/:id/edit': existingAutomation?.name
      ? t('automations.builder.editBreadcrumb', 'Edit: {{name}}', {
        name: existingAutomation.name,
      })
      : undefined,
  };

  const createMutation = useCreateAutomationFull();
  const updateMutation = useUpdateAutomationFull();
  const testRunMutation = useTestRunAutomation();
  const operationalMode = useOperationalMode();

  // `useFormDraft` autosaves the in-progress
  // automation to localStorage so a tab close, SW reload, or auth redirect
  // doesn't destroy the user's work. Scoped per-automation (or
  // "new"/"preset:X") so two tabs editing different automations keep
  // separate drafts. Persistence is gated on `dirty && hydrated && !isSaving`
  // so we don't echo server data back to storage as a "draft".
  const draftKey = isEdit
    ? `automation:edit:${automationId ?? 'unknown'}`
    : presetId
      ? `automation:preset:${presetId}`
      : 'automation:new';

  const saveScopeRef = useRef({ key: draftKey });
  if (saveScopeRef.current.key !== draftKey) {
    saveScopeRef.current = { key: draftKey };
  }
  const saveSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflicts, setConflicts] = useState<AutomationConflict[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [validationTarget, setValidationTarget] = useState<'name' | 'trigger' | 'conditions' | 'actions' | null>(null);
  const saveErrorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const triggerTypeRef = useRef<HTMLSelectElement>(null);

  const createMutation_isPendingRef = useRef(createMutation.isPending);
  createMutation_isPendingRef.current = createMutation.isPending;
  const updateMutation_isPendingRef = useRef(updateMutation.isPending);
  updateMutation_isPendingRef.current = updateMutation.isPending;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const hydratedRef = useRef(hydrated);
  hydratedRef.current = hydrated;

  const {
    value: form,
    setValue: setFormValue,
    hasDraft,
    draftSavedAt,
    discardDraft,
  } = useFormDraft<FormState>(draftKey, getInitialForm(), {
    version: 1,
    debounceMs: 1500,
    skipPersist: () =>
      createMutation_isPendingRef.current
      || updateMutation_isPendingRef.current
      || !hydratedRef.current
      || !dirtyRef.current,
  });

  // For edits and preset installs, the canonical source of truth is the
  // server payload / preset definition — drop any restored draft as soon as
  // we know the real source data, so the user isn't editing a stale draft.
  // (For brand-new automations with no preset, drafts are the whole point.)
  useEffect(() => {
    if (isEdit && existingAutomation && !hydrated) {
      discardDraft();
      setFormValue(automationToForm(existingAutomation));
      setConflicts([]);
      setHydrated(true);
    }
  }, [discardDraft, existingAutomation, hydrated, isEdit, setFormValue]);

  useEffect(() => {
    if (!isEdit && preset && !hydrated) {
      discardDraft();
      setFormValue({
        name: preset.name,
        description: preset.description,
        vehicle_id: null,
        enabled: true,
        triggers: (preset.triggers ?? []).map((trigger) => (
          normalizeTriggerInput(trigger as AutomationTriggerStepInput)
        )),
        conditions: (preset.conditions ?? []).map((condition) => (
          normalizeConditionInput(condition as AutomationConditionStepInput)
        )),
        actions: (preset.actions ?? []).map((action) => (
          normalizeActionInput(action as AutomationActionStepInput)
        )),
      });
      setHydrated(true);
    }
  }, [discardDraft, hydrated, isEdit, preset, setFormValue]);

  // For brand-new automations (no `id`, no `preset`), `useFormDraft` already
  // hydrated the form value from any stored draft on mount. Mark hydrated
  // immediately so further user edits start being autosaved. If a draft was
  // restored, surface the dirty flag so the user can see their work and the
  // unsaved-changes guard kicks in.
  useEffect(() => {
    if (isEdit || presetId || hydrated) return;
    if (hasDraft) setDirty(true);
    setHydrated(true);
  }, [hasDraft, hydrated, isEdit, presetId]);

  // Reset hydration ONLY when the edited automation / preset actually
  // changes (e.g. the user navigates from editing #5 to #7 without a
  // remount). This effect is declared AFTER the three hydrate effects
  // above, so firing it unconditionally on mount would clobber the
  // `setHydrated(true)` the brand-new-automation branch performs in the
  // same commit — permanently wedging `hydrated` at false and silently
  // disabling draft autosave for new automations. Guarding on a
  // previous-source-key ref makes the initial mount a no-op while still
  // re-hydrating on a genuine source switch.
  const sourceKeyRef = useRef(`${automationId ?? ''}|${presetId ?? ''}`);
  useEffect(() => {
    const nextKey = `${automationId ?? ''}|${presetId ?? ''}`;
    if (sourceKeyRef.current === nextKey) return;
    sourceKeyRef.current = nextKey;
    setHydrated(false);
  }, [automationId, presetId]);

  // Browser-level unsaved-changes guard. Replaces the inline beforeunload
  // wiring; also exposes localized strings reused by the in-app discard
  // confirm dialog below.
  const dirtyForm = useDirtyForm(dirty);
  // In-app navigation guard. Sidebar clicks, browser
  // back, breadcrumb links, etc. now surface the same discard prompt as the
  // explicit Cancel button below.
  useNavigationGuard(dirty, t('forms.unsavedAutomation', 'You have an unsaved automation.'));
  const { confirm: confirmDiscard, dialogProps: discardDialogProps } = useConfirm();

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const presetUnavailable = !isEdit && Boolean(presetId) && (!preset || !hydrated);

  const vehicleOptions = useMemo(() => {
    const options = (vehicles ?? []).map((vehicle) => ({
      value: String(vehicle.id),
      label: vehicle.display_name || t('automations.builder.vehicleFallback', 'Vehicle {{id}}', {
        id: vehicle.id,
      }),
    }));
    if (form.vehicle_id != null && !options.some((option) => option.value === String(form.vehicle_id))) {
      options.push({
        value: String(form.vehicle_id),
        label: t('automations.builder.vehicleFallback', 'Vehicle {{id}}', { id: form.vehicle_id }),
      });
    }
    return [
      { value: '', label: t('automations.builder.allVehicles', 'All vehicles') },
      ...options,
    ];
  }, [form.vehicle_id, t, vehicles]);

  const triggerOptions = useMemo(
    () => [
      { value: '', label: t('automations.builder.selectTrigger', 'Select trigger type...') },
      ...TRIGGER_TYPES.map((trigger) => ({
        value: trigger.value,
        label: t(trigger.labelKey, trigger.fallback),
      })),
    ],
    [t],
  );

  const selectedTrigger = form.triggers[0] ?? null;
  const notificationChannels = channels ?? [];

  // Derived, null-safe summary of the automation's current shape — drives the
  // KPI band and the readiness checklist so the builder communicates progress
  // at a glance without the user having to hit Save to discover what's missing.
  const selectedTriggerLabel = useMemo(() => {
    if (!selectedTrigger) {
      return t('automations.builder.triggerNone', 'Not set');
    }
    const match = TRIGGER_TYPES.find((option) => option.value === selectedTrigger.kind);
    return match
      ? t(match.labelKey, match.fallback)
      : t('automations.builder.triggerNone', 'Not set');
  }, [selectedTrigger, t]);

  const conditionCount = form.conditions.length;
  const actionCount = form.actions.length;
  const nameReady = form.name.trim() !== '';
  const triggerReady = form.triggers.length > 0 && !form.triggers.some(triggerNeedsPlace);
  const actionsReady = form.actions.length > 0 && !form.actions.some(actionIsIncomplete);
  const incompleteCondition = form.conditions.find(conditionIsIncomplete);
  const conditionsReady = !incompleteCondition;
  const conditionError = incompleteCondition
    ? conditionNeedsPlace(incompleteCondition)
      ? t('automations.builder.errorConditionPlace', 'Select a geofence for each geofence condition')
      : `${t('automations.builder.summaryConditions', 'Conditions')}: ${t(
        incompleteCondition.kind === 'condition_signal' ? 'automations.conditions.signal'
          : incompleteCondition.kind === 'condition_time_window' ? 'automations.conditions.timeWindow'
            : incompleteCondition.kind === 'condition_other_automation' ? 'automations.conditions.otherAutomation'
              : 'automations.conditions.geofence',
      )} — ${t('automations.builder.readyPending', 'incomplete')}`
    : null;
  const conditionErrorId = `${saveErrorId}-conditions`;
  const allReady = nameReady
    && triggerReady
    && actionsReady
    && conditionsReady
    && !presetUnavailable;
  const draftContext = t('automations.builder.brief.context', 'Current editor draft only. Publishing still requires validation and an explicit save.');
  const rawMetrics: readonly StatMetric[] = [
    { metricId: 'text', occurrenceId: 'trigger', rawValue: selectedTriggerLabel, label: t('automations.builder.summaryTrigger', 'Trigger'), description: draftContext },
    { metricId: 'count', occurrenceId: 'conditions', rawValue: conditionCount, label: t('automations.builder.summaryConditions', 'Conditions'), description: t('automations.builder.onlyIfDesc', 'Optional checks that must pass before actions run.') },
    { metricId: 'count', occurrenceId: 'actions', rawValue: actionCount, label: t('automations.builder.summaryActions', 'Actions'), description: t('automations.builder.thenDesc', 'Actions are executed in order.') },
    { metricId: 'status', occurrenceId: 'status', rawValue: form.enabled ? t('automations.builder.statusEnabled', 'Enabled') : t('automations.builder.statusDisabled', 'Disabled'),
      label: t('automations.builder.summaryStatus', 'Status'), description: draftContext },
  ];
  const briefMetrics = useOperationalMetrics(rawMetrics);

  const readinessItems = useMemo(
    () => [
      { key: 'name', ok: nameReady, label: t('automations.builder.readyName', 'Name added') },
      { key: 'trigger', ok: triggerReady, label: t('automations.builder.readyTrigger', 'Trigger configured') },
      { key: 'conditions', ok: conditionsReady, label: t('automations.builder.summaryConditions', 'Conditions') },
      { key: 'actions', ok: actionsReady, label: t('automations.builder.readyActions', 'At least one action') },
    ],
    [nameReady, triggerReady, conditionsReady, actionsReady, t],
  );

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormValue((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  }, [setFormValue]);

  const updateSelectedTrigger = useCallback(
    (trigger: AutomationTriggerStepInput | null) => {
      setFormValue((previous) => ({
        ...previous,
        triggers: trigger
          ? [trigger, ...previous.triggers.slice(1)]
          : previous.triggers.slice(1),
      }));
      setDirty(true);
    },
    [setFormValue],
  );

  const handleTriggerKindChange = useCallback(
    (nextKind: string) => {
      updateSelectedTrigger(nextKind ? createDefaultTrigger(nextKind as AutomationTriggerKind) : null);
    },
    [updateSelectedTrigger],
  );

  const validate = useCallback((): string | null => {
    if (!form.name.trim()) {
      return t('automations.builder.errorName', 'Name is required');
    }
    if (form.triggers.length === 0) {
      return t('automations.builder.errorTrigger', 'Trigger type is required');
    }
    if (form.triggers.some(triggerNeedsPlace)) {
      return t('automations.builder.errorTriggerPlace', 'Select a geofence for the trigger');
    }
    if (conditionError) return conditionError;
    if (form.actions.length === 0) {
      return t('automations.builder.errorActions', 'At least one action is required');
    }
    if (form.actions.some(actionIsIncomplete)) {
      return t('automations.builder.errorActionDetails', 'Complete every action before saving');
    }
    return null;
  }, [conditionError, form, t]);

  const handleSave = useCallback(async () => {
    if (presetUnavailable) return;
    setValidationTarget(null);
    const error = validate();
    if (error) {
      setSaveError(error);
      if (!nameReady) {
        setValidationTarget('name');
        nameRef.current?.focus();
      } else if (form.triggers.length === 0) {
        setValidationTarget('trigger');
        triggerTypeRef.current?.focus();
      } else {
        setValidationTarget(!triggerReady ? 'trigger' : !conditionsReady ? 'conditions' : 'actions');
        const section = !triggerReady
          ? 'automation-builder'
          : !conditionsReady
            ? 'automation-conditions'
            : 'automation-actions';
        formRef.current?.querySelector<HTMLElement>(
          `[data-tour="${section}"] :is(input, select, textarea, button):not(:disabled):not([type="hidden"])`,
        )?.focus();
      }
      return;
    }
    setSaveError(null);

    const saveScope = saveScopeRef.current;
    const saveSequence = ++saveSequenceRef.current;
    const isCurrentSave = () => mountedRef.current
      && saveScopeRef.current === saveScope
      && saveSequenceRef.current === saveSequence;
    try {
      const payload = formToPayload(form);
      const result = isEdit && automationId
        ? await updateMutation.mutateAsync({ id: automationId, input: payload })
        : await createMutation.mutateAsync(payload);
      if (!isCurrentSave()) return;
      setDirty(false);
      setSavedId(result.id);
      // The save API conflict-checks every create/update: surface its
      // verdict instead of clearing the slate. With conflicts we stay on
      // the page so the warnings are seen (the save already succeeded);
      // otherwise navigate back to the list as before.
      const resultConflicts = result.conflicts ?? [];
      setConflicts(resultConflicts);
      // Successful save → drop the autosaved draft so a future visit
      // doesn't restore stale work.
      discardDraft();
      setFormValue(applyDraftToForm(form, payload));
      if (resultConflicts.length === 0) {
        navigate('/automations');
      }
    } catch (error) {
      if (!isCurrentSave()) return;
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [automationId, conditionsReady, createMutation, discardDraft, form, isEdit, nameReady, navigate, presetUnavailable, setFormValue, triggerReady, updateMutation, validate]);

  /**
   * Cancel handler — if the form is dirty, prompt before navigating away.
   * Otherwise leave immediately. The browser-level beforeunload guard
   * (refresh/close-tab) is wired by useDirtyForm above.
   */
  const handleBackToList = useCallback(async () => {
    if (dirty) {
      const ok = await confirmDiscard({
        title: dirtyForm.title,
        message: dirtyForm.message,
        variant: 'warning',
        confirmLabel: dirtyForm.discardLabel,
        cancelLabel: dirtyForm.keepEditingLabel,
        silenceKey: 'discard-draft',
      });
      if (!ok) return;
    }
    navigate('/automations');
  }, [
    dirty,
    confirmDiscard,
    dirtyForm.title,
    dirtyForm.message,
    dirtyForm.discardLabel,
    dirtyForm.keepEditingLabel,
    navigate,
  ]);

  const handleTestRun = useCallback(() => {
    const targetId = savedId ?? automationId;
    if (targetId) {
      testRunMutation.mutate(targetId);
    }
  }, [automationId, savedId, testRunMutation]);

  if (isEdit && isLoadingAutomation && !automationState.hasData) {
    return (
      <PageLayout
        title={t('automations.builder.editTitle', 'Edit automation')}
        loading
        breadcrumbLabels={breadcrumbLabels}
      >
        <div />
      </PageLayout>
    );
  }

  if (isEdit && loadError) {
    return (
      <PageLayout
        title={t('automations.builder.editTitle', 'Edit automation')}
        error={loadError instanceof Error ? loadError : new Error(String(loadError))}
        breadcrumbLabels={breadcrumbLabels}
      >
        <div />
      </PageLayout>
    );
  }

  if (isEdit && !existingAutomation && !isLoadingAutomation) {
    return (
      <PageLayout
        title={t('automations.builder.editTitle', 'Edit automation')}
        breadcrumbLabels={breadcrumbLabels}
      >
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Icon icon={AlertTriangle} size="xl" />}
          message={t('automations.builder.notFound', 'Automation not found')}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={isEdit
        ? t('automations.builder.editTitle', 'Edit automation')
        : t('automations.builder.createTitle', 'Create automation')}
      subtitle={t(
        'automations.builder.subtitle',
        'Configure supported typed triggers, conditions, and actions for your automation.',
      )}
      breadcrumbLabels={breadcrumbLabels}
      secondaryActions={(
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          wrapLabel
          onClick={handleBackToList}
          className="min-h-11 max-w-full"
          icon={<Icon icon={ArrowLeft} />}
          aria-label={t('automations.builder.backToList', 'Back to automations')}
        >
          {t('automations.builder.backToList', 'Back to automations')}
        </UiButton>
      )}
    >
      <StaleRefreshWarning state={automationState} label={t('automations.builder.editTitle', 'Edit automation')} />
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
        className="space-y-6"
      >
        <OperationalWriteNotice
          title={t(
            'automations.builder.readOnly.title',
            'Automation publishing is read-only',
          )}
        />

        {/* Session / concurrency banners — full width, top of page */}
        <EditConflictBanner
          resourceKey={leaseKey}
          resourceLabel={t('editConflict.resource.automation', 'This automation')}
        />

        {!isEdit && presetId && (
          <GlassPanel className="min-w-0 space-y-3 p-4">
            <PanelTitle>{t('automations.builder.presetTitle', 'Install preset')}</PanelTitle>
            <StaleRefreshWarning state={presetState} label={t('automations.presets.resource', 'Automation presets')} />
            <SourceContent
              state={presetState.hasData ? 'ready' : presetState.fatalError ? 'error' : presetQuery.isSuccess ? 'empty' : 'loading'}
              label={t('automations.presets.resource', 'Automation presets')}
              emptyMessage={t('automations.presets.empty', 'No preset templates available')}
              errorMessage={t('error.loadFailed', 'Failed to load data')}
              error={presetState.fatalError}
              errorRecovery={{ onRetry: presetState.retry ?? undefined }}
            >
              <Text as="p" variant="bodySm" color="secondary">{preset?.name}</Text>
            </SourceContent>
          </GlassPanel>
        )}

        {hasDraft && !isEdit && !presetId && (
          <DraftRecoveryBanner
            hasDraft={hasDraft}
            draftSavedAt={draftSavedAt}
            onDiscard={() => {
              discardDraft();
              setDirty(false);
            }}
            itemNoun={t('draft.noun.automation', 'Automation')}
          />
        )}

        {/* 1 — Draft summary; the typed editors remain the source of truth */}
        <FadeIn>
          <div>
            <OperationalBrief
              compact
              testId="automation-builder-brief"
              eyebrow={t('automations.builder.brief.eyebrow', 'Automation draft')}
              title={t('automations.builder.summary', 'Automation summary')}
              description={draftContext}
              statusLabel={allReady ? t('automations.builder.readyToSave', 'Ready to save')
                : t('automations.builder.notReady', 'Not ready yet')}
              statusTone="neutral"
              metrics={briefMetrics}
              scope={t('automations.builder.brief.scope', 'Editor configuration; not execution history')}
              freshness={dirty ? t('automations.builder.brief.unsaved', 'Local changes not published')
                : t('automations.builder.brief.editor', 'Current editor state')}
              provenance={draftContext}
            />
          </div>
        </FadeIn>

        {/* 2 — Two-pane bento: build canvas (hero) + assist rail */}
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          {/* Build canvas — the When → Only If → Then flow */}
          <div className="min-w-0 space-y-6 xl:col-span-2">
            <FadeIn>
              <FormSection title={t('automations.builder.general', 'General')}>
                <UiInput
                  ref={nameRef}
                  label={t('automations.builder.name', 'Name')}
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder={t('automations.builder.namePlaceholder', 'Morning commute prep')}
                  required
                  className="min-h-11"
                  aria-invalid={validationTarget === 'name' && !nameReady ? 'true' : undefined}
                  aria-describedby={validationTarget === 'name' && !nameReady && saveError ? saveErrorId : undefined}
                />
                <UiTextarea
                  label={t('automations.builder.description', 'Description')}
                  value={form.description}
                  onChange={(event) => update('description', event.target.value)}
                  placeholder={t(
                    'automations.builder.descriptionPlaceholder',
                    'Prepare the car for the morning commute',
                  )}
                  rows={2}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-end">
                  <div className="min-w-0 space-y-3">
                    <StaleRefreshWarning state={vehiclesState} label={t('dataSources.labels.vehicleRegistry', 'Vehicle registry')} />
                    <SourceContent
                      state={vehiclesState.hasData ? (vehicles?.length ? 'ready' : 'empty') : vehiclesState.fatalError ? 'error' : 'loading'}
                      label={t('dataSources.labels.vehicleRegistry', 'Vehicle registry')}
                      emptyMessage={t('vehicles.emptyTitle', 'No vehicles yet')}
                      emptyContent={<Text as="p" variant="bodySm" color="secondary">{t('vehicles.emptyTitle', 'No vehicles yet')}</Text>}
                      errorMessage={t('vehicles.loadError', 'Failed to load vehicles.')}
                      error={vehiclesState.fatalError}
                      errorRecovery={{ onRetry: vehiclesState.retry ?? undefined }}
                      loadingContent={<Text as="p" variant="bodySm" color="secondary">{t('common.loading', 'Loading...')}</Text>}
                    >{null}</SourceContent>
                    <UiSelect
                      label={t('automations.builder.vehicle', 'Vehicle')}
                      options={vehicleOptions}
                      value={form.vehicle_id != null ? String(form.vehicle_id) : ''}
                      className="min-h-11"
                      onChange={(event) => update(
                        'vehicle_id',
                        event.target.value ? Number(event.target.value) : null,
                      )}
                    />
                  </div>
                  <Toggle
                    label={t('automations.builder.enabled', 'Enabled')}
                    checked={form.enabled}
                    onChange={(enabled) => update('enabled', enabled)}
                  />
                </div>
              </FormSection>
            </FadeIn>

            <FadeIn delay={0.05}>
              <div data-tour="automation-builder">
                <FormSection
                  title={t('automations.builder.when', 'When (trigger)')}
                  description={t(
                    'automations.builder.whenDesc',
                    'Choose the supported typed contract that starts this automation.',
                  )}
                >
                  <UiSelect
                    ref={triggerTypeRef}
                    label={t('automations.builder.triggerType', 'Trigger type')}
                    help={{
                      i18nKey: 'help.fields.automations.triggerType',
                      content: 'Decides when this automation starts: signal change, geofence enter/exit, time of day, charging event, or another automation completing.',
                    }}
                    options={triggerOptions}
                    value={selectedTrigger?.kind ?? ''}
                    className="min-h-11"
                    aria-invalid={validationTarget === 'trigger' && !triggerReady ? 'true' : undefined}
                    aria-describedby={validationTarget === 'trigger' && !triggerReady && saveError ? saveErrorId : undefined}
                    onChange={(event) => handleTriggerKindChange(event.target.value)}
                  />
                  {selectedTrigger ? (
                    <GlassPanel className="mt-3 p-4">
                      <TriggerConfigurator
                        trigger={selectedTrigger}
                        onChange={updateSelectedTrigger}
                      />
                    </GlassPanel>
                  ) : (
                    <GlassPanel className="mt-3 p-4">
                      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                        message={t(
                          'automations.builder.emptyTrigger',
                          'Select a supported trigger type to configure when this automation starts.',
                        )}
                      />
                    </GlassPanel>
                  )}
                </FormSection>
              </div>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div
                data-tour="automation-conditions"
                role="group"
                aria-label={t('automations.builder.onlyIf', 'Only if (conditions)')}
                aria-invalid={!conditionsReady ? 'true' : undefined}
                aria-describedby={conditionError ? conditionErrorId : undefined}
              >
                <FormSection
                  title={t('automations.builder.onlyIf', 'Only if (conditions)')}
                  description={t(
                    'automations.builder.onlyIfDesc',
                    'Optional checks that must pass before actions run.',
                  )}
                >
                  <ConditionBuilder
                    conditions={form.conditions}
                    onChange={(conditions) => update('conditions', conditions)}
                  />
                </FormSection>
              </div>
            </FadeIn>

            <FadeIn delay={0.15}>
              <div data-tour="automation-actions">
                <FormSection
                  title={t('automations.builder.then', 'Then (actions)')}
                  description={t(
                    'automations.builder.thenDesc',
                    'Actions are executed in order.',
                  )}
                >
                  <StaleRefreshWarning state={channelsState} label={t('dataSources.labels.notificationChannels', 'Notification channels')} />
                  <SourceContent
                    state={channelsState.hasData ? (channels?.length ? 'ready' : 'empty') : channelsState.fatalError ? 'error' : 'loading'}
                    label={t('dataSources.labels.notificationChannels', 'Notification channels')}
                    emptyMessage={t('automations.builder.noChannels', 'No channels configured')}
                    emptyContent={<Text as="p" variant="bodySm" color="secondary">{t('automations.builder.noChannels', 'No channels configured')}</Text>}
                    errorMessage={t('error.loadFailed', 'Failed to load data')}
                    error={channelsState.fatalError}
                    errorRecovery={{ onRetry: channelsState.retry ?? undefined }}
                    loadingContent={<Text as="p" variant="bodySm" color="secondary">{t('common.loading', 'Loading...')}</Text>}
                  >{null}</SourceContent>
                  <ActionBuilder
                    actions={form.actions}
                    channels={notificationChannels}
                    onChange={(actions) => update('actions', actions)}
                  />
                </FormSection>
              </div>
            </FadeIn>
          </div>

          {/* Assist rail — readiness, AI helpers, preset hint */}
          <aside
            aria-label={t('automations.builder.assistant', 'Builder assistant')}
            className="min-w-0 space-y-6 xl:col-span-1 xl:sticky xl:top-4 xl:self-start"
          >
            <FadeIn>
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-3 flex items-center gap-2">
                  <Icon icon={ListChecks} className={typography.color.secondary} />
                  {t('automations.builder.readiness', 'Readiness')}
                </PanelTitle>
                <ul className="space-y-2">
                  {readinessItems.map((item) => (
                    <li key={item.key} className="flex min-w-0 items-start gap-2">
                      {item.ok ? (
                        <Icon icon={CheckCircle2} className={neonColorMap.green.text} />
                      ) : (
                        <Icon icon={Circle} className={typography.color.muted} />
                      )}
                      <Text
                        as="span"
                        variant="bodySm"
                        className="min-w-0 break-words"
                      >
                        {item.label}
                      </Text>
                      <VisuallyHidden>
                        {item.ok
                          ? t('automations.builder.readyDone', 'complete')
                          : t('automations.builder.readyPending', 'incomplete')}
                      </VisuallyHidden>
                    </li>
                  ))}
                </ul>
                {!conditionsReady && (
                  <Text id={conditionErrorId} as="p" variant="bodySm" color="secondary" className="mt-3 break-words" role="status">
                    {conditionError}
                  </Text>
                )}
                <div className="mt-4">
                  <Badge variant={allReady ? 'success' : 'neutral'} size="lg">
                    {allReady
                      ? t('automations.builder.readyToSave', 'Ready to save')
                      : t('automations.builder.notReady', 'Not ready yet')}
                  </Badge>
                </div>
              </GlassPanel>
            </FadeIn>

            <FadeIn>
              <AINLAutomationBuilder vehicleId={aiVehicleId ?? undefined} />
            </FadeIn>

            <FadeIn>
              <AIGeofenceAwareAutomationSuggestions
                vehicleId={aiVehicleId ?? undefined}
                onApplyDraft={(proposedDraft) => {
                  // Copy the typed Automation graph
                  // proposed by the AI panel into the canonical
                  // baseline form state. The AI panel never persists
                  // directly; the user reviews the populated form and
                  // clicks Save (which goes through the canonical
                  // POST /api/v1/automations write path —
                  // useCreateAutomationFull). Re-uses the existing
                  // per-step normalizers so the typed envelope is
                  // byte-equivalent to one the canonical
                  // POST /api/v1/automations handler accepts.
                  setFormValue((previous) => applyDraftToForm(previous, proposedDraft));
                  setDirty(true);
                }}
              />
            </FadeIn>

            {!isEdit && (
              <FadeIn>
                <GlassPanel className="p-4 sm:p-5">
                  <Text as="p" variant="bodySm">
                    {t(
                      'automations.builder.presetHint',
                      'Not sure where to start? Browse typed automation templates.',
                    )}
                  </Text>
                </GlassPanel>
              </FadeIn>
            )}
          </aside>
        </div>

        {/* 3 — Save-time feedback: conflicts + errors, full width */}
        {conflicts.length > 0 && (
          <FadeIn>
            <div data-tour="automation-conflicts">
              <ConflictWarnings conflicts={conflicts} />
            </div>
          </FadeIn>
        )}

        {saveError && (
          <AlertBanner
            id={saveErrorId}
            variant="danger"
            icon={<Icon icon={AlertTriangle} />}
            title={t('automations.builder.saveError', 'Save error')}
          >
            {saveError}
          </AlertBanner>
        )}

        {/* 4 — Action bar */}
        <FadeIn delay={0.25}>
          <GlassPanel className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <UiButton
                type="submit"
                wrapLabel
                icon={<Icon icon={Save} />}
                loading={isSaving}
                disabled={isSaving || presetUnavailable || !operationalMode.canWrite}
                title={operationalMode.writeBlockReason ?? undefined}
                className="min-h-11"
              >
                {isEdit
                  ? t('automations.builder.save', 'Save')
                  : t('automations.builder.create', 'Create')}
              </UiButton>
              {(savedId ?? automationId) && (
                <UiButton
                  type="button"
                  wrapLabel
                  icon={<Icon icon={PlayCircle} />}
                  variant="secondary"
                  onClick={handleTestRun}
                  loading={testRunMutation.isPending}
                  disabled={testRunMutation.isPending || !operationalMode.canWrite}
                  title={operationalMode.writeBlockReason ?? undefined}
                  className="min-h-11"
                >
                  {t('automations.builder.testRun', 'Test run')}
                </UiButton>
              )}
              <UiButton
                type="button"
                wrapLabel
                icon={<Icon icon={X} />}
                variant="ghost"
                onClick={handleBackToList}
                className="min-h-11"
              >
                {t('automations.builder.cancel', 'Cancel')}
              </UiButton>

              {testRunMutation.isSuccess && (
                <Badge variant="success" size="lg">
                  <Icon icon={Zap} size="sm" />
                  {t('automations.builder.testRunStarted', 'Test run started!')}
                </Badge>
              )}
            </div>
          </GlassPanel>
        </FadeIn>
      </form>
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </PageLayout>
  );
}

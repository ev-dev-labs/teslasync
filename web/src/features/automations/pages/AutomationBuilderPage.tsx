import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Cog,
  Filter,
  ListChecks,
  PlayCircle,
  Power,
  Save,
  X,
  Zap,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  Input as UiInput,
  PanelTitle,
  Select as UiSelect,
  Button as UiButton,
  Text,
  Toggle,
  Textarea as UiTextarea,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  AlertBanner,
  DraftRecoveryBanner,
  EmptyState,
  EditConflictBanner,
  OperationalWriteNotice,
} from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { FormSection } from '@/components/forms';
import { AINLAutomationBuilder } from '@/components/ai/AINLAutomationBuilder';
import { AIGeofenceAwareAutomationSuggestions } from '@/components/ai/AIGeofenceAwareAutomationSuggestions';
import { usePageTitle } from '@/hooks/usePageTitle';
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
    triggers: (proposedDraft.triggers as unknown as AutomationTriggerStepInput[]).map(normalizeTriggerInput),
    conditions: (proposedDraft.conditions as unknown as AutomationConditionStepInput[]).map(normalizeConditionInput),
    actions: (proposedDraft.actions as unknown as AutomationActionStepInput[]).map(normalizeActionInput),
  };
}

export function triggerNeedsPlace(trigger: AutomationTriggerStepInput): boolean {
  return trigger.kind === 'trigger_geofence' && trigger.place_id <= 0;
}

export function conditionNeedsPlace(condition: AutomationConditionStepInput): boolean {
  return condition.kind === 'condition_geofence' && condition.place_id <= 0;
}

export function actionIsIncomplete(action: AutomationActionStepInput): boolean {
  switch (action.kind) {
    case 'action_command':
      return action.command_name.trim() === '';
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
      ? t('automations.builder.editTitle', 'Edit Automation')
      : presetId
        ? t('automations.builder.presetTitle', 'Install Preset')
        : t('automations.builder.createTitle', 'Create Automation'),
  );

  const {
    data: existingAutomation,
    isLoading: isLoadingAutomation,
    error: loadError,
  } = useAutomation(automationId);
  const { data: vehicles } = useVehicles();
  const { data: channels } = useNotificationChannels();
  const { data: preset } = useAutomationPreset(presetId);

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

  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflicts, setConflicts] = useState<AutomationConflict[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

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

  const vehicleOptions = useMemo(() => {
    const options = (vehicles ?? []).map((vehicle) => ({
      value: String(vehicle.id),
      label: vehicle.display_name || t('automations.builder.vehicleFallback', 'Vehicle {{id}}', {
        id: vehicle.id,
      }),
    }));
    return [
      { value: '', label: t('automations.builder.allVehicles', 'All Vehicles') },
      ...options,
    ];
  }, [t, vehicles]);

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
  const allReady = nameReady
    && triggerReady
    && actionsReady
    && !form.conditions.some(conditionNeedsPlace);

  const readinessItems = useMemo(
    () => [
      { key: 'name', ok: nameReady, label: t('automations.builder.readyName', 'Name added') },
      { key: 'trigger', ok: triggerReady, label: t('automations.builder.readyTrigger', 'Trigger configured') },
      { key: 'actions', ok: actionsReady, label: t('automations.builder.readyActions', 'At least one action') },
    ],
    [nameReady, triggerReady, actionsReady, t],
  );

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormValue((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  }, [setFormValue]);

  const handleTriggerKindChange = useCallback(
    (nextKind: string) => {
      update(
        'triggers',
        nextKind ? [createDefaultTrigger(nextKind as AutomationTriggerKind)] : [],
      );
    },
    [update],
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
    if (form.conditions.some(conditionNeedsPlace)) {
      return t('automations.builder.errorConditionPlace', 'Select a geofence for each geofence condition');
    }
    if (form.actions.length === 0) {
      return t('automations.builder.errorActions', 'At least one action is required');
    }
    if (form.actions.some(actionIsIncomplete)) {
      return t('automations.builder.errorActionDetails', 'Complete every action before saving');
    }
    return null;
  }, [form, t]);

  const handleSave = useCallback(async () => {
    const error = validate();
    if (error) {
      setSaveError(error);
      return;
    }
    setSaveError(null);

    try {
      const payload = formToPayload(form);
      const result = isEdit && automationId
        ? await updateMutation.mutateAsync({ id: automationId, input: payload })
        : await createMutation.mutateAsync(payload);
      setDirty(false);
      setSavedId(result.id);
      setConflicts([]);
      // Successful save → drop the autosaved draft so a future visit
      // doesn't restore stale work.
      discardDraft();
      navigate('/automations');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [automationId, createMutation, discardDraft, form, isEdit, navigate, updateMutation, validate]);

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

  if (isEdit && isLoadingAutomation) {
    return (
      <PageContainer
        title={t('automations.builder.editTitle', 'Edit Automation')}
        loading
        breadcrumbLabels={breadcrumbLabels}
      >
        <div />
      </PageContainer>
    );
  }

  if (isEdit && loadError) {
    return (
      <PageContainer
        title={t('automations.builder.editTitle', 'Edit Automation')}
        error={loadError instanceof Error ? loadError : new Error(String(loadError))}
        breadcrumbLabels={breadcrumbLabels}
      >
        <div />
      </PageContainer>
    );
  }

  if (isEdit && !existingAutomation && !isLoadingAutomation) {
    return (
      <PageContainer
        title={t('automations.builder.editTitle', 'Edit Automation')}
        breadcrumbLabels={breadcrumbLabels}
      >
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<AlertTriangle className="h-8 w-8" />}
          message={t('automations.builder.notFound', 'Automation not found')}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={isEdit
        ? t('automations.builder.editTitle', 'Edit Automation')
        : t('automations.builder.createTitle', 'Create Automation')}
      subtitle={t(
        'automations.builder.subtitle',
        'Configure supported typed triggers, conditions, and actions for your automation.',
      )}
      breadcrumbLabels={breadcrumbLabels}
      actions={(
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleBackToList}
          className="min-h-11 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          icon={<ArrowLeft className="h-4 w-4" />}
          aria-label={t('automations.builder.backToList', 'Back to Automations')}
        >
          {t('automations.builder.backToList', 'Back to Automations')}
        </UiButton>
      )}
    >
      <form
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

        {/* 1 — Summary KPI band: reflows from 2 → 4 columns, fills the width */}
        <FadeIn>
          <section
            aria-label={t('automations.builder.summary', 'Automation summary')}
            className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:gap-5"
          >
            <MetricCard
              label={t('automations.builder.summaryTrigger', 'Trigger')}
              value={selectedTriggerLabel}
              icon={<Zap className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t('automations.builder.summaryConditions', 'Conditions')}
              value={conditionCount}
              icon={<Filter className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t('automations.builder.summaryActions', 'Actions')}
              value={actionCount}
              icon={<Cog className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t('automations.builder.summaryStatus', 'Status')}
              value={form.enabled
                ? t('automations.builder.statusEnabled', 'Enabled')
                : t('automations.builder.statusDisabled', 'Disabled')}
              icon={<Power className="h-5 w-5" />}
              color={form.enabled ? 'green' : 'amber'}
            />
          </section>
        </FadeIn>

        {/* 2 — Two-pane bento: build canvas (hero) + assist rail */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          {/* Build canvas — the When → Only If → Then flow */}
          <div className="space-y-6 xl:col-span-2">
            <FadeIn>
              <FormSection title={t('automations.builder.general', 'General')}>
                <UiInput
                  label={t('automations.builder.name', 'Name')}
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder={t('automations.builder.namePlaceholder', 'Morning Commute Prep')}
                  required
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
                  <UiSelect
                    label={t('automations.builder.vehicle', 'Vehicle')}
                    options={vehicleOptions}
                    value={form.vehicle_id != null ? String(form.vehicle_id) : ''}
                    onChange={(event) => update(
                      'vehicle_id',
                      event.target.value ? Number(event.target.value) : null,
                    )}
                  />
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
                  title={t('automations.builder.when', 'When (Trigger)')}
                  description={t(
                    'automations.builder.whenDesc',
                    'Choose the supported typed contract that starts this automation.',
                  )}
                >
                  <UiSelect
                    label={t('automations.builder.triggerType', 'Trigger Type')}
                    help={{
                      i18nKey: 'help.fields.automations.triggerType',
                      content: 'Decides when this automation starts: signal change, geofence enter/exit, time of day, charging event, or another automation completing.',
                    }}
                    options={triggerOptions}
                    value={selectedTrigger?.kind ?? ''}
                    onChange={(event) => handleTriggerKindChange(event.target.value)}
                  />
                  {selectedTrigger ? (
                    <GlassPanel className="mt-3 p-4">
                      <TriggerConfigurator
                        trigger={selectedTrigger}
                        onChange={(trigger) => update('triggers', [trigger])}
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
              <div data-tour="automation-conditions">
                <FormSection
                  title={t('automations.builder.onlyIf', 'Only If (Conditions)')}
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
                  title={t('automations.builder.then', 'Then (Actions)')}
                  description={t(
                    'automations.builder.thenDesc',
                    'Actions are executed in order.',
                  )}
                >
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
            className="space-y-6 xl:col-span-1 xl:sticky xl:top-4 xl:self-start"
          >
            <FadeIn>
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-3 flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  {t('automations.builder.readiness', 'Readiness')}
                </PanelTitle>
                <ul className="space-y-2">
                  {readinessItems.map((item) => (
                    <li key={item.key} className="flex items-center gap-2">
                      {item.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                      )}
                      <Text
                        as="span"
                        variant="bodySm"
                        className={item.ok ? 'text-[var(--text-primary)]' : undefined}
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
            variant="danger"
            icon={<AlertTriangle className="h-4 w-4" />}
            title={t('automations.builder.saveError', 'Save Error')}
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
                loading={isSaving}
                disabled={isSaving || !operationalMode.canWrite}
                title={operationalMode.writeBlockReason ?? undefined}
                className="min-h-11"
              >
                <Save className="mr-2 h-4 w-4" />
                {isEdit
                  ? t('automations.builder.save', 'Save')
                  : t('automations.builder.create', 'Create')}
              </UiButton>
              {(savedId ?? automationId) && (
                <UiButton
                  type="button"
                  variant="secondary"
                  onClick={handleTestRun}
                  loading={testRunMutation.isPending}
                  disabled={testRunMutation.isPending || !operationalMode.canWrite}
                  title={operationalMode.writeBlockReason ?? undefined}
                  className="min-h-11"
                >
                  <PlayCircle className="mr-2 h-4 w-4" />
                  {t('automations.builder.testRun', 'Test Run')}
                </UiButton>
              )}
              <UiButton
                type="button"
                variant="ghost"
                onClick={handleBackToList}
                className="min-h-11"
              >
                <X className="mr-2 h-4 w-4" />
                {t('automations.builder.cancel', 'Cancel')}
              </UiButton>

              {testRunMutation.isSuccess && (
                <Badge variant="success" size="lg">
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('automations.builder.testRunStarted', 'Test run started!')}
                </Badge>
              )}
            </div>
          </GlassPanel>
        </FadeIn>
      </form>
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </PageContainer>
  );
}

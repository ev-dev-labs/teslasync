import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowLeft,
  PlayCircle,
  Save,
  X,
  Zap,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  Toggle,
  Textarea as UiTextarea,
} from '@/components/ui';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { FormSection } from '@/components/forms';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useNotificationChannels } from '@/api/hooks/useNotifications';
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

interface FormState {
  name: string;
  description: string;
  vehicle_id: number | null;
  enabled: boolean;
  triggers: AutomationTriggerStepInput[];
  conditions: AutomationConditionStepInput[];
  actions: AutomationActionStepInput[];
}

function getInitialForm(): FormState {
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

function normalizeTriggerInput(
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

function normalizeConditionInput(
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

function normalizeActionInput(
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

function automationToForm(automation: AutomationFull): FormState {
  return {
    name: automation.name,
    description: automation.description ?? '',
    vehicle_id: automation.vehicle_id,
    enabled: automation.enabled,
    triggers: automation.triggers.map(normalizeTriggerInput),
    conditions: automation.conditions.map(normalizeConditionInput),
    actions: automation.actions.map(normalizeActionInput),
  };
}

function formToPayload(form: FormState): AutomationFullInput {
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

function triggerNeedsPlace(trigger: AutomationTriggerStepInput): boolean {
  return trigger.kind === 'trigger_geofence' && trigger.place_id <= 0;
}

function conditionNeedsPlace(condition: AutomationConditionStepInput): boolean {
  return condition.kind === 'condition_geofence' && condition.place_id <= 0;
}

function actionIsIncomplete(action: AutomationActionStepInput): boolean {
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

  const breadcrumbs = useBreadcrumbs({
    '/automations/:id/edit': existingAutomation?.name
      ? t('automations.builder.editBreadcrumb', 'Edit: {{name}}', {
        name: existingAutomation.name,
      })
      : undefined,
  });

  const createMutation = useCreateAutomationFull();
  const updateMutation = useUpdateAutomationFull();
  const testRunMutation = useTestRunAutomation();

  const [form, setForm] = useState<FormState>(getInitialForm);
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflicts, setConflicts] = useState<AutomationConflict[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  useEffect(() => {
    if (isEdit && existingAutomation && !hydrated) {
      setForm(automationToForm(existingAutomation));
      setConflicts([]);
      setHydrated(true);
    }
  }, [existingAutomation, hydrated, isEdit]);

  useEffect(() => {
    if (!isEdit && preset && !hydrated) {
      setForm({
        name: preset.name,
        description: preset.description,
        vehicle_id: null,
        enabled: true,
        triggers: preset.triggers.map((trigger) => (
          normalizeTriggerInput(trigger as AutomationTriggerStepInput)
        )),
        conditions: (preset.conditions ?? []).map((condition) => (
          normalizeConditionInput(condition as AutomationConditionStepInput)
        )),
        actions: preset.actions.map((action) => (
          normalizeActionInput(action as AutomationActionStepInput)
        )),
      });
      setHydrated(true);
    }
  }, [hydrated, isEdit, preset]);

  useEffect(() => {
    setHydrated(false);
  }, [automationId, presetId]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

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

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  }, []);

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

  const isSaving = createMutation.isPending || updateMutation.isPending;

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
      navigate('/automations');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [automationId, createMutation, form, isEdit, navigate, updateMutation, validate]);

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
        breadcrumbs={breadcrumbs}
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
        breadcrumbs={breadcrumbs}
      >
        <div />
      </PageContainer>
    );
  }

  if (isEdit && !existingAutomation && !isLoadingAutomation) {
    return (
      <PageContainer
        title={t('automations.builder.editTitle', 'Edit Automation')}
        breadcrumbs={breadcrumbs}
      >
        <EmptyState
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
      breadcrumbs={breadcrumbs}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
        className="max-w-4xl space-y-6"
      >
        <Link
          to="/automations"
          className="inline-flex items-center gap-1 text-sm text-white/50 transition-colors hover:text-white/80"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('automations.builder.backToList', 'Back to Automations')}
        </Link>

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
          </FormSection>
        </FadeIn>

        <FadeIn delay={0.05}>
          <FormSection
            title={t('automations.builder.when', 'When (Trigger)')}
            description={t(
              'automations.builder.whenDesc',
              'Choose the supported typed contract that starts this automation.',
            )}
          >
            <UiSelect
              label={t('automations.builder.triggerType', 'Trigger Type')}
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
                <EmptyState
                  message={t(
                    'automations.builder.emptyTrigger',
                    'Select a supported trigger type to configure when this automation starts.',
                  )}
                />
              </GlassPanel>
            )}
          </FormSection>
        </FadeIn>

        <FadeIn delay={0.1}>
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
        </FadeIn>

        <FadeIn delay={0.15}>
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
        </FadeIn>

        {conflicts.length > 0 && (
          <FadeIn delay={0.2}>
            <ConflictWarnings conflicts={conflicts} />
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

        <FadeIn delay={0.25}>
          <div className="flex flex-wrap items-center gap-3">
            <UiButton type="submit" loading={isSaving} disabled={isSaving}>
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
                disabled={testRunMutation.isPending}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {t('automations.builder.testRun', 'Test Run')}
              </UiButton>
            )}
            <UiButton
              type="button"
              variant="ghost"
              onClick={() => navigate('/automations')}
            >
              <X className="mr-2 h-4 w-4" />
              {t('automations.builder.cancel', 'Cancel')}
            </UiButton>

            {testRunMutation.isSuccess && (
              <span className="text-sm text-green-400">
                <Zap className="mr-1 inline h-4 w-4" />
                {t('automations.builder.testRunStarted', 'Test run started!')}
              </span>
            )}
          </div>
        </FadeIn>

        {!isEdit && (
          <FadeIn delay={0.3}>
            <GlassPanel className="p-4 text-center">
              <p className="text-sm text-white/50">
                {t(
                  'automations.builder.presetHint',
                   'Not sure where to start? Browse typed automation templates.',
                )}
              </p>
            </GlassPanel>
          </FadeIn>
        )}
      </form>
    </PageContainer>
  );
}

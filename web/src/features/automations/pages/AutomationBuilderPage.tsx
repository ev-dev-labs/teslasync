/**
 * AutomationBuilderPage — create/edit form for automations.
 *
 * Routes:
 *   /automations/new        — create mode
 *   /automations/:id/edit   — edit mode (fetches existing automation)
 *
 * Sections: Name/Vehicle → Trigger → Conditions → Actions → Options → Conflicts → Save
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import {
  GlassPanel,
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  Toggle,
  Textarea as UiTextarea,
} from '@/components/ui';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { FormSection } from '@/components/forms/FormSection';
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
  type AutomationStepInput,
} from '@/api/hooks/useAutomations';
import { TriggerConfigurator, TRIGGER_TYPES } from './TriggerConfigurator';
import { ConditionBuilder } from './ConditionBuilder';
import { ActionBuilder } from './ActionBuilder';
import { ConflictWarnings } from './ConflictWarnings';
import {
  Save, PlayCircle, X, Zap, ArrowLeft, AlertTriangle, Bell,
} from 'lucide-react';
import type { AutomationFull, AutomationConflict } from '@/api/types';
import type { AutomationStep } from '@/types/automations';

// ─── Initial form state ───────────────────────────────────────────────────────

interface FormState {
  name: string;
  description: string;
  vehicle_id: number | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  cooldown_minutes: number;
  max_executions_hour: number;
  stop_on_failure: boolean;
  notify_on_run: boolean;
  notify_on_failure: boolean;
  notify_channels: number[];
  priority: number;
  tags: string[];
  preset_id: string | null;
}

function getInitialForm(): FormState {
  return {
    name: '',
    description: '',
    vehicle_id: null,
    trigger_type: '',
    trigger_config: {},
    conditions: [],
    actions: [{ type: 'command', command: 'climate_on', params: {} }],
    cooldown_minutes: 0,
    max_executions_hour: 0,
    stop_on_failure: false,
    notify_on_run: true,
    notify_on_failure: true,
    notify_channels: [],
    priority: 50,
    tags: [],
    preset_id: null,
  };
}

function automationToForm(a: AutomationFull): FormState {
  // AutomationFull is the new CTI-backed shape: it carries `triggers`, `conditions`,
  // and `actions` as typed `AutomationStep[]` discriminated unions (no more jsonb
  // blobs). Legacy fields (trigger_type/trigger_config, cooldown, priority, etc.)
  // no longer travel with the entity, so we reconstruct the builder's internal
  // Record-shaped view from the typed steps and seed omitted scalars with defaults.
  const trigger = a.triggers[0];
  const { triggerType, triggerConfig } = triggerStepToLegacy(trigger);
  return {
    name: a.name,
    description: a.description ?? '',
    vehicle_id: a.vehicle_id,
    trigger_type: triggerType,
    trigger_config: triggerConfig,
    conditions: a.conditions.map(conditionStepToRecord),
    actions: a.actions.map(actionStepToRecord),
    cooldown_minutes: 0,
    max_executions_hour: 0,
    stop_on_failure: false,
    notify_on_run: true,
    notify_on_failure: true,
    notify_channels: [],
    priority: 50,
    tags: [],
    preset_id: null,
  };
}

// ─── Step ↔ Record mappers ────────────────────────────────────────────────────
// The sub-components (TriggerConfigurator, ConditionBuilder, ActionBuilder)
// still operate on loose Record<string, unknown> entries. These helpers bridge
// those Records to the backend's typed AutomationStep discriminated union.

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function triggerStepToLegacy(step: AutomationStep | undefined): {
  triggerType: string;
  triggerConfig: Record<string, unknown>;
} {
  if (!step) return { triggerType: '', triggerConfig: {} };
  switch (step.kind) {
    case 'trigger_time':
      return {
        triggerType: 'cron',
        triggerConfig: { cron_expression: step.cron_expr, timezone: step.timezone },
      };
    case 'trigger_geofence':
      return {
        triggerType: 'geofence',
        triggerConfig: { geofence_id: step.geofence_id, event: step.direction },
      };
    case 'trigger_webhook':
      return {
        triggerType: 'webhook',
        triggerConfig: {
          webhook_token: step.webhook_token,
          require_signature: step.require_signature,
        },
      };
    case 'trigger_signal':
      return {
        triggerType: 'vehicle_state',
        triggerConfig: {
          signal_name: step.signal_name,
          operator: step.operator,
          threshold_numeric: step.threshold_numeric,
          threshold_text: step.threshold_text,
          threshold_bool: step.threshold_bool,
        },
      };
    default:
      return { triggerType: '', triggerConfig: {} };
  }
}

function conditionStepToRecord(step: AutomationStep): Record<string, unknown> {
  switch (step.kind) {
    case 'condition_signal':
      return {
        type: 'state_check',
        signal: step.signal_name,
        operator: step.operator,
        value:
          step.compare_numeric ?? step.compare_text ?? step.compare_bool ?? null,
      };
    case 'condition_time_window':
      return {
        type: 'time_window',
        start_time: step.start_time,
        end_time: step.end_time,
        timezone: step.timezone,
      };
    case 'condition_day_of_week':
      return {
        type: 'day_filter',
        days_of_week: step.days_of_week,
        timezone: step.timezone,
      };
    case 'condition_geofence':
      return {
        type: 'location',
        geofence_id: step.geofence_id,
        must_be_inside: step.must_be_inside,
      };
    default:
      return { type: step.kind };
  }
}

function actionStepToRecord(step: AutomationStep): Record<string, unknown> {
  switch (step.kind) {
    case 'action_vehicle_command':
      return {
        type: 'command',
        command: step.command,
        params: step.command_params,
      };
    case 'action_notification':
      return {
        type: 'notify',
        channel_id: step.channel_id,
        template: step.template,
      };
    case 'action_set_state':
      return {
        type: 'set_variable',
        state_key: step.state_key,
        state_value: step.state_value,
      };
    default:
      return { type: step.kind };
  }
}

function recordToTriggerStep(
  triggerType: string,
  config: Record<string, unknown>,
  position: number,
): AutomationStepInput | null {
  switch (triggerType) {
    case 'cron':
      return {
        kind: 'trigger_time',
        lane: 'trigger',
        position,
        cron_expr: str(config.cron_expression),
        timezone: str(config.timezone),
      };
    case 'geofence':
      return {
        kind: 'trigger_geofence',
        lane: 'trigger',
        position,
        geofence_id: num(config.geofence_id),
        direction: (str(config.event, 'either') as 'enter' | 'exit' | 'either'),
      };
    case 'webhook':
      return {
        kind: 'trigger_webhook',
        lane: 'trigger',
        position,
        webhook_token: str(config.webhook_token),
        require_signature: bool(config.require_signature),
      };
    case 'vehicle_state':
    case 'battery':
    case 'mqtt':
    case 'sunrise_sunset':
    case 'energy':
    case 'calendar':
      return {
        kind: 'trigger_signal',
        lane: 'trigger',
        position,
        signal_name: str(config.signal_name, triggerType),
        operator: '==',
        threshold_numeric:
          typeof config.threshold_numeric === 'number'
            ? config.threshold_numeric
            : null,
        threshold_text:
          typeof config.threshold_text === 'string' ? config.threshold_text : null,
        threshold_bool:
          typeof config.threshold_bool === 'boolean'
            ? config.threshold_bool
            : null,
      };
    default:
      return null;
  }
}

function recordToConditionStep(
  cond: Record<string, unknown>,
  position: number,
): AutomationStepInput | null {
  const condType = str(cond.type);
  switch (condType) {
    case 'state_check': {
      const raw = cond.value;
      return {
        kind: 'condition_signal',
        lane: 'condition',
        position,
        signal_name: str(cond.signal),
        operator: (str(cond.operator, '==') as '>' | '<' | '>=' | '<=' | '==' | '!='),
        compare_numeric: typeof raw === 'number' ? raw : null,
        compare_text: typeof raw === 'string' ? raw : null,
        compare_bool: typeof raw === 'boolean' ? raw : null,
      };
    }
    case 'time_window':
      return {
        kind: 'condition_time_window',
        lane: 'condition',
        position,
        start_time: str(cond.start_time),
        end_time: str(cond.end_time),
        timezone: str(cond.timezone),
      };
    case 'day_filter':
      return {
        kind: 'condition_day_of_week',
        lane: 'condition',
        position,
        days_of_week: Array.isArray(cond.days_of_week)
          ? (cond.days_of_week as unknown[]).filter(
              (d): d is number => typeof d === 'number',
            )
          : [],
        timezone: str(cond.timezone),
      };
    case 'location':
      return {
        kind: 'condition_geofence',
        lane: 'condition',
        position,
        geofence_id: num(cond.geofence_id),
        must_be_inside: bool(cond.must_be_inside, true),
      };
    default:
      return null;
  }
}

function recordToActionStep(
  action: Record<string, unknown>,
  position: number,
): AutomationStepInput | null {
  const actionType = str(action.type);
  switch (actionType) {
    case 'command':
      return {
        kind: 'action_vehicle_command',
        lane: 'action',
        position,
        command: str(action.command),
        command_params:
          action.params && typeof action.params === 'object'
            ? (action.params as Record<string, unknown>)
            : {},
      };
    case 'notify':
      return {
        kind: 'action_notification',
        lane: 'action',
        position,
        channel_id: num(action.channel_id),
        template: str(action.template),
      };
    case 'set_variable':
      return {
        kind: 'action_set_state',
        lane: 'action',
        position,
        state_key: str(action.state_key ?? action.variable),
        state_value: str(action.state_value ?? action.value),
      };
    default:
      return null;
  }
}

function formToPayload(form: FormState): AutomationFullInput {
  const triggerStep = form.trigger_type
    ? recordToTriggerStep(form.trigger_type, form.trigger_config, 0)
    : null;
  const triggers: AutomationStepInput[] = triggerStep ? [triggerStep] : [];
  const conditions: AutomationStepInput[] = form.conditions
    .map((c, i) => recordToConditionStep(c, i))
    .filter((s): s is AutomationStepInput => s !== null);
  const actions: AutomationStepInput[] = form.actions
    .map((a, i) => recordToActionStep(a, i))
    .filter((s): s is AutomationStepInput => s !== null);

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    vehicle_id: form.vehicle_id,
    enabled: true,
    triggers,
    conditions,
    actions,
  };
}

// ─── Vehicle selector options ─────────────────────────────────────────────────

const ALL_VEHICLES_OPTION = { value: '', label: 'All Vehicles' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function AutomationBuilderPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetId = searchParams.get('preset') ?? undefined;
  const isEdit = id != null;
  const automationId = id ? parseInt(id, 10) : undefined;

  usePageTitle(
    isEdit
      ? t('automations.builder.editTitle', 'Edit Automation')
      : presetId
        ? t('automations.builder.presetTitle', 'Install Preset')
        : t('automations.builder.createTitle', 'Create Automation'),
  );

  // ── Data queries ────────────────────────────────────────────────────
  const { data: existingAutomation, isLoading: isLoadingAutomation, error: loadError } =
    useAutomation(automationId);
  const { data: vehicles } = useVehicles();
  const { data: channels } = useNotificationChannels();
  const { data: preset } = useAutomationPreset(presetId);

  const breadcrumbs = useBreadcrumbs({
    '/automations/:id/edit': existingAutomation?.name
      ? `Edit: ${existingAutomation.name}`
      : undefined,
  });

  // ── Mutations ───────────────────────────────────────────────────────
  const createMutation = useCreateAutomationFull();
  const updateMutation = useUpdateAutomationFull();
  const testRunMutation = useTestRunAutomation();

  // ── Form state ──────────────────────────────────────────────────────
  const [form, setForm] = useState<FormState>(getInitialForm);
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflicts, setConflicts] = useState<AutomationConflict[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  // Hydrate form from existing automation in edit mode
  useEffect(() => {
    if (isEdit && existingAutomation && !hydrated) {
      setForm(automationToForm(existingAutomation));
      // AutomationFull no longer carries conflicts; conflict warnings now arrive
      // via a separate endpoint (outside scope of this prompt).
      setConflicts([]);
      setHydrated(true);
    }
  }, [isEdit, existingAutomation, hydrated]);

  // Hydrate form from preset in create mode
  useEffect(() => {
    if (!isEdit && preset && !hydrated) {
      setForm({
        name: preset.name,
        description: preset.description,
        vehicle_id: null,
        trigger_type: preset.trigger_type,
        trigger_config: preset.trigger_config ?? {},
        conditions: (preset.conditions as Record<string, unknown>[]) ?? [],
        actions: preset.actions ?? [],
        cooldown_minutes: preset.cooldown_minutes ?? 0,
        max_executions_hour: preset.max_executions_hour ?? 0,
        stop_on_failure: preset.stop_on_failure ?? false,
        notify_on_run: preset.notify_on_run ?? true,
        notify_on_failure: preset.notify_on_failure ?? true,
        notify_channels: [],
        priority: preset.priority ?? 50,
        tags: preset.tags ?? [],
        preset_id: preset.id,
      });
      setHydrated(true);
    }
  }, [isEdit, preset, hydrated]);

  // Reset hydration when switching automations
  useEffect(() => {
    setHydrated(false);
  }, [automationId]);

  // Auto-select all enabled channels when channels load (only for new automations)
  useEffect(() => {
    if (!isEdit && channels && channels.length > 0 && form.notify_channels.length === 0 && !dirty) {
      const enabledIds = channels.filter(c => c.enabled).map(c => c.id);
      if (enabledIds.length > 0) {
        setForm(prev => ({ ...prev, notify_channels: enabledIds }));
      }
    }
  }, [channels, isEdit, form.notify_channels.length, dirty]);

  // Dirty-state guard
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── Vehicle options ─────────────────────────────────────────────────
  const vehicleOptions = useMemo(() => {
    const opts = (vehicles ?? []).map((v) => ({
      value: String(v.id),
      label: v.display_name || `Vehicle ${v.id}`,
    }));
    return [ALL_VEHICLES_OPTION, ...opts];
  }, [vehicles]);

  // ── Trigger type options ────────────────────────────────────────────
  const triggerOptions = useMemo(
    () => [
      { value: '', label: t('automations.builder.selectTrigger', 'Select trigger type...') },
      ...TRIGGER_TYPES.map((tt) => ({ value: tt.value, label: tt.label })),
    ],
    [t],
  );

  // ── Update helpers ──────────────────────────────────────────────────
  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleTriggerTypeChange = useCallback(
    (newType: string) => {
      if (newType !== form.trigger_type) {
        setForm((prev) => ({
          ...prev,
          trigger_type: newType,
          trigger_config: newType === 'webhook' ? { webhook_token: crypto.randomUUID() } : {},
        }));
        setDirty(true);
      }
    },
    [form.trigger_type],
  );

  // ── Submission ──────────────────────────────────────────────────────
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const validate = useCallback((): string | null => {
    if (!form.name.trim()) return t('automations.builder.errorName', 'Name is required');
    if (!form.trigger_type) return t('automations.builder.errorTrigger', 'Trigger type is required');
    if (form.actions.length === 0) return t('automations.builder.errorActions', 'At least one action is required');
    return null;
  }, [form, t]);

  const handleSave = useCallback(async () => {
    const error = validate();
    if (error) {
      setSaveError(error);
      return;
    }
    setSaveError(null);
    const payload = formToPayload(form);

    try {
      let result: AutomationFull;
      if (isEdit && automationId) {
        result = await updateMutation.mutateAsync({ id: automationId, input: payload });
      } else {
        result = await createMutation.mutateAsync(payload);
      }
      setDirty(false);
      setSavedId(result.id);
      // Conflict detection has moved out of the create/update response shape.
      setConflicts([]);
      navigate('/automations');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
    }
  }, [form, isEdit, automationId, validate, createMutation, updateMutation, navigate]);

  const handleTestRun = useCallback(() => {
    const targetId = savedId ?? automationId;
    if (targetId) {
      testRunMutation.mutate(targetId);
    }
  }, [savedId, automationId, testRunMutation]);

  // ── Loading / error states ──────────────────────────────────────────
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
      <PageContainer title={t('automations.builder.editTitle', 'Edit Automation')} breadcrumbs={breadcrumbs}>
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          message={t('automations.builder.notFound', 'Automation not found')}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={
        isEdit
          ? t('automations.builder.editTitle', 'Edit Automation')
          : t('automations.builder.createTitle', 'Create Automation')
      }
      subtitle={t(
        'automations.builder.subtitle',
        'Configure trigger, conditions, and actions for your automation.',
      )}
      breadcrumbs={breadcrumbs}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="space-y-6 max-w-4xl"
      >
        {/* ── Back link ──────────────────────────────────────────────── */}
        <Link
          to="/automations"
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('automations.builder.backToList', 'Back to Automations')}
        </Link>

        {/* ── General info ───────────────────────────────────────────── */}
        <FadeIn>
          <FormSection title={t('automations.builder.general', 'General')}>
            <UiInput
              label={t('automations.builder.name', 'Name')}
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder={t('automations.builder.namePlaceholder', 'Morning Commute Prep')}
              required
            />
            <UiTextarea
              label={t('automations.builder.description', 'Description')}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
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
              onChange={(e) => update('vehicle_id', e.target.value ? Number(e.target.value) : null)}
            />
          </FormSection>
        </FadeIn>

        {/* ── Trigger (WHEN) ─────────────────────────────────────────── */}
        <FadeIn delay={0.05}>
          <FormSection
            title={t('automations.builder.when', 'When (Trigger)')}
            description={t(
              'automations.builder.whenDesc',
              'Choose what starts this automation.',
            )}
          >
            <UiSelect
              label={t('automations.builder.triggerType', 'Trigger Type')}
              options={triggerOptions}
              value={form.trigger_type}
              onChange={(e) => handleTriggerTypeChange(e.target.value)}
            />
            {form.trigger_type && (
              <GlassPanel className="p-4 mt-3">
                <TriggerConfigurator
                  triggerType={form.trigger_type}
                  config={form.trigger_config}
                  onChange={(config) => update('trigger_config', config)}
                />
              </GlassPanel>
            )}
          </FormSection>
        </FadeIn>

        {/* ── Conditions (ONLY IF) ───────────────────────────────────── */}
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

        {/* ── Actions (THEN) ─────────────────────────────────────────── */}
        <FadeIn delay={0.15}>
          <FormSection
            title={t('automations.builder.then', 'Then (Actions)')}
            description={t(
              'automations.builder.thenDesc',
              'Actions are executed in order. Add commands, waits, and notifications.',
            )}
          >
            <ActionBuilder
              actions={form.actions}
              onChange={(actions) => update('actions', actions)}
            />
          </FormSection>
        </FadeIn>

        {/* ── Options ────────────────────────────────────────────────── */}
        <FadeIn delay={0.2}>
          <FormSection
            title={t('automations.builder.options', 'Options')}
            description={t(
              'automations.builder.optionsDesc',
              'Fine-tune how this automation behaves.',
            )}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Toggle
                label={t('automations.builder.notifyOnRun', 'Notify on each run')}
                checked={form.notify_on_run}
                onChange={(v) => update('notify_on_run', v)}
              />
              <Toggle
                label={t('automations.builder.notifyOnFailure', 'Notify on failure')}
                checked={form.notify_on_failure}
                onChange={(v) => update('notify_on_failure', v)}
              />
              <Toggle
                label={t('automations.builder.stopOnFailure', 'Stop on first failure')}
                checked={form.stop_on_failure}
                onChange={(v) => update('stop_on_failure', v)}
              />
            </div>

            {/* Notification channels selector */}
            {(form.notify_on_run || form.notify_on_failure) && (
              <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-cyan-400" />
                    <span className="text-sm font-medium text-white/80">
                      {t('automations.builder.notifyChannels', 'Notification Channels')}
                    </span>
                  </div>
                  {(channels ?? []).length > 0 && (
                    <UiButton
                      type="button"
                      variant="ghost"
                      className="!h-auto !px-0 !py-0 text-xs text-cyan-400 hover:!bg-transparent hover:text-cyan-300"
                      onClick={() => {
                        const allIds = (channels ?? []).filter(c => c.enabled).map(c => c.id);
                        const allSelected = allIds.every(id => form.notify_channels.includes(id));
                        update('notify_channels', allSelected ? [] : allIds);
                      }}
                    >
                      {(channels ?? []).filter(c => c.enabled).every(c => form.notify_channels.includes(c.id))
                        ? t('automations.builder.deselectAll', 'Deselect all')
                        : t('automations.builder.selectAll', 'Select all')}
                    </UiButton>
                  )}
                </div>
                {(channels ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {(channels ?? []).map((ch) => {
                      const selected = form.notify_channels.includes(ch.id);
                      return (
                        <UiButton
                          key={ch.id}
                          type="button"
                          variant="ghost"
                          disabled={!ch.enabled}
                          aria-pressed={selected}
                          onClick={() => {
                            const next = selected
                              ? form.notify_channels.filter(id => id !== ch.id)
                              : [...form.notify_channels, ch.id];
                            update('notify_channels', next);
                          }}
                          className={`!h-auto gap-1.5 !rounded-full border !px-3 !py-1.5 text-xs font-medium ${
                            !ch.enabled
                              ? 'border-white/[0.04] !bg-white/[0.02] text-white/30 cursor-not-allowed'
                              : selected
                                ? 'border-cyan-500/40 !bg-cyan-500/10 text-cyan-300 shadow-[0_0_8px_rgba(0,200,255,0.1)]'
                                : 'border-white/[0.08] !bg-white/[0.03] text-white/50 hover:border-white/[0.15] hover:text-white/70 hover:!bg-white/[0.03]'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            !ch.enabled ? 'bg-white/20' : selected ? 'bg-cyan-400' : 'bg-white/30'
                          }`} />
                          {ch.name ?? ch.kind}
                          <span className="text-[10px] text-white/30 ml-0.5">({ch.kind})</span>
                        </UiButton>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-white/40">
                    {t('automations.builder.noChannels', 'No notification channels configured. Go to Notifications to set up channels.')}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <UiInput
                label={t('automations.builder.cooldown', 'Cooldown (minutes)')}
                type="number"
                min={0}
                max={1440}
                value={form.cooldown_minutes}
                onChange={(e) => update('cooldown_minutes', parseInt(e.target.value, 10) || 0)}
                hint={t('automations.builder.cooldownHint', '0 = no cooldown')}
              />
              <UiInput
                label={t('automations.builder.maxExec', 'Max Executions / Hour')}
                type="number"
                min={0}
                max={100}
                value={form.max_executions_hour}
                onChange={(e) => update('max_executions_hour', parseInt(e.target.value, 10) || 0)}
                hint={t('automations.builder.maxExecHint', '0 = unlimited')}
              />
              <UiInput
                label={t('automations.builder.priority', 'Priority')}
                type="number"
                min={0}
                max={100}
                value={form.priority}
                onChange={(e) => update('priority', parseInt(e.target.value, 10) || 50)}
                hint={t('automations.builder.priorityHint', 'Higher = runs first (0-100)')}
              />
            </div>
          </FormSection>
        </FadeIn>

        {/* ── Conflict warnings ──────────────────────────────────────── */}
        {conflicts.length > 0 && (
          <FadeIn delay={0.25}>
            <ConflictWarnings conflicts={conflicts} />
          </FadeIn>
        )}

        {/* ── Save error ─────────────────────────────────────────────── */}
        {saveError && (
          <AlertBanner
            variant="danger"
            icon={<AlertTriangle className="h-4 w-4" />}
            title={t('automations.builder.saveError', 'Save Error')}
          >
            {saveError}
          </AlertBanner>
        )}

        {/* ── Action buttons ─────────────────────────────────────────── */}
        <FadeIn delay={0.3}>
          <div className="flex gap-3 items-center flex-wrap">
            <UiButton type="submit" loading={isSaving} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
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
                <PlayCircle className="h-4 w-4 mr-2" />
                {t('automations.builder.testRun', 'Test Run')}
              </UiButton>
            )}
            <UiButton
              type="button"
              variant="ghost"
              onClick={() => navigate('/automations')}
            >
              <X className="h-4 w-4 mr-2" />
              {t('automations.builder.cancel', 'Cancel')}
            </UiButton>

            {testRunMutation.isSuccess && (
              <span className="text-sm text-green-400">
                <Zap className="h-4 w-4 inline mr-1" />
                {t('automations.builder.testRunStarted', 'Test run started!')}
              </span>
            )}
          </div>
        </FadeIn>

        {/* ── Preset link ────────────────────────────────────────────── */}
        {!isEdit && (
          <FadeIn delay={0.35}>
            <GlassPanel className="p-4 text-center">
              <p className="text-sm text-white/50">
                {t(
                  'automations.builder.presetHint',
                  'Not sure where to start? Browse pre-built automation templates.',
                )}
              </p>
            </GlassPanel>
          </FadeIn>
        )}
      </form>
    </PageContainer>
  );
}

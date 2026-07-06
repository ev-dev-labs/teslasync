/**
 * AutomationBuilderPage — unit + behaviour coverage.
 *
 * Two layers:
 *   1. Pure model helpers (getInitialForm / normalize* / automationToForm /
 *      formToPayload / *NeedsPlace / actionIsIncomplete) exercised directly —
 *      deterministic branch coverage of every discriminated-union arm.
 *   2. The page component itself, mounted with the shared providers and with
 *      the heavy builder / AI children stubbed, so we can assert the create
 *      flow, validation gate, readiness derive, edit-mode states, and the
 *      AI-draft apply path without touching the network.
 *
 * The `TriggerConfigurator` mock keeps the real `TRIGGER_TYPES` +
 * `createDefaultTrigger` exports (the page imports them) and only swaps the
 * rendered component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '../../../i18n';
import { ToastProvider } from '@/components/feedback/Toast';
import { __resetEditLeasesForTests } from '@/hooks/useEditLease';
import type {
  AutomationActionStep,
  AutomationConditionStep,
  AutomationFull,
  AutomationTriggerStep,
} from '@/api/types';

// ── Shared, hoisted mock state (created before any vi.mock factory runs). ──
const H = vi.hoisted(() => ({
  automationState: { data: undefined, isLoading: false, error: null } as {
    data: unknown;
    isLoading: boolean;
    error: unknown;
  },
  presetState: { data: undefined } as { data: unknown },
  vehicles: [] as unknown[],
  createMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
  testRunMutate: vi.fn(),
}));

// framer-motion — collapse animations to plain divs (matches the repo's
// established page-test convention).
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const { children, ...rest } = props as { children?: React.ReactNode };
        return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
  useInView: () => true,
}));

// Heavy builder children — stubbed so the page's own orchestration is under
// test (not the leaf editors, which have their own suites). Keep TRIGGER_TYPES
// + createDefaultTrigger real via importActual.
vi.mock('./TriggerConfigurator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./TriggerConfigurator')>();
  return {
    ...actual,
    TriggerConfigurator: ({ trigger }: { trigger: { kind?: string } | null }) => (
      <div data-testid="trigger-configurator">tc:{trigger?.kind ?? 'none'}</div>
    ),
  };
});

vi.mock('./ConditionBuilder', () => ({
  ConditionBuilder: ({
    conditions,
    onChange,
  }: {
    conditions: unknown[];
    onChange: (next: unknown[]) => void;
  }) => (
    <div data-testid="condition-builder">
      <span>conditions:{conditions.length}</span>
      <button
        type="button"
        onClick={() =>
          onChange([...conditions, { kind: 'condition_geofence', place_id: 7, state: 'inside' }])
        }
      >
        add-condition
      </button>
    </div>
  ),
}));

vi.mock('./ActionBuilder', () => ({
  ActionBuilder: ({
    actions,
    onChange,
  }: {
    actions: unknown[];
    onChange: (next: unknown[]) => void;
  }) => (
    <div data-testid="action-builder">
      <span>actions:{actions.length}</span>
      <button
        type="button"
        onClick={() =>
          onChange([...actions, { kind: 'action_command', command_name: 'flash_lights' }])
        }
      >
        add-action
      </button>
    </div>
  ),
}));

vi.mock('./ConflictWarnings', () => ({
  ConflictWarnings: ({ conflicts }: { conflicts: unknown[] }) => (
    <div data-testid="conflict-warnings">conflicts:{conflicts.length}</div>
  ),
}));

// AI surfaces — the NL builder is inert; the geofence-aware panel exposes a
// button that fires onApplyDraft with a fixed typed draft so we can assert the
// page copies it into form state.
vi.mock('@/components/ai/AINLAutomationBuilder', () => ({
  AINLAutomationBuilder: () => <div data-testid="ai-nl-builder" />,
}));

vi.mock('@/components/ai/AIGeofenceAwareAutomationSuggestions', () => ({
  AIGeofenceAwareAutomationSuggestions: ({
    onApplyDraft,
  }: {
    onApplyDraft: (draft: unknown) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onApplyDraft({
          name: 'AI Drafted',
          description: 'from ai',
          vehicle_id: null,
          enabled: true,
          triggers: [{ kind: 'trigger_event', event_type: 'online' }],
          conditions: [
            { kind: 'condition_geofence', place_id: 3, state: 'inside' },
            { kind: 'condition_geofence', place_id: 4, state: 'outside' },
          ],
          actions: [
            { kind: 'action_command', command_name: 'honk_horn' },
            { kind: 'action_command', command_name: 'flash_lights' },
          ],
        })
      }
    >
      apply-ai-draft
    </button>
  ),
}));

// API hooks — spread the real modules (preserve keys/types) and override the
// hooks the page consumes with controllable stubs backed by hoisted state.
vi.mock('@/api/hooks/useAutomations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAutomations')>();
  return {
    ...actual,
    useAutomation: () => H.automationState,
    useAutomationPreset: () => H.presetState,
    useCreateAutomationFull: () => ({ mutateAsync: H.createMutateAsync, isPending: false }),
    useUpdateAutomationFull: () => ({ mutateAsync: H.updateMutateAsync, isPending: false }),
    useTestRunAutomation: () => ({ mutate: H.testRunMutate, isPending: false, isSuccess: false }),
  };
});

vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: () => ({ data: H.vehicles }) };
});

vi.mock('@/api/hooks/useNotifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useNotifications')>();
  return {
    ...actual,
    useNotificationChannels: () => ({ data: [], isLoading: false, error: null }),
  };
});

import AutomationBuilderPage, {
  getInitialForm,
  normalizeTriggerInput,
  normalizeConditionInput,
  normalizeActionInput,
  automationToForm,
  formToPayload,
  applyDraftToForm,
  triggerNeedsPlace,
  conditionNeedsPlace,
  actionIsIncomplete,
} from './AutomationBuilderPage';

function renderPage(entry = '/automations/new') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <ToastProvider>
          <Routes>
            <Route path="/automations" element={<div>AUTOMATIONS_LIST</div>} />
            <Route path="/automations/new" element={<AutomationBuilderPage />} />
            <Route path="/automations/:id/edit" element={<AutomationBuilderPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const EDIT_AUTOMATION: AutomationFull = {
  id: 5,
  name: 'Existing One',
  description: 'desc',
  enabled: true,
  vehicle_id: null,
  created_at: '',
  updated_at: '',
  triggers: [{ kind: 'trigger_event', event_type: 'online' }],
  conditions: [],
  actions: [{ kind: 'action_command', command_name: 'climate_on' }],
};

beforeEach(() => {
  H.createMutateAsync.mockReset();
  H.updateMutateAsync.mockReset();
  H.testRunMutate.mockReset();
  H.automationState = { data: undefined, isLoading: false, error: null };
  H.presetState = { data: undefined };
  H.vehicles = [];
  window.localStorage.clear();
  __resetEditLeasesForTests();
});

// ───────────────────────────── Pure helpers ─────────────────────────────

describe('AutomationBuilderPage — pure model helpers', () => {
  it('getInitialForm returns a fresh default form each call', () => {
    const a = getInitialForm();
    const b = getInitialForm();
    expect(a).toEqual({
      name: '',
      description: '',
      vehicle_id: null,
      enabled: true,
      triggers: [],
      conditions: [],
      actions: [{ kind: 'action_command', command_name: 'climate_on' }],
    });
    expect(a).not.toBe(b);
    expect(a.actions).not.toBe(b.actions);
  });

  it('normalizeTriggerInput narrows every trigger kind and strips server-only fields', () => {
    expect(
      normalizeTriggerInput({ kind: 'trigger_schedule', cron_expr: '0 8 * * *', timezone: 'UTC' }),
    ).toEqual({ kind: 'trigger_schedule', cron_expr: '0 8 * * *', timezone: 'UTC' });

    expect(normalizeTriggerInput({ kind: 'trigger_event', event_type: 'online' })).toEqual({
      kind: 'trigger_event',
      event_type: 'online',
    });

    // dwell_minutes is copied only when present.
    expect(
      normalizeTriggerInput({ kind: 'trigger_geofence', place_id: 2, event: 'enter' }),
    ).toEqual({ kind: 'trigger_geofence', place_id: 2, event: 'enter' });
    expect(
      normalizeTriggerInput({
        kind: 'trigger_geofence',
        place_id: 2,
        event: 'dwell',
        dwell_minutes: 10,
      }),
    ).toEqual({ kind: 'trigger_geofence', place_id: 2, event: 'dwell', dwell_minutes: 10 });

    // Server-only id fields on a full step are dropped.
    const withServerIds: AutomationTriggerStep = {
      id: 99,
      automation_id: 3,
      step_order: 1,
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: '<',
      value_num: 20,
    };
    const normalized = normalizeTriggerInput(withServerIds);
    expect(normalized).toEqual({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: '<',
      value_num: 20,
    });
    expect('id' in normalized).toBe(false);
    expect('automation_id' in normalized).toBe(false);
  });

  it('normalizeConditionInput handles all arms and copies days_of_week into a new array', () => {
    const days = [1, 2, 3];
    const window = normalizeConditionInput({
      kind: 'condition_time_window',
      start_time: '08:00',
      end_time: '09:00',
      timezone: 'UTC',
      days_of_week: days,
    });
    expect(window).toEqual({
      kind: 'condition_time_window',
      start_time: '08:00',
      end_time: '09:00',
      timezone: 'UTC',
      days_of_week: [1, 2, 3],
    });
    // must be a defensive copy, not the same reference
    expect((window as { days_of_week: number[] }).days_of_week).not.toBe(days);

    expect(
      normalizeConditionInput({
        kind: 'condition_signal',
        signal: 'inside_temp',
        op: 'between',
        value_min: 10,
        value_max: 20,
      }),
    ).toEqual({
      kind: 'condition_signal',
      signal: 'inside_temp',
      op: 'between',
      value_min: 10,
      value_max: 20,
    });

    expect(
      normalizeConditionInput({ kind: 'condition_geofence', place_id: 4, state: 'inside' }),
    ).toEqual({ kind: 'condition_geofence', place_id: 4, state: 'inside' });

    expect(
      normalizeConditionInput({
        kind: 'condition_other_automation',
        other_automation_id: 7,
        state: 'enabled',
      }),
    ).toEqual({ kind: 'condition_other_automation', other_automation_id: 7, state: 'enabled' });
  });

  it('normalizeActionInput handles all arms and copies optional value fields', () => {
    expect(
      normalizeActionInput({ kind: 'action_command', command_name: 'climate_on' }),
    ).toEqual({ kind: 'action_command', command_name: 'climate_on' });
    expect(
      normalizeActionInput({
        kind: 'action_command',
        command_name: 'set_temp',
        command_params: { temp: 21 },
      }),
    ).toEqual({ kind: 'action_command', command_name: 'set_temp', command_params: { temp: 21 } });

    expect(
      normalizeActionInput({ kind: 'action_notify', channel_id: 2, template: 'Hi' }),
    ).toEqual({ kind: 'action_notify', channel_id: 2, template: 'Hi' });

    expect(
      normalizeActionInput({ kind: 'action_set_setting', setting_key: 'k', value_bool: false }),
    ).toEqual({ kind: 'action_set_setting', setting_key: 'k', value_bool: false });

    expect(
      normalizeActionInput({ kind: 'action_call_automation', target_automation_id: 9 }),
    ).toEqual({ kind: 'action_call_automation', target_automation_id: 9 });
  });

  it('automationToForm maps a full automation and defaults a null description', () => {
    const form = automationToForm({
      ...EDIT_AUTOMATION,
      description: null,
    });
    expect(form.name).toBe('Existing One');
    expect(form.description).toBe('');
    expect(form.enabled).toBe(true);
    expect(form.triggers).toEqual([{ kind: 'trigger_event', event_type: 'online' }]);
    expect(form.actions).toEqual([{ kind: 'action_command', command_name: 'climate_on' }]);
  });

  it('automationToForm is null-safe when the API omits step arrays (regression)', () => {
    // A backend that serialises empty relations as JSON null must not crash
    // the editor. Before hardening this threw "Cannot read properties of null".
    const form = automationToForm({
      ...EDIT_AUTOMATION,
      triggers: null as unknown as AutomationTriggerStep[],
      conditions: null as unknown as AutomationConditionStep[],
      actions: null as unknown as AutomationActionStep[],
    });
    expect(form.triggers).toEqual([]);
    expect(form.conditions).toEqual([]);
    expect(form.actions).toEqual([]);
  });

  it('formToPayload trims name/description and normalizes every lane', () => {
    const payload = formToPayload({
      ...getInitialForm(),
      name: '  Morning Prep  ',
      description: '  warm the car  ',
      triggers: [{ kind: 'trigger_event', event_type: 'online' }],
    });
    expect(payload.name).toBe('Morning Prep');
    expect(payload.description).toBe('warm the car');
    expect(payload.triggers).toEqual([{ kind: 'trigger_event', event_type: 'online' }]);
    expect(payload.actions).toEqual([{ kind: 'action_command', command_name: 'climate_on' }]);
  });

  it('triggerNeedsPlace / conditionNeedsPlace flag only unset geofences', () => {
    expect(triggerNeedsPlace({ kind: 'trigger_geofence', place_id: 0, event: 'enter' })).toBe(true);
    expect(triggerNeedsPlace({ kind: 'trigger_geofence', place_id: 5, event: 'enter' })).toBe(false);
    expect(triggerNeedsPlace({ kind: 'trigger_event', event_type: 'online' })).toBe(false);

    expect(conditionNeedsPlace({ kind: 'condition_geofence', place_id: 0, state: 'inside' })).toBe(
      true,
    );
    expect(conditionNeedsPlace({ kind: 'condition_geofence', place_id: 8, state: 'inside' })).toBe(
      false,
    );
    expect(
      conditionNeedsPlace({ kind: 'condition_other_automation', other_automation_id: 1, state: 'enabled' }),
    ).toBe(false);
  });

  it('actionIsIncomplete validates required fields per action kind', () => {
    // command
    expect(actionIsIncomplete({ kind: 'action_command', command_name: '' })).toBe(true);
    expect(actionIsIncomplete({ kind: 'action_command', command_name: 'climate_on' })).toBe(false);
    // notify
    expect(actionIsIncomplete({ kind: 'action_notify', channel_id: 0, template: 'x' })).toBe(true);
    expect(actionIsIncomplete({ kind: 'action_notify', channel_id: 3, template: '' })).toBe(true);
    expect(actionIsIncomplete({ kind: 'action_notify', channel_id: 3, template: 'x' })).toBe(false);
    // set_setting — exactly one value required
    expect(actionIsIncomplete({ kind: 'action_set_setting', setting_key: '' })).toBe(true);
    expect(actionIsIncomplete({ kind: 'action_set_setting', setting_key: 'k' })).toBe(true);
    expect(
      actionIsIncomplete({ kind: 'action_set_setting', setting_key: 'k', value_num: 1, value_text: 'a' }),
    ).toBe(true);
    expect(
      actionIsIncomplete({ kind: 'action_set_setting', setting_key: 'k', value_num: 80 }),
    ).toBe(false);
    // call_automation
    expect(actionIsIncomplete({ kind: 'action_call_automation', target_automation_id: 0 })).toBe(
      true,
    );
    expect(actionIsIncomplete({ kind: 'action_call_automation', target_automation_id: 4 })).toBe(
      false,
    );
  });
});

// ───────────────────────────── Create mode ─────────────────────────────

describe('AutomationBuilderPage — create mode', () => {
  it('renders the KPI band, form sections and a not-ready readiness badge', () => {
    renderPage('/automations/new');

    expect(screen.getByRole('heading', { name: 'Create Automation' })).toBeInTheDocument();
    // KPI band: trigger label defaults to "Not set", status starts Enabled.
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.getByText('conditions:0')).toBeInTheDocument();
    expect(screen.getByText('actions:1')).toBeInTheDocument();
    // Readiness starts incomplete (no name, no trigger).
    expect(screen.getByText('Not ready yet')).toBeInTheDocument();
    // Form controls are present and labelled.
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/trigger type/i)).toBeInTheDocument();
  });

  it('flips the readiness badge to "Ready to save" once name + trigger are set', () => {
    renderPage('/automations/new');
    expect(screen.getByText('Not ready yet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Commute Prep' } });
    fireEvent.change(screen.getByLabelText(/trigger type/i), {
      target: { value: 'trigger_signal' },
    });

    expect(screen.getByText('Ready to save')).toBeInTheDocument();
    expect(screen.queryByText('Not ready yet')).not.toBeInTheDocument();
    // The stubbed configurator reflects the newly created default trigger.
    expect(screen.getByText('tc:trigger_signal')).toBeInTheDocument();
  });

  it('blocks save and surfaces a validation error when the name is empty', async () => {
    const { container } = renderPage('/automations/new');
    const form = container.querySelector('form')!;

    fireEvent.submit(form);

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(H.createMutateAsync).not.toHaveBeenCalled();
  });

  it('creates the automation with a normalized payload and navigates to the list', async () => {
    H.createMutateAsync.mockResolvedValue({ id: 123 });
    const { container } = renderPage('/automations/new');

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My Automation' } });
    fireEvent.change(screen.getByLabelText(/trigger type/i), {
      target: { value: 'trigger_signal' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(H.createMutateAsync).toHaveBeenCalledTimes(1));
    const payload = H.createMutateAsync.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: 'My Automation',
      enabled: true,
      triggers: [{ kind: 'trigger_signal', signal: 'battery_level', op: '<', value_num: 20 }],
      actions: [{ kind: 'action_command', command_name: 'climate_on' }],
    });
    expect(await screen.findByText('AUTOMATIONS_LIST')).toBeInTheDocument();
  });

  it('toggling the Enabled switch updates its state and the status KPI', () => {
    renderPage('/automations/new');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('wires the condition and action builders back into form state', () => {
    renderPage('/automations/new');
    expect(screen.getByText('conditions:0')).toBeInTheDocument();
    expect(screen.getByText('actions:1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'add-condition' }));
    fireEvent.click(screen.getByRole('button', { name: 'add-action' }));

    expect(screen.getByText('conditions:1')).toBeInTheDocument();
    expect(screen.getByText('actions:2')).toBeInTheDocument();
  });

  it('normalizes an AI-proposed draft into the canonical form state', () => {
    const next = applyDraftToForm(getInitialForm(), {
      name: 'AI Drafted',
      description: 'from ai',
      vehicle_id: null,
      enabled: true,
      triggers: [{ kind: 'trigger_event', event_type: 'online' }],
      conditions: [
        { kind: 'condition_geofence', place_id: 3, state: 'inside' },
        { kind: 'condition_geofence', place_id: 4, state: 'outside' },
      ],
      actions: [
        { kind: 'action_command', command_name: 'honk_horn' },
        { kind: 'action_command', command_name: 'flash_lights' },
      ],
    });

    expect(next.name).toBe('AI Drafted');
    expect(next.description).toBe('from ai');
    expect(next.triggers).toEqual([{ kind: 'trigger_event', event_type: 'online' }]);
    expect(next.conditions).toHaveLength(2);
    expect(next.actions).toHaveLength(2);
  });
});

// ────────────────────────────── Edit mode ──────────────────────────────

describe('AutomationBuilderPage — edit mode', () => {
  it('renders the loading state and hides the form while the automation loads', () => {
    H.automationState = { data: undefined, isLoading: true, error: null };
    renderPage('/automations/5/edit');

    expect(screen.getByRole('heading', { name: 'Edit Automation' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
  });

  it('renders a not-found empty state when the automation is missing', () => {
    H.automationState = { data: undefined, isLoading: false, error: null };
    renderPage('/automations/5/edit');

    expect(screen.getByText('Automation not found')).toBeInTheDocument();
  });

  it('hydrates an existing automation and fires a test run', async () => {
    H.automationState = { data: EDIT_AUTOMATION, isLoading: false, error: null };
    renderPage('/automations/5/edit');

    // Form hydrates from the server payload.
    expect(await screen.findByDisplayValue('Existing One')).toBeInTheDocument();

    const testRunBtn = screen.getByRole('button', { name: /test run/i });
    fireEvent.click(testRunBtn);
    expect(H.testRunMutate).toHaveBeenCalledWith(5);
  });
});

// ──────────────────── Draft autosave regression (bug fix) ────────────────────

describe('AutomationBuilderPage — new-automation draft autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the in-progress form to localStorage after the debounce', async () => {
    // Regression guard: an effect-ordering bug left `hydrated` stuck at false
    // for brand-new automations, so `skipPersist` short-circuited every draft
    // write. This proves the form is hydrated and autosave actually fires.
    renderPage('/automations/new');

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Draft Me' } });
    await vi.advanceTimersByTimeAsync(2000);

    const raw = window.localStorage.getItem('teslasync:draft:v1:automation:new');
    expect(raw).not.toBeNull();
    expect(raw).toContain('Draft Me');
  });
});

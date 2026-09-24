/**
 * AlertStudioPage create-only and multi-vehicle picker integration tests.
 *
 * Component-level tests (sticky-all toggling, unknown-id rendering,
 * empty-fleet behaviour, hydration, payload shape) live in
 * `web/src/components/forms/__tests__/VehicleMultiSelect.test.tsx`.
 *
 * This file pins the integration touch-points:
 *   1. New rule defaults to all-sticky.
 * Existing-rule editing belongs on /notifications/rules, not in Studio.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '../../../i18n';

import AlertStudioPage from './AlertStudioPage';
import { AlertRuleEditor } from '../components/AlertRuleEditor';
import type { AlertRule, AlertRuleInput } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import { ToastProvider } from '@/components/feedback/Toast';
import { NavigationGuardProvider, GuardedLink } from '@/components/feedback';
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
}));

const VEHICLES: Vehicle[] = [
  {
    id: 1, vehicle_id: 1, vin: 'VIN111111111111', display_name: 'Roadster', model: 'Model 3',
    trim_badging: '', exterior_color: '', wheel_type: '', state: 'online', healthy: true,
    created_at: '', updated_at: '',
  },
  {
    id: 2, vehicle_id: 2, vin: 'VIN222222222222', display_name: 'Plaid', model: 'Model S',
    trim_badging: '', exterior_color: '', wheel_type: '', state: 'online', healthy: true,
    created_at: '', updated_at: '',
  },
];

let RULES: AlertRule[] = [];

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: VEHICLES }),
}));

vi.mock('@/api/hooks/useSignals', () => ({
  useAvailableSignals: () => ({
    data: {
      vehicle_id: 1,
      count: 2,
      source: 'protomodel',
      signals: [
        {
          name: 'BatteryLevel',
          category: 'battery',
          value_kind: 'float',
          unit_kind: 'charge',
          is_compound: false,
          is_setting_unit: false,
        },
        {
          name: 'VehicleSpeed',
          category: 'driving',
          value_kind: 'float',
          unit_kind: 'speed',
          is_compound: false,
          is_setting_unit: false,
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/api/hooks/useLocations', () => ({
  useGeofencesFull: () => ({
    data: [{ id: 7, name: 'Home', enabled: true }],
    isLoading: false,
    isError: false,
  }),
}));

const recordedSavePayloads: AlertRuleInput[] = [];
const onEditorSaved = vi.fn<(rule: AlertRule) => void>();

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
    '@/api/hooks/useNotifications',
  );
  return {
    ...actual,
    useAlertRules: () => ({ data: RULES, isLoading: false, error: null }),
    useNotificationChannels: () => ({ data: [], isLoading: false, error: null }),
    useAlertMetrics: () => ({ data: [], isLoading: false }),
    useSaveAlertRule: () => ({
      mutate: vi.fn((input: AlertRuleInput, options?: { onSuccess?: (result: AlertRule) => void }) => {
        recordedSavePayloads.push(input);
        options?.onSuccess?.({ ...input, id: 'id' in input ? input.id : 999 } as AlertRule);
      }),
      mutateAsync: vi.fn(async (input: AlertRuleInput) => {
        recordedSavePayloads.push(input);
        return { id: 999, ...input } as unknown as AlertRule;
      }),
      isPending: false,
    }),
    useDeleteAlertRule: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useToggleAlertRule: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useTestAlertRule: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useSnoozeAlertRule: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useBulkEnableRules: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useBulkDisableRules: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  };
});

function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <span data-testid="current-location">{pathname}{search}</span>;
}

function renderPage(path = '/notifications/studio', editRule?: AlertRule) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <NavigationGuardProvider>
            <CurrentLocation />
            <GuardedLink to="/vehicles">Leave studio</GuardedLink>
            {editRule
              ? <AlertRuleEditor key={editRule.id} rule={editRule} onSaved={onEditorSaved} onCancel={vi.fn()} />
              : <AlertStudioPage />}
          </NavigationGuardProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AlertStudioPage navigation protection', () => {
  beforeEach(() => {
    RULES = [];
    recordedSavePayloads.length = 0;
    window.localStorage.clear();
  });

  describe('Shared AlertRuleEditor controlled edit mode', () => {
    beforeEach(() => {
      RULES = [];
      recordedSavePayloads.length = 0;
      onEditorSaved.mockClear();
      window.localStorage.clear();
    });

    it('hydrates an existing signal rule and persists its channel routing with PUT identity', async () => {
      const rule = {
        id: 42, name: 'Battery warning', enabled: true, severity: 'warn',
        all_vehicles: true, vehicle_ids: [], signal_name: 'BatteryLevel',
        op: '<', value_num: 20, cooldown_min: 15, trigger_mode: 'repeat',
        kind: 'signal', channel_ids: [], created_at: '', updated_at: '',
      } as AlertRule;
      renderPage('/notifications/rules', rule);
      expect(screen.getByPlaceholderText('My alert rule')).toHaveValue('Battery warning');
      expect(screen.getByLabelText('Rule delivery channels')).toHaveValue('none');
      fireEvent.click(screen.getByRole('button', { name: 'Update Rule' }));
      await waitFor(() => expect(onEditorSaved).toHaveBeenCalledTimes(1));
      expect(recordedSavePayloads[0]).toMatchObject({ id: 42, kind: 'signal', channel_ids: [] });
    });

    it('hydrates computed-metric rules in the same edit form', async () => {
      const rule = {
        id: 43, name: 'Charging cost', enabled: true, severity: 'warn',
        all_vehicles: true, vehicle_ids: [], signal_name: '',
        op: '=', cooldown_min: 15, trigger_mode: 'once', kind: 'computed_metric',
        metric_id: 'charging_cost', metric_window: 'day', metric_op: '>',
        metric_threshold: 12, channel_ids: null, created_at: '', updated_at: '',
      } as AlertRule;
      renderPage('/notifications/rules', rule);
      expect(screen.getByPlaceholderText('My alert rule')).toHaveValue('Charging cost');
      expect(screen.getByLabelText('Rule delivery channels')).toHaveValue('inherit');
      expect(screen.getByRole('button', { name: 'Update Rule' })).toBeInTheDocument();
    });

    it('edits a system-service outage rule without converting it to a signal rule', async () => {
      const rule = {
        id: 46, name: 'Broker outage', enabled: true, severity: 'warn',
        all_vehicles: true, vehicle_ids: [], signal_name: '',
        op: '=', cooldown_min: 15, trigger_mode: 'repeat', kind: 'system_component',
        component_name: 'mqtt', transition: 'outage', created_at: '', updated_at: '',
      } as AlertRule;
      renderPage('/notifications/rules', rule);
      expect(screen.getByLabelText('Service')).toHaveValue('mqtt');
      expect(screen.queryByLabelText('Vehicles')).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('When'), { target: { value: 'recovery' } });
      fireEvent.click(screen.getByRole('button', { name: 'Update Rule' }));
      await waitFor(() => expect(onEditorSaved).toHaveBeenCalledTimes(1));
      expect(recordedSavePayloads[0]).toMatchObject({
        id: 46, kind: 'system_component', component_name: 'mqtt',
        transition: 'recovery', all_vehicles: true, vehicle_ids: [],
      });
    });

    it('edits a place arrival rule with its place and vehicle scope intact', async () => {
      const rule = {
        id: 47, name: 'Home arrival', enabled: true, severity: 'info',
        all_vehicles: false, vehicle_ids: [1], signal_name: '',
        op: '=', cooldown_min: 15, trigger_mode: 'repeat', kind: 'place',
        place_id: 7, transition: 'enter', created_at: '', updated_at: '',
      } as AlertRule;
      renderPage('/notifications/rules', rule);
      expect(screen.getByLabelText('Place')).toHaveValue('7');
      fireEvent.change(screen.getByLabelText('When'), { target: { value: 'exit' } });
      fireEvent.click(screen.getByRole('button', { name: 'Update Rule' }));
      await waitFor(() => expect(onEditorSaved).toHaveBeenCalledTimes(1));
      expect(recordedSavePayloads[0]).toMatchObject({
        id: 47, kind: 'place', place_id: 7, transition: 'exit',
        all_vehicles: false, vehicle_ids: [1],
      });
    });

    it('treats legacy rules without channel_ids as inheriting enabled channels', () => {
      const rule = {
        id: 45, name: 'Legacy rule', enabled: true, severity: 'warn',
        all_vehicles: true, vehicle_ids: [], signal_name: 'BatteryLevel',
        op: '<', value_num: 20, cooldown_min: 15, trigger_mode: 'once',
        kind: 'signal', created_at: '', updated_at: '',
      } as AlertRule;
      renderPage('/notifications/rules', rule);
      expect(screen.getByLabelText('Rule delivery channels')).toHaveValue('inherit');
      expect(screen.getByRole('button', { name: 'Update Rule' })).toBeInTheDocument();
    });

    it('fails closed rather than overwriting an unsupported future kind as a signal', () => {
      const rule = {
        id: 44, name: 'Future event', enabled: true, severity: 'warn',
        all_vehicles: true, vehicle_ids: [], signal_name: '',
        op: '=', cooldown_min: 15, trigger_mode: 'once', kind: 'future_event',
        created_at: '', updated_at: '',
      } as unknown as AlertRule;
      renderPage('/notifications/rules', rule);
      expect(screen.getByText(/This rule type cannot be edited/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Update Rule' })).toBeDisabled();
      expect(recordedSavePayloads).toHaveLength(0);
    });
  });

  it('does not warn just for restoring a locally saved draft, but warns for new edits', async () => {
    const first = renderPage();
    fireEvent.change(screen.getByPlaceholderText('My alert rule'), { target: { value: 'Recovered draft' } });
    await waitFor(() => {
      expect(window.localStorage.getItem('teslasync:draft:v6:alertstudio:rule:new')).toContain('Recovered draft');
    }, { timeout: 2000 });
    first.unmount();
    renderPage();
    expect(screen.getByPlaceholderText('My alert rule')).toHaveValue('Recovered draft');
    fireEvent.click(screen.getByRole('link', { name: 'Leave studio' }));
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/vehicles'));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('My alert rule'), { target: { value: 'New edit' } });
    fireEvent.click(screen.getByRole('link', { name: 'Leave studio' }));
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
  });

  it('creates system and place rules using the corresponding typed condition fields', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('My alert rule'), { target: { value: 'Broker unavailable' } });
    fireEvent.click(screen.getByRole('tab', { name: 'System service' }));
    expect(screen.queryByLabelText('Vehicles')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Rule' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'mqtt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }));
    await waitFor(() => expect(recordedSavePayloads).toHaveLength(1));
    expect(recordedSavePayloads[0]).toMatchObject({
      kind: 'system_component', component_name: 'mqtt', transition: 'outage',
      all_vehicles: true, vehicle_ids: [],
    });

    fireEvent.change(screen.getByPlaceholderText('My alert rule'), { target: { value: 'Arrived home' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Place event' }));
    expect(screen.getByRole('button', { name: 'Create Rule' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }));
    await waitFor(() => expect(recordedSavePayloads).toHaveLength(2));
    expect(recordedSavePayloads[1]).toMatchObject({
      kind: 'place', place_id: 7, transition: 'enter',
    });
  });

  it.each([
    { channel_ids: undefined, vehicle_selection: { kind: 'all_sticky' } },
    { channel_ids: null, vehicle_selection: { kind: 'specific' } },
  ])('rejects an incomplete persisted draft without crashing the editor: %j', (value) => {
    const key = 'teslasync:draft:v6:alertstudio:rule:new';
    window.localStorage.setItem(key, JSON.stringify({
      version: 6,
      savedAt: Date.now(),
      value,
    }));
    renderPage();
    expect(screen.getByPlaceholderText('My alert rule')).toHaveValue('');
    expect(screen.getByLabelText('Rule delivery channels')).toHaveValue('inherit');
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('discarding a recovered draft leaves a clean editor and removes the stored draft', async () => {
    const first = renderPage();
    fireEvent.change(screen.getByPlaceholderText('My alert rule'), { target: { value: 'Discard me' } });
    await waitFor(() => {
      expect(window.localStorage.getItem('teslasync:draft:v6:alertstudio:rule:new')).toContain('Discard me');
    }, { timeout: 2000 });
    first.unmount();
    renderPage();
    fireEvent.click(screen.getByTestId('draft-recovery-discard'));
    expect(screen.getByPlaceholderText('My alert rule')).toHaveValue('');
    expect(window.localStorage.getItem('teslasync:draft:v6:alertstudio:rule:new')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Leave studio' }));
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/vehicles'));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('does not warn when leaving a new untouched editor', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('link', { name: 'Leave studio' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent('/vehicles');
    });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('warns for edits and stops warning when edits are undone', async () => {
    renderPage();
    const name = screen.getByPlaceholderText('My alert rule');
    fireEvent.change(name, { target: { value: 'Unsaved rule' } });
    fireEvent.click(screen.getByRole('link', { name: 'Leave studio' }));
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/notifications/studio');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(screen.getByRole('link', { name: 'Leave studio' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent('/vehicles');
    });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('redirects legacy edit URLs to Rules without exposing an editor in Studio', async () => {
    renderPage('/notifications/studio?rule=42');
    await waitFor(() => expect(screen.getByTestId('current-location'))
      .toHaveTextContent('/notifications/rules?rule=42'));
    expect(screen.queryByRole('button', { name: 'Update Rule' })).not.toBeInTheDocument();
  });

  it('does not pass untrusted rule IDs through the redirect', async () => {
    renderPage('/notifications/studio?rule=not-an-id');
    await waitFor(() => expect(screen.getByTestId('current-location'))
      .toHaveTextContent('/notifications/rules'));
    expect(screen.getByTestId('current-location')).not.toHaveTextContent('not-an-id');
  });

  it('keeps the rules list on the Rules page, not in Studio', () => {
    RULES = [{
      id: 42, name: 'Only on Rules page', enabled: true, severity: 'warn',
      all_vehicles: true, vehicle_ids: [], signal_name: 'BatteryLevel',
      op: '<', value_num: 20, cooldown_min: 15, trigger_mode: 'once',
      kind: 'signal', created_at: '', updated_at: '',
    } as AlertRule];
    renderPage();
    expect(screen.queryByText('Only on Rules page')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('My alert rule')).toBeInTheDocument();
  });
});

describe('AlertStudioPage — canonical signal units', () => {
  beforeEach(() => {
    RULES = [];
    recordedSavePayloads.length = 0;
    window.localStorage.clear();
  });

  it('associates charge thresholds with canonical percent guidance', () => {
    renderPage();
    fireEvent.change(document.getElementById('alert-signal') as HTMLSelectElement, {
      target: { value: 'BatteryLevel' },
    });

    const input = screen.getByLabelText(/^Numeric Value/);
    expect(input).toHaveAttribute('aria-describedby');
    expect(screen.getByText('Canonical input: percent from 0 to 100.')).toBeInTheDocument();
  });

  it('identifies speed thresholds as canonical meters per second', () => {
    renderPage();
    fireEvent.change(document.getElementById('alert-signal') as HTMLSelectElement, {
      target: { value: 'VehicleSpeed' },
    });

    expect(
      screen.getByText('Canonical SI input: meters per second (m/s).'),
    ).toBeInTheDocument();
  });
});

describe('AlertStudioPage — multi-vehicle picker integration (Phase-49 / Slice 0006)', () => {
  beforeEach(() => {
    RULES = [];
    recordedSavePayloads.length = 0;
    window.localStorage.clear();
  });

  it('new rule defaults vehicle picker to "All vehicles"', () => {
    renderPage();
    expect(screen.getAllByText('All vehicles').length).toBeGreaterThan(0);
  });

  it('persists an independent delivery-channel choice when creating a rule', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('My alert rule'), { target: { value: 'Low battery' } });
    fireEvent.change(document.getElementById('alert-signal') as HTMLSelectElement, { target: { value: 'BatteryLevel' } });
    fireEvent.change(document.getElementById('alert-operator') as HTMLSelectElement, { target: { value: '<' } });
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '20' } });
    fireEvent.change(document.getElementById('alert-trigger-mode') as HTMLSelectElement, { target: { value: 'once' } });
    fireEvent.change(screen.getByLabelText('Rule delivery channels'), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }));
    await waitFor(() => expect(recordedSavePayloads[0]?.channel_ids).toEqual([]));
  });

});

/**
 * New rules default to notify on event regardless of operator.
 */
describe('AlertStudioPage — alert-behavior defaults', () => {
  beforeEach(() => {
    RULES = [];
    recordedSavePayloads.length = 0;
    window.localStorage.clear();
  });

  function getTriggerSelect(): HTMLSelectElement {
    const el = document.getElementById('alert-trigger-mode')
    if (!el) throw new Error('alert-trigger-mode select not rendered')
    return el as HTMLSelectElement
  }

  function getOperatorSelect(): HTMLSelectElement {
    const el = document.getElementById('alert-operator')
    if (!el) throw new Error('alert-operator select not rendered')
    return el as HTMLSelectElement
  }

  function getSignalSelect(): HTMLSelectElement {
    const el = document.getElementById('alert-signal')
    if (!el) throw new Error('alert-signal select not rendered')
    return el as HTMLSelectElement
  }

  function getSaveButton(): HTMLButtonElement {
    // Brand-new rule: button is "Create Rule" (i18n
    // notifications.alertStudio.actions.createRule).
    // Existing rule: "Update Rule".
    const btn = screen.queryByRole('button', { name: /create rule|update rule/i })
    if (!btn) throw new Error('Save button not rendered')
    return btn as HTMLButtonElement
  }

  function pickSignal(name: string) {
    fireEvent.change(getSignalSelect(), { target: { value: name } })
  }

  function pickOperator(op: string) {
    fireEvent.change(getOperatorSelect(), { target: { value: op } })
  }

  function fillName(name: string) {
    fireEvent.change(screen.getByPlaceholderText('My alert rule'), { target: { value: name } })
  }

  it('new rule defaults to notify on event and excludes notification titles', () => {
    renderPage()
    expect(getTriggerSelect().value).toBe('once')
    expect(screen.getByRole('checkbox', { name: /Include title in notifications/i })).not.toBeChecked()
    expect(getSaveButton()).toBeDisabled()
  });

  it('places behavior guidance and comparison recommendation below the field', () => {
    renderPage()
    pickSignal('BatteryLevel')
    pickOperator('=')
    const select = getTriggerSelect()
    const guide = screen.getByText(/Pick 'Notify on event' for one-time confirmations/)
    const recommendation = screen.getByTestId('alert-behavior-recommend-banner')
    expect(select.getAttribute('aria-describedby')).toContain('alert-trigger-mode-help')
    expect(select.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(guide.compareDocumentPosition(recommendation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(recommendation).toHaveTextContent(/Recommended for "=" comparisons: Notify on event/)
    expect(recommendation).toHaveTextContent(/Re-alert until resolved is also valid/)
  })

  it('keeps notify on event selected when the signal operator changes', async () => {
    renderPage()
    fillName('Test rule')
    pickSignal('BatteryLevel')
    pickOperator('>')
    expect(getTriggerSelect().value).toBe('once')
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '20' } })
    expect(getSaveButton()).not.toBeDisabled()
    fireEvent.click(getSaveButton())
    await waitFor(() => expect(recordedSavePayloads[0]).toMatchObject({
      trigger_mode: 'once',
      include_title: false,
    }))
  });

  it('allows choosing re-alert instead of the default', async () => {
    renderPage()
    fillName('Test rule')
    pickSignal('BatteryLevel')
    pickOperator('<')
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '20' } })
    fireEvent.change(getTriggerSelect(), { target: { value: 'repeat' } })
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled())
    fireEvent.click(getSaveButton())
    await waitFor(() => expect(recordedSavePayloads[0]?.trigger_mode).toBe('repeat'))
  });

});

describe('AlertStudioPage — two-tier severity escalation (Phase-49 / Slice 0009)', () => {
  beforeEach(() => {
    RULES = [];
    recordedSavePayloads.length = 0;
    window.localStorage.clear();
  });

  function getEscalationCheckbox(): HTMLElement | null {
    // Toggle wraps a button[role="switch"]
    // inside a div whose id is the prop we passed. Walk to find the
    // actual switch button so click() and aria-checked are observable.
    const wrapper = document.getElementById('alert-escalation-enabled')
    if (!wrapper) return null
    return wrapper.querySelector('button[role="switch"]') as HTMLElement | null
  }

  function getEscalationAfterInput(): HTMLInputElement | null {
    return document.getElementById('alert-escalation-after') as HTMLInputElement | null
  }

  function getEscalationSeveritySelect(): HTMLSelectElement | null {
    return document.getElementById('alert-escalation-severity') as HTMLSelectElement | null
  }

  function getTriggerSelect(): HTMLSelectElement {
    const el = document.getElementById('alert-trigger-mode')
    if (!el) throw new Error('alert-trigger-mode select not rendered')
    return el as HTMLSelectElement
  }

  function getSaveButton(): HTMLButtonElement {
    const btn = screen.queryByRole('button', { name: /create rule|update rule/i })
    if (!btn) throw new Error('Save button not rendered')
    return btn as HTMLButtonElement
  }

  function fillName(name: string) {
    fireEvent.change(screen.getByPlaceholderText('My alert rule'), { target: { value: name } })
  }

  function pickSignal(name: string) {
    const el = document.getElementById('alert-signal') as HTMLSelectElement
    fireEvent.change(el, { target: { value: name } })
  }

  function pickOperator(op: string) {
    const el = document.getElementById('alert-operator') as HTMLSelectElement
    fireEvent.change(el, { target: { value: op } })
  }

  function fillValueNum(v: string) {
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: v } })
  }

  // T1 — section is hidden when trigger_mode != 'repeat'. Force-choose
  // checkbox keeps it hidden until the user picks a mode, and stays
  // hidden when they pick 'once'.
  it('escalation section is hidden for once-mode rules', async () => {
    renderPage()
    fillName('OnceRule')
    pickSignal('BatteryLevel')
    pickOperator('<')
    fillValueNum('20')
    fireEvent.change(getTriggerSelect(), { target: { value: 'once' } })
    await waitFor(() => expect(getTriggerSelect().value).toBe('once'))
    expect(getEscalationCheckbox()).toBeNull()
  });

  // T2 — section IS visible when trigger_mode === 'repeat', but the
  // duration + severity inputs only appear once the checkbox is on.
  it('escalation checkbox appears for repeat-mode; fields render only when checked', async () => {
    renderPage()
    fillName('RepeatRule')
    pickSignal('BatteryLevel')
    pickOperator('<')
    fillValueNum('20')
    fireEvent.change(getTriggerSelect(), { target: { value: 'repeat' } })
    await waitFor(() => expect(getEscalationCheckbox()).not.toBeNull())
    // Checkbox unchecked → fields not rendered yet.
    expect(getEscalationAfterInput()).toBeNull()
    expect(getEscalationSeveritySelect()).toBeNull()
    // Toggle on → both fields appear.
    fireEvent.click(getEscalationCheckbox()!)
    await waitFor(() => expect(getEscalationAfterInput()).not.toBeNull())
    expect(getEscalationSeveritySelect()).not.toBeNull()
  });

  // T3 — Save blocks until BOTH escalation fields are filled AND the
  // escalated severity is strictly higher than the base. Half-set
  // states fail the canSave gate.
  it('Save is disabled when escalation is on but fields are incomplete', async () => {
    renderPage()
    fillName('PartialRule')
    pickSignal('BatteryLevel')
    pickOperator('<')
    fillValueNum('20')
    fireEvent.change(getTriggerSelect(), { target: { value: 'repeat' } })
    await waitFor(() => expect(getEscalationCheckbox()).not.toBeNull())
    fireEvent.click(getEscalationCheckbox()!)

    // Just opened: both fields blank → Save blocked.
    expect(getSaveButton()).toBeDisabled()

    // Fill duration only → still blocked (severity missing).
    fireEvent.change(getEscalationAfterInput()!, { target: { value: '30' } })
    expect(getSaveButton()).toBeDisabled()

    // Add severity → Save unblocks (default base 'warn' < 'critical').
    fireEvent.change(getEscalationSeveritySelect()!, { target: { value: 'critical' } })
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled())
  });

  // T4 — Save payload includes the pair when the user filled it AND
  // both fields are nulled when the user toggles the checkbox off.
  // Verifies buildEscalationPayload + buildSavePayload integration.
  it('save payload includes escalation_after_min + escalation_severity when filled', async () => {
    renderPage()
    fillName('EscalatedRule')
    pickSignal('BatteryLevel')
    pickOperator('<')
    fillValueNum('20')
    fireEvent.change(getTriggerSelect(), { target: { value: 'repeat' } })
    await waitFor(() => expect(getEscalationCheckbox()).not.toBeNull())
    fireEvent.click(getEscalationCheckbox()!)
    fireEvent.change(getEscalationAfterInput()!, { target: { value: '30' } })
    fireEvent.change(getEscalationSeveritySelect()!, { target: { value: 'critical' } })

    await waitFor(() => expect(getSaveButton()).not.toBeDisabled())
    fireEvent.click(getSaveButton())

    await waitFor(() => expect(recordedSavePayloads.length).toBeGreaterThan(0))
    const payload = recordedSavePayloads[recordedSavePayloads.length - 1]
    expect(payload.escalation_after_min).toBe(30)
    expect(payload.escalation_severity).toBe('critical')
  });

  // T5 — flipping trigger_mode away from repeat must NULL OUT the
  // escalation pair on the wire. The UI hides the section, but if a
  // stale field value lingered in EditorState it would still get sent
  // and the backend would 400. Defence-in-depth integration test.
  it('payload nulls escalation when user flips trigger_mode from repeat to once', async () => {
    renderPage()
    fillName('FlippedRule')
    pickSignal('BatteryLevel')
    pickOperator('<')
    fillValueNum('20')
    fireEvent.change(getTriggerSelect(), { target: { value: 'repeat' } })
    await waitFor(() => expect(getEscalationCheckbox()).not.toBeNull())
    fireEvent.click(getEscalationCheckbox()!)
    fireEvent.change(getEscalationAfterInput()!, { target: { value: '45' } })
    fireEvent.change(getEscalationSeveritySelect()!, { target: { value: 'critical' } })

    // Now flip back to once-mode. Checkbox + fields disappear; the
    // EditorState's escalation_* values get nulled by the trigger_mode
    // onChange handler.
    fireEvent.change(getTriggerSelect(), { target: { value: 'once' } })
    await waitFor(() => expect(getTriggerSelect().value).toBe('once'))
    expect(getEscalationCheckbox()).toBeNull()

    await waitFor(() => expect(getSaveButton()).not.toBeDisabled())
    fireEvent.click(getSaveButton())

    await waitFor(() => expect(recordedSavePayloads.length).toBeGreaterThan(0))
    const payload = recordedSavePayloads[recordedSavePayloads.length - 1]
    expect(payload.escalation_after_min).toBeNull()
    expect(payload.escalation_severity).toBeNull()
  });
});

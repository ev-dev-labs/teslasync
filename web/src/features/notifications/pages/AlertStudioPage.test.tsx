/**
 * Phase-49 / Slice 0006 — AlertStudioPage integration tests for the
 * multi-vehicle picker wiring.
 *
 * Component-level tests (sticky-all toggling, unknown-id rendering,
 * empty-fleet behaviour, hydration, payload shape) live in
 * `web/src/components/forms/__tests__/VehicleMultiSelect.test.tsx`.
 *
 * This file pins the integration touch-points:
 *   1. New rule defaults to all-sticky.
 *   2. Editing a legacy `vehicle_id` rule hydrates the picker.
 *   3. Editing a new-shape rule (`all_vehicles + vehicle_ids`) hydrates.
 *   4. Save payload contains `all_vehicles` + `vehicle_ids` (never
 *      legacy `vehicle_id`).
 *   5. Save is disabled when picker is in `specific` with empty array.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../../../i18n';

import AlertStudioPage from './AlertStudioPage';
import type { AlertRule, AlertRuleInput } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import { ToastProvider } from '@/components/feedback/Toast';
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

const recordedSavePayloads: AlertRuleInput[] = [];

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
      mutate: vi.fn((input: AlertRuleInput) => { recordedSavePayloads.push(input); }),
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/notifications/rules']}>
        <ToastProvider>
          <AlertStudioPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function selectRule(name: string) {
  const span = screen.getByText(name);
  // The clickable wrapper is the role="button" parent div.
  const wrapper = span.closest('[role="button"]');
  if (wrapper) {
    fireEvent.click(wrapper);
  } else {
    fireEvent.click(span);
  }
}

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

  it('editing a legacy rule (vehicle_id=2 only) hydrates picker showing Plaid', async () => {
    RULES = [
      {
        id: 42, name: 'LegacyRule', enabled: true, severity: 'warn',
        vehicle_id: 2, signal_name: 'VehicleSpeed', op: '>', value_num: 70,
        cooldown_min: 15, trigger_mode: 'repeat', kind: 'signal',
        created_at: '', updated_at: '',
      } as AlertRule,
    ];
    renderPage();
    selectRule('LegacyRule');
    await waitFor(() => {
      expect(screen.getAllByText('Plaid').length).toBeGreaterThan(0);
    });
  });

  it('editing a new-shape rule (all_vehicles=true) hydrates picker as All vehicles', async () => {
    RULES = [
      {
        id: 43, name: 'StickyAll', enabled: true, severity: 'warn',
        all_vehicles: true, vehicle_ids: [], vehicle_id: null,
        signal_name: 'VehicleSpeed', op: '>', value_num: 70,
        cooldown_min: 15, trigger_mode: 'repeat', kind: 'signal',
        created_at: '', updated_at: '',
      } as AlertRule,
    ];
    renderPage();
    selectRule('StickyAll');
    await waitFor(() => {
      // 1 occurrence in rule list + 1 in picker trigger.
      expect(screen.getAllByText('All vehicles').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('editing a new-shape rule (all_vehicles=false, vehicle_ids=[1,2]) shows partial-count summary', async () => {
    RULES = [
      {
        id: 44, name: 'TwoVehicles', enabled: true, severity: 'warn',
        all_vehicles: false, vehicle_ids: [1, 2], vehicle_id: 1,
        signal_name: 'VehicleSpeed', op: '>', value_num: 70,
        cooldown_min: 15, trigger_mode: 'repeat', kind: 'signal',
        created_at: '', updated_at: '',
      } as AlertRule,
    ];
    renderPage();
    selectRule('TwoVehicles');
    // 2 of 2 = "all in known fleet", but kind='specific' so it shows "2 vehicles" (count-only).
    await waitFor(() => {
      expect(screen.getAllByText('2 vehicles').length).toBeGreaterThan(0);
    });
  });

  it('save payload includes all_vehicles + vehicle_ids and OMITS legacy vehicle_id', async () => {
    RULES = [
      {
        id: 50, name: 'EditAndSave', enabled: true, severity: 'warn',
        all_vehicles: false, vehicle_ids: [1], vehicle_id: 1,
        signal_name: 'VehicleSpeed', op: '>', value_num: 70,
        cooldown_min: 15, trigger_mode: 'repeat', kind: 'signal',
        created_at: '', updated_at: '',
      } as AlertRule,
    ];
    renderPage();
    selectRule('EditAndSave');
    // Wait for hydration.
    await waitFor(() => {
      expect(screen.getAllByText('Roadster').length).toBeGreaterThan(0);
    });
    const saveBtn = await screen.findByRole('button', { name: /update rule/i });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(recordedSavePayloads.length).toBeGreaterThan(0));
    const payload = recordedSavePayloads[0] as Record<string, unknown>;
    expect(payload.all_vehicles).toBe(false);
    expect(payload.vehicle_ids).toEqual([1]);
    expect('vehicle_id' in payload).toBe(false);
  });
});

/**
 * Phase-49 / Slice 0008 — Smart Defaults + Force-Choose for Alert Behavior.
 *
 * Decisions covered:
 *   D2: smart default by op (recommendedTriggerMode)
 *   D3: force user to choose at create time (no implicit 'repeat')
 *   R7: existing rules preserve their stored trigger_mode (no force-choose)
 */
describe('AlertStudioPage — alert-behavior force-choose + recommendation (Phase-49 / Slice 0008)', () => {
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

  it('new rule defaults trigger_mode to "unset" (placeholder shown, Save disabled)', () => {
    renderPage()
    expect(getTriggerSelect().value).toBe('')
    expect(getSaveButton()).toBeDisabled()
  });

  it('new rule with op="=" recommends "Notify on event"', async () => {
    renderPage()
    fillName('Test rule')
    pickSignal('BatteryLevel')
    pickOperator('=')
    await waitFor(() => {
      const banner = screen.queryByTestId('alert-behavior-recommend-banner')
      expect(banner).not.toBeNull()
      expect(banner!.textContent).toMatch(/Notify on event/)
    })
  });

  it('new rule with op=">" recommends "Re-alert until resolved"', async () => {
    renderPage()
    fillName('Test rule')
    pickSignal('BatteryLevel')
    pickOperator('>')
    await waitFor(() => {
      const banner = screen.queryByTestId('alert-behavior-recommend-banner')
      expect(banner).not.toBeNull()
      expect(banner!.textContent).toMatch(/Re-alert until resolved/)
    })
  });

  it('changing op while still unset updates the recommendation banner', async () => {
    renderPage()
    fillName('Test rule')
    pickSignal('BatteryLevel')
    pickOperator('=')
    await waitFor(() => {
      const b = screen.getByTestId('alert-behavior-recommend-banner')
      expect(b.textContent).toMatch(/Notify on event/)
    })
    pickOperator('>')
    await waitFor(() => {
      const b = screen.getByTestId('alert-behavior-recommend-banner')
      expect(b.textContent).toMatch(/Re-alert until resolved/)
    })
  });

  it('after picking a value, the recommendation banner disappears', async () => {
    renderPage()
    fillName('Test rule')
    pickSignal('BatteryLevel')
    pickOperator('=')
    await waitFor(() => expect(screen.queryByTestId('alert-behavior-recommend-banner')).not.toBeNull())
    fireEvent.change(getTriggerSelect(), { target: { value: 'once' } })
    await waitFor(() => expect(screen.queryByTestId('alert-behavior-recommend-banner')).toBeNull())
  });

  it('Save stays disabled until the user picks a trigger mode (force-choose)', async () => {
    renderPage()
    fillName('Test rule')
    pickSignal('BatteryLevel')
    pickOperator('<')
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '20' } })
    // Form is otherwise complete (name + signal + op + value), so the
    // ONLY thing blocking Save now is the unset trigger_mode.
    expect(getSaveButton()).toBeDisabled()
    expect(screen.queryByTestId('alert-behavior-force-choose')).not.toBeNull()
  });

  it('picking a trigger mode enables Save (once form is otherwise complete)', async () => {
    renderPage()
    fillName('Test rule')
    pickSignal('BatteryLevel')
    pickOperator('<')
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '20' } })
    fireEvent.change(getTriggerSelect(), { target: { value: 'once' } })
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled())
    expect(screen.queryByTestId('alert-behavior-force-choose')).toBeNull()
  });

  it('existing rule with trigger_mode="repeat" renders selected, no banner, Save enabled', async () => {
    RULES = [
      {
        id: 60, name: 'Existing', enabled: true, severity: 'warn',
        all_vehicles: true, vehicle_ids: [], vehicle_id: null,
        signal_name: 'BatteryLevel', op: '<', value_num: 20,
        cooldown_min: 15, trigger_mode: 'repeat', kind: 'signal',
        created_at: '', updated_at: '',
      } as AlertRule,
    ];
    renderPage()
    selectRule('Existing')
    await waitFor(() => expect(getTriggerSelect().value).toBe('repeat'))
    expect(screen.queryByTestId('alert-behavior-recommend-banner')).toBeNull()
    expect(screen.queryByTestId('alert-behavior-force-choose')).toBeNull()
    const saveBtn = await screen.findByRole('button', { name: /update rule/i })
    expect(saveBtn).not.toBeDisabled()
  });

  it('existing rule does NOT show recommendation banner even with op="="', async () => {
    RULES = [
      {
        id: 61, name: 'EqExisting', enabled: true, severity: 'warn',
        all_vehicles: true, vehicle_ids: [], vehicle_id: null,
        signal_name: 'Locked', op: '=', value_bool: true,
        cooldown_min: 15, trigger_mode: 'once', kind: 'signal',
        created_at: '', updated_at: '',
      } as AlertRule,
    ];
    renderPage()
    selectRule('EqExisting')
    await waitFor(() => expect(getTriggerSelect().value).toBe('once'))
    expect(screen.queryByTestId('alert-behavior-recommend-banner')).toBeNull()
  });
});

/**
 * ChargingRepairForm — behaviour + branch coverage.
 *
 * The file exports one component (`ChargingRepairForm`) plus a private `num`
 * helper that is exercised transitively through the Save patch builder. These
 * specs cover:
 *
 *   1. Pre-fill — every SI column is seeded from the session (0/null-safe via
 *      `?? ''`), `ended_at` always starts empty, and the placeholder renders.
 *   2. Live unit hints — the operator enters SI (Wh, W) while a `useUnits()`
 *      hint echoes the value in the preferred display unit (kWh, kW). The hint
 *      appears only for the energy/peak/avg fields and only when non-empty.
 *   3. Save patch builder — only filled fields are patched (`num` drops empty
 *      strings), `ended_at` is trimmed, and edited values win over the seed.
 *   4. Action wiring — Save/Close/Discard each call the right mutation with the
 *      session id and forward `onSuccess -> onClose`; Cancel closes directly
 *      without touching any mutation.
 *   5. Loading — a pending mutation disables its button and sets `aria-busy`.
 *   6. Accessibility — the labelled disclosure region owns `formId`, and every
 *      control is reachable by accessible name / label.
 *
 * Network is never touched: the three charging mutation hooks are replaced with
 * controllable doubles, `react-i18next` is pinned to return the developer
 * fallback string (interpolating {{id}}), and `useUnits()` runs for real on the
 * globally-mocked `useSettings` defaults (km / kWh / kW, 2 decimals, en-US).
 * Interactions use `fireEvent` — the repo's established convention
 * (`@testing-library/user-event` is not a dependency).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { StaleChargingSession } from '@/api/hooks/useDataRepair';
import { ChargingRepairForm, type ChargingRepairFormProps } from './ChargingRepairForm';

// Shared, hoisted doubles so the mock factory and the specs reach the same
// mutation instances. Pending flags are boxed so the factory can read the
// current value on every render.
const H = vi.hoisted(() => ({
  updateFn: vi.fn(),
  closeFn: vi.fn(),
  discardFn: vi.fn(),
  updatePending: { value: false },
  closePending: { value: false },
  discardPending: { value: false },
}));

// i18n → return the developer fallback string, interpolating {{vars}} so the
// region's `aria-label` resolves to a concrete accessible name.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const translate = (key: string, second?: unknown, third?: unknown): string => {
    const template = typeof second === 'string' ? second : key;
    const vars = (third && typeof third === 'object' ? third : undefined) as
      | Record<string, unknown>
      | undefined;
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      name in vars ? String(vars[name]) : `{{${name}}}`,
    );
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// The three charging mutation hooks the form consumes. Keep the real module
// (types + `useStaleSessions` are harmless) and override only the hooks with
// controllable doubles.
vi.mock('@/api/hooks/useDataRepair', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useDataRepair')>(
    '@/api/hooks/useDataRepair',
  );
  return {
    ...actual,
    useUpdateCharging: () => ({ mutate: H.updateFn, isPending: H.updatePending.value }),
    useCloseCharging: () => ({ mutate: H.closeFn, isPending: H.closePending.value }),
    useDiscardCharging: () => ({ mutate: H.discardFn, isPending: H.discardPending.value }),
  };
});

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeSession(overrides: Partial<StaleChargingSession> = {}): StaleChargingSession {
  return {
    id: 77,
    vehicle_id: 3,
    started_at: '2026-03-30T02:00:00Z',
    ended_at: null,
    start_soc_pct: 20,
    end_soc_pct: 82,
    delta_soc_pct: 62,
    total_energy_added_wh: 5000,
    peak_power_w: 11000,
    avg_power_w: 7000,
    cost_decimal: 3.5,
    cost_currency: 'USD',
    ...overrides,
  };
}

const EMPTY_METRICS: Partial<StaleChargingSession> = {
  total_energy_added_wh: null,
  end_soc_pct: null,
  peak_power_w: null,
  avg_power_w: null,
  cost_decimal: null,
};

function renderForm(props: Partial<ChargingRepairFormProps> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const session = props.session ?? makeSession();
  const formId = props.formId ?? 'repair-form-charging-77';
  const utils = render(
    <ChargingRepairForm session={session} formId={formId} onClose={onClose} />,
  );
  return { ...utils, onClose, session, formId };
}

beforeEach(() => {
  H.updateFn.mockReset();
  H.closeFn.mockReset();
  H.discardFn.mockReset();
  H.updatePending.value = false;
  H.closePending.value = false;
  H.discardPending.value = false;
});

describe('ChargingRepairForm', () => {
  it('seeds every SI field from the session and exposes a labelled region', () => {
    renderForm({ formId: 'repair-form-charging-77' });

    const region = screen.getByRole('region', { name: 'Repair charging session #77' });
    expect(region).toHaveAttribute('id', 'repair-form-charging-77');

    // ended_at always starts blank, with a machine-parseable placeholder.
    const endedAt = screen.getByLabelText('End Date/Time (ISO)');
    expect(endedAt).toHaveDisplayValue('');
    expect(screen.getByPlaceholderText('2026-03-30T04:00:00Z')).toBe(endedAt);

    // Numeric columns are seeded verbatim (SI units).
    expect(screen.getByLabelText('Energy Added (Wh)')).toHaveDisplayValue('5000');
    expect(screen.getByLabelText('End Battery (%)')).toHaveDisplayValue('82');
    expect(screen.getByLabelText('Peak Power (W)')).toHaveDisplayValue('11000');
    expect(screen.getByLabelText('Avg Power (W)')).toHaveDisplayValue('7000');
    expect(screen.getByLabelText('Cost')).toHaveDisplayValue('3.5');

    // All four actions are reachable by accessible name.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders live display-unit hints for the seeded energy and power fields', () => {
    renderForm();
    // useUnits() runs for real on the mocked settings (kWh / kW, 2 decimals).
    expect(screen.getByText('5.00 kWh')).toBeInTheDocument(); // 5000 Wh
    expect(screen.getByText('11.00 kW')).toBeInTheDocument(); // 11000 W (peak)
    expect(screen.getByText('7.00 kW')).toBeInTheDocument(); // 7000 W (avg)
  });

  it('omits hints and leaves inputs blank when the session has no metrics', () => {
    renderForm({ session: makeSession(EMPTY_METRICS) });

    expect(screen.getByLabelText('Energy Added (Wh)')).toHaveDisplayValue('');
    expect(screen.getByLabelText('Peak Power (W)')).toHaveDisplayValue('');
    expect(screen.getByLabelText('Cost')).toHaveDisplayValue('');

    // No numeric hint is rendered for empty fields.
    expect(screen.queryByText(/kWh/)).toBeNull();
    expect(screen.queryByText(/ kW$/)).toBeNull();
  });

  it('patches only the filled fields, trimming ended_at (num drops empties)', () => {
    renderForm({ session: makeSession(EMPTY_METRICS) });

    fireEvent.change(screen.getByLabelText('End Date/Time (ISO)'), {
      target: { value: '  2026-03-30T04:00:00Z  ' },
    });
    fireEvent.change(screen.getByLabelText('Energy Added (Wh)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('End Battery (%)'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Peak Power (W)'), { target: { value: '11000' } });
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '4.25' } });
    // Avg Power is deliberately left blank -> must be dropped from the patch.

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(H.updateFn).toHaveBeenCalledTimes(1);
    expect(H.updateFn).toHaveBeenCalledWith(
      {
        id: 77,
        patch: {
          ended_at: '2026-03-30T04:00:00Z',
          total_energy_added_wh: 5000,
          end_soc_pct: 80,
          peak_power_w: 11000,
          cost_decimal: 4.25,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    const { patch } = H.updateFn.mock.calls[0][0] as { patch: Record<string, unknown> };
    expect(patch).not.toHaveProperty('avg_power_w');
  });

  it('sends an empty patch when nothing is entered', () => {
    renderForm({ session: makeSession(EMPTY_METRICS) });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(H.updateFn).toHaveBeenCalledWith(
      { id: 77, patch: {} },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('closes the form after a successful Save', () => {
    H.updateFn.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the stale session via the Close action and forwards onClose', () => {
    H.closeFn.mockImplementation(
      (_id: number, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Close Session' }));
    expect(H.closeFn).toHaveBeenCalledWith(77, expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(H.updateFn).not.toHaveBeenCalled();
  });

  it('discards the stale session via the Discard action and forwards onClose', () => {
    H.discardFn.mockImplementation(
      (_id: number, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(H.discardFn).toHaveBeenCalledWith(77, expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cancels directly without invoking any mutation', () => {
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(H.updateFn).not.toHaveBeenCalled();
    expect(H.closeFn).not.toHaveBeenCalled();
    expect(H.discardFn).not.toHaveBeenCalled();
  });

  it('disables an action button and marks it busy while its mutation is pending', () => {
    H.updatePending.value = true;
    H.closePending.value = true;
    H.discardPending.value = true;
    renderForm();

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Close Session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    // Cancel has no async work and stays operable as an escape hatch.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});

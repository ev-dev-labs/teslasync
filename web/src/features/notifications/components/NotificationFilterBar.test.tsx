/**
 * NotificationFilterBar contract tests.
 *
 * The bar is a fully-controlled surface: the parent owns `NotificationFilters`
 * and receives a complete next-state object on every change. These tests drive
 * the real sub-components (severity chips, vehicle/rule <Select>, the debounced
 * SearchInput, ActiveFilterChips) and stub only the heavy RangePicker popover
 * so the from/to commit path can be exercised deterministically.
 *
 * Coverage:
 *   1. Severity chips — labelled group, pressed state, add / remove / clear-last.
 *   2. Vehicle + rule selects — value reflection, emit on change, "All" clears,
 *      #id fallback label for nameless vehicles.
 *   3. SearchInput — debounced emit, whitespace-only treated as cleared.
 *   4. RangePicker — from+to committed atomically in ONE onChange (regression:
 *      two sequential patches raced the controlled merge and dropped `from`),
 *      reset clears both, and the ISO value is sliced to YYYY-MM-DD.
 *   5. ActiveFilterChips — render, single-chip removal preserves siblings,
 *      Clear-all wipes every key.
 *   6. Null-safety / a11y — empty filters render no chips and no pressed chip;
 *      an unknown vehicle id degrades to a #id chip label.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '../../../i18n';

import { NotificationFilterBar, type NotificationFilterBarProps } from './NotificationFilterBar';
import type { RangePickerProps } from '@/components/forms';
import type { Vehicle, AlertRule } from '@/api/types';

// Replace only RangePicker (a portal + calendar popover that is impractical to
// drive in jsdom). Every other export from the forms barrel — FilterBar,
// SearchInput, ActiveFilterChips — stays real so their behaviour is covered.
vi.mock('@/components/forms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/forms')>();
  const MockRangePicker = ({ value, onChange }: RangePickerProps) => (
    <div data-testid="range-picker" data-start={value.start} data-end={value.end}>
      <button type="button" onClick={() => onChange({ start: '2024-03-01', end: '2024-03-31' })}>
        commit-range
      </button>
      <button type="button" onClick={() => onChange({ start: '', end: '' })}>
        reset-range
      </button>
    </div>
  );
  return { ...actual, RangePicker: MockRangePicker };
});

function vehicle(id: number, display_name: string): Vehicle {
  return { id, display_name } as unknown as Vehicle;
}

function rule(id: number, name: string): AlertRule {
  return { id, name } as unknown as AlertRule;
}

const VEHICLES: Vehicle[] = [vehicle(1, 'Model 3'), vehicle(2, 'Model Y')];
const RULES: AlertRule[] = [rule(10, 'Tire Pressure Low'), rule(20, 'Battery Cold')];

function renderBar(overrides: Omit<Partial<NotificationFilterBarProps>, 'onChange'> = {}) {
  const onChange = vi.fn();
  render(
    <NotificationFilterBar
      filters={overrides.filters ?? {}}
      onChange={onChange}
      vehicles={overrides.vehicles ?? VEHICLES}
      rules={overrides.rules ?? RULES}
    />,
  );
  return { onChange };
}

describe('NotificationFilterBar — severity chips', () => {
  it('renders a labelled severity group with pressed state driven by filters', () => {
    renderBar({ filters: { severity: ['warn'] } });

    expect(screen.getByRole('group', { name: 'Severity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^warn$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^info$/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^critical$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a severity when an inactive chip is clicked', () => {
    const { onChange } = renderBar({ filters: {} });

    fireEvent.click(screen.getByRole('button', { name: /^critical$/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].severity).toEqual(['critical']);
  });

  it('removes only the toggled severity when several are active', () => {
    const { onChange } = renderBar({ filters: { severity: ['info', 'warn', 'critical'] } });

    fireEvent.click(screen.getByRole('button', { name: /^warn$/i }));

    expect(onChange.mock.calls[0][0].severity).toEqual(['info', 'critical']);
  });

  it('clears the severity key entirely when the last active chip is toggled off', () => {
    const { onChange } = renderBar({ filters: { severity: ['info'] } });

    fireEvent.click(screen.getByRole('button', { name: /^info$/i }));

    // The array collapses to `undefined`, never an empty array (which would
    // serialize to `severity=` and be sent to the backend as a real filter).
    expect(onChange.mock.calls[0][0].severity).toBeUndefined();
  });
});

describe('NotificationFilterBar — vehicle & rule selects', () => {
  it('reflects the active vehicle and emits a single-element vehicle_id on change', () => {
    const { onChange } = renderBar({ filters: { vehicle_id: [2] } });

    const select = screen.getByRole('combobox', { name: 'Vehicle' });
    expect(select).toHaveValue('2');

    fireEvent.change(select, { target: { value: '1' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].vehicle_id).toEqual([1]);
  });

  it('clears vehicle_id when "All vehicles" is chosen', () => {
    const { onChange } = renderBar({ filters: { vehicle_id: [2] } });

    fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), { target: { value: '' } });

    expect(onChange.mock.calls[0][0].vehicle_id).toBeUndefined();
  });

  it('labels a vehicle with no display name using its #id', () => {
    renderBar({ vehicles: [vehicle(7, '')] });

    expect(screen.getByRole('option', { name: '#7' })).toBeInTheDocument();
  });

  it('emits a single-element rule_id when a rule is selected', () => {
    const { onChange } = renderBar({ filters: {} });

    fireEvent.change(screen.getByRole('combobox', { name: 'Rule' }), { target: { value: '20' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].rule_id).toEqual([20]);
  });
});

describe('NotificationFilterBar — search', () => {
  it('emits the typed query after the debounce window', async () => {
    const { onChange } = renderBar({ filters: {} });

    fireEvent.change(screen.getByPlaceholderText(/search messages/i), {
      target: { value: 'brake' },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0].q).toBe('brake');
  });

  it('treats a whitespace-only query as cleared', async () => {
    const { onChange } = renderBar({ filters: {} });

    fireEvent.change(screen.getByPlaceholderText(/search messages/i), {
      target: { value: '   ' },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0].q).toBeUndefined();
  });
});

describe('NotificationFilterBar — date range (atomic from/to)', () => {
  it('commits from AND to in a single onChange when the range picker fires', () => {
    const { onChange } = renderBar({ filters: {} });

    fireEvent.click(screen.getByRole('button', { name: 'commit-range' }));

    // Regression guard: the old code emitted two sequential patches (setFrom
    // then setTo) built from the same stale `filters` closure, so the second
    // clobbered the first and `from` was lost. It must now be exactly one
    // patch carrying both bounds.
    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0];
    expect(patch.from).toBe('2024-03-01');
    expect(patch.to).toBe('2024-03-31');
  });

  it('clears both from and to in a single onChange when the range is reset', () => {
    const { onChange } = renderBar({ filters: { from: '2024-03-01', to: '2024-03-31' } });

    fireEvent.click(screen.getByRole('button', { name: 'reset-range' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0];
    expect(patch.from).toBeUndefined();
    expect(patch.to).toBeUndefined();
  });

  it('passes the ISO range down sliced to YYYY-MM-DD', () => {
    renderBar({ filters: { from: '2024-03-01T12:00:00Z', to: '2024-03-31T09:30:00Z' } });

    const picker = screen.getByTestId('range-picker');
    expect(picker).toHaveAttribute('data-start', '2024-03-01');
    expect(picker).toHaveAttribute('data-end', '2024-03-31');
  });
});

describe('NotificationFilterBar — active filter chips', () => {
  it('renders chips and removing one clears just that key, preserving the rest', () => {
    const { onChange } = renderBar({
      filters: { severity: ['warn'], vehicle_id: [1], q: 'brake' },
    });

    const chips = screen.getByTestId('active-filter-chips');
    expect(chips).toBeInTheDocument();
    // The vehicle chip resolves the id to its display name (scoped to the
    // chip row — "Model 3" also appears as a <select> option).
    expect(within(chips).getByText('Model 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove filter vehicle/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0];
    expect(patch.vehicle_id).toBeUndefined();
    expect(patch.severity).toEqual(['warn']);
    expect(patch.q).toBe('brake');
  });

  it('wipes every filter key via Clear all', () => {
    const { onChange } = renderBar({
      filters: {
        severity: ['warn'],
        vehicle_id: [1],
        rule_id: [10],
        q: 'x',
        from: '2024-03-01',
        to: '2024-03-31',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /^clear all$/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0];
    expect(patch.severity).toBeUndefined();
    expect(patch.vehicle_id).toBeUndefined();
    expect(patch.rule_id).toBeUndefined();
    expect(patch.q).toBeUndefined();
    expect(patch.from).toBeUndefined();
    expect(patch.to).toBeUndefined();
  });

  it('falls back to a #id chip when the filtered vehicle is unknown', () => {
    renderBar({ filters: { vehicle_id: [999] } });

    expect(screen.getByText('#999')).toBeInTheDocument();
  });
});

describe('NotificationFilterBar — empty state', () => {
  it('renders no active-filter chips and no pressed severity when filters are empty', () => {
    renderBar({ filters: {} });

    expect(screen.queryByTestId('active-filter-chips')).not.toBeInTheDocument();
    for (const name of [/^info$/i, /^warn$/i, /^critical$/i]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

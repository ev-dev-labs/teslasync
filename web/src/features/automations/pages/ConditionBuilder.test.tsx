/**
 * ConditionBuilder tests — covers all three exports:
 *   - CONDITION_TYPES (the condition-kind registry)
 *   - createDefaultCondition (per-kind factory + defensive fallback)
 *   - ConditionBuilder (the controlled list editor) and, transitively, the
 *     internal <ConditionFields> renderer + value-coercion helpers.
 *
 * Behaviour under test: add/remove/replace rows, kind switching, the four
 * per-kind field editors (signal / time-window / geofence / other-automation),
 * operator-driven branch swaps (bool ↔ text ↔ numeric ↔ between), null-safety
 * of `days_of_week`, geofence options sourced from the (mocked) useGeofences
 * hook, empty state, and a11y (aria-pressed day toggles, aria-labelled remove).
 *
 * Network isolation: useGeofences is mocked so no QueryClient/wire is needed.
 * i18n is stubbed to echo the English default so assertions read against
 * human-visible copy (mirrors AutomationCard.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';

// i18n stub — resolve to the provided English default, honouring both the
// `t(key, 'Default')` and `t(key, { defaultValue, ...vars })` call shapes.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      if (typeof opts === 'string') return opts || key;
      if (opts && typeof opts === 'object') {
        const out = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
        return out;
      }
      return key;
    },
  }),
}));

// The only data-fetching dependency. Default returns two geofences; individual
// tests override via mockReturnValue to exercise empty / undefined data.
vi.mock('@/api/hooks/useLocations', () => ({ useGeofences: vi.fn() }));

import { useGeofences } from '@/api/hooks/useLocations';
import { ConditionBuilder, CONDITION_TYPES, createDefaultCondition } from './ConditionBuilder';
import type { AutomationConditionStepInput } from '../components/stepInputTypes';

const mockedUseGeofences = vi.mocked(useGeofences);

function geofenceResult(data: unknown) {
  return { data } as ReturnType<typeof useGeofences>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseGeofences.mockReturnValue(
    geofenceResult([
      { id: 5, name: 'Home' },
      { id: 8, name: 'Work' },
    ]),
  );
});

/**
 * Controlled harness — ConditionBuilder is a controlled component, so we hold
 * the conditions array in state and mirror every onChange into a spy. This lets
 * multi-step interactions re-render with the updated value while still asserting
 * the exact payload the component emitted.
 */
function Harness({
  initial,
  onChange,
}: {
  initial: AutomationConditionStepInput[];
  onChange: (next: AutomationConditionStepInput[]) => void;
}) {
  const [conditions, setConditions] = useState(initial);
  return (
    <ConditionBuilder
      conditions={conditions}
      onChange={(next) => {
        setConditions(next);
        onChange(next);
      }}
    />
  );
}

function renderBuilder(initial: AutomationConditionStepInput[]) {
  const onChange = vi.fn();
  const utils = render(<Harness initial={initial} onChange={onChange} />);
  return { ...utils, onChange };
}

const signalCondition: AutomationConditionStepInput = {
  kind: 'condition_signal',
  signal: 'battery_level',
  op: '<',
  value_num: 20,
};

function lastArg(spy: ReturnType<typeof vi.fn>): AutomationConditionStepInput[] {
  return spy.mock.calls.at(-1)?.[0] as AutomationConditionStepInput[];
}

// ── CONDITION_TYPES registry ──────────────────────────────────────────────────

describe('CONDITION_TYPES', () => {
  it('lists the four supported condition kinds in canonical order', () => {
    expect(CONDITION_TYPES.map((c) => c.value)).toEqual([
      'condition_signal',
      'condition_time_window',
      'condition_geofence',
      'condition_other_automation',
    ]);
  });

  it('gives every entry a non-empty i18n key and English fallback', () => {
    expect(CONDITION_TYPES).toHaveLength(4);
    for (const entry of CONDITION_TYPES) {
      expect(entry.labelKey.startsWith('automations.conditions.')).toBe(true);
      expect(entry.fallback.length).toBeGreaterThan(0);
    }
  });
});

// ── createDefaultCondition factory ────────────────────────────────────────────

describe('createDefaultCondition', () => {
  it('builds a numeric signal check by default', () => {
    expect(createDefaultCondition('condition_signal')).toEqual({
      kind: 'condition_signal',
      signal: 'battery_level',
      op: '<',
      value_num: 20,
    });
  });

  it('builds a weekday time window (Mon–Fri) with UTC defaults', () => {
    expect(createDefaultCondition('condition_time_window')).toEqual({
      kind: 'condition_time_window',
      start_time: '06:00',
      end_time: '09:00',
      timezone: 'UTC',
      days_of_week: [1, 2, 3, 4, 5],
    });
  });

  it('builds geofence and other-automation defaults with zeroed ids', () => {
    expect(createDefaultCondition('condition_geofence')).toEqual({
      kind: 'condition_geofence',
      place_id: 0,
      state: 'inside',
    });
    expect(createDefaultCondition('condition_other_automation')).toEqual({
      kind: 'condition_other_automation',
      other_automation_id: 0,
      state: 'enabled',
    });
  });

  it('falls back to a signal condition for an unrecognized kind (never undefined)', () => {
    // Guards the declared non-optional return type at runtime.
    const result = createDefaultCondition('bogus_kind' as never);
    expect(result).toBeDefined();
    expect(result.kind).toBe('condition_signal');
  });
});

// ── Empty state + add ─────────────────────────────────────────────────────────

describe('ConditionBuilder — empty + add', () => {
  it('renders only the Add button when there are no conditions', () => {
    renderBuilder([]);
    expect(screen.getByRole('button', { name: 'Add Condition' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Signal')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove condition' })).not.toBeInTheDocument();
  });

  it('appends a default signal condition when Add is clicked', () => {
    const { onChange } = renderBuilder([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Condition' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20 },
    ]);
    // The new row now renders its signal field.
    expect(screen.getByLabelText('Signal')).toBeInTheDocument();
  });
});

// ── Remove + replace ──────────────────────────────────────────────────────────

describe('ConditionBuilder — remove + kind switch', () => {
  it('removes the targeted row via its aria-labelled remove button', () => {
    const geofence: AutomationConditionStepInput = {
      kind: 'condition_geofence',
      place_id: 5,
      state: 'inside',
    };
    const { onChange } = renderBuilder([signalCondition, geofence]);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove condition' });
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([geofence]);
    // Only one row (hence one remove button) survives.
    expect(screen.getAllByRole('button', { name: 'Remove condition' })).toHaveLength(1);
  });

  it('replaces a signal row with a fresh time-window default on kind change', () => {
    const { onChange } = renderBuilder([signalCondition]);
    fireEvent.change(screen.getByLabelText('Condition Type'), {
      target: { value: 'condition_time_window' },
    });
    expect(lastArg(onChange)).toEqual([
      {
        kind: 'condition_time_window',
        start_time: '06:00',
        end_time: '09:00',
        timezone: 'UTC',
        days_of_week: [1, 2, 3, 4, 5],
      },
    ]);
    // Day toggles now render.
    expect(screen.getByRole('button', { name: 'Mon' })).toBeInTheDocument();
  });
});

// ── Signal fields — operator variants ─────────────────────────────────────────

describe('ConditionBuilder — signal operators', () => {
  it('offers all eight operators for a numeric signal', () => {
    renderBuilder([signalCondition]);
    const opSelect = screen.getByLabelText('Operator');
    const options = within(opSelect).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['=', '!=', '<', '<=', '>', '>=', 'Between', 'In']);
  });

  it('hides numeric-only operators for a boolean signal', () => {
    renderBuilder([
      { kind: 'condition_signal', signal: 'is_locked', op: '=', value_bool: true },
    ]);
    const opSelect = screen.getByLabelText('Operator');
    const options = within(opSelect).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['=', '!=', 'In']);
    expect(options).not.toContain('Between');
  });

  it('switches to Min/Max inputs and seeds them when "between" is chosen', () => {
    const { onChange } = renderBuilder([signalCondition]);
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'between' } });
    expect(lastArg(onChange)).toEqual([
      {
        kind: 'condition_signal',
        signal: 'battery_level',
        op: 'between',
        value_min: 20,
        value_max: 100,
      },
    ]);
    expect(screen.getByLabelText('Min')).toHaveValue(20);
    expect(screen.getByLabelText('Max')).toHaveValue(100);
    expect(screen.queryByLabelText('Value')).not.toBeInTheDocument();
  });

  it('coerces the value to text when the "in" operator is selected', () => {
    const { onChange } = renderBuilder([signalCondition]);
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'in' } });
    expect(lastArg(onChange)).toEqual([
      { kind: 'condition_signal', signal: 'battery_level', op: 'in', value_text: '20' },
    ]);
    expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'text');
  });
});

// ── Signal fields — value editing per data type ───────────────────────────────

describe('ConditionBuilder — signal value editing', () => {
  it('parses a numeric value and coerces blanks to zero', () => {
    const { onChange } = renderBuilder([signalCondition]);
    const valueInput = screen.getByLabelText('Value');

    fireEvent.change(valueInput, { target: { value: '55' } });
    expect(lastArg(onChange)).toEqual([
      { kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 55 },
    ]);

    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '' } });
    expect(lastArg(onChange)).toEqual([
      { kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 0 },
    ]);
  });

  it('renders a True/False dropdown for boolean signals and writes value_bool', () => {
    const { onChange } = renderBuilder([
      { kind: 'condition_signal', signal: 'is_locked', op: '=', value_bool: true },
    ]);
    const valueSelect = screen.getByLabelText('Value');
    expect(within(valueSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'True',
      'False',
    ]);

    fireEvent.change(valueSelect, { target: { value: 'false' } });
    expect(lastArg(onChange)).toEqual([
      { kind: 'condition_signal', signal: 'is_locked', op: '=', value_bool: false },
    ]);
  });

  it('resets to a bool default when switching from a numeric to a boolean signal', () => {
    const { onChange } = renderBuilder([signalCondition]);
    fireEvent.change(screen.getByLabelText('Signal'), { target: { value: 'is_locked' } });
    expect(lastArg(onChange)).toEqual([
      { kind: 'condition_signal', signal: 'is_locked', op: '=', value_bool: true },
    ]);
  });

  it('switches to a text value with a placeholder when the "state" signal is picked', () => {
    const { onChange } = renderBuilder([signalCondition]);
    fireEvent.change(screen.getByLabelText('Signal'), { target: { value: 'state' } });
    expect(lastArg(onChange)).toEqual([
      { kind: 'condition_signal', signal: 'state', op: '=', value_text: 'online' },
    ]);
    const valueInput = screen.getByLabelText('Value');
    expect(valueInput).toHaveAttribute('type', 'text');
    expect(valueInput).toHaveAttribute('placeholder', 'online');
  });

  it('edits Min and Max independently for a between condition', () => {
    const { onChange } = renderBuilder([
      {
        kind: 'condition_signal',
        signal: 'battery_level',
        op: 'between',
        value_min: 20,
        value_max: 100,
      },
    ]);
    fireEvent.change(screen.getByLabelText('Min'), { target: { value: '5' } });
    expect(lastArg(onChange)[0]).toMatchObject({ op: 'between', value_min: 5, value_max: 100 });

    fireEvent.change(screen.getByLabelText('Max'), { target: { value: '80' } });
    expect(lastArg(onChange)[0]).toMatchObject({ op: 'between', value_max: 80 });
  });
});

// ── Time window fields ────────────────────────────────────────────────────────

describe('ConditionBuilder — time window', () => {
  function timeWindow(
    overrides: Partial<Extract<AutomationConditionStepInput, { kind: 'condition_time_window' }>> = {},
  ): AutomationConditionStepInput {
    return {
      kind: 'condition_time_window',
      start_time: '06:00',
      end_time: '09:00',
      timezone: 'UTC',
      days_of_week: [1, 2, 3, 4, 5],
      ...overrides,
    };
  }

  it('marks selected weekdays with aria-pressed and leaves the rest unpressed', () => {
    renderBuilder([timeWindow()]);
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fri' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a day (sorted numerically) when an unpressed toggle is clicked', () => {
    const { onChange } = renderBuilder([timeWindow()]);
    fireEvent.click(screen.getByRole('button', { name: 'Sun' }));
    expect(lastArg(onChange)[0]).toMatchObject({ days_of_week: [0, 1, 2, 3, 4, 5] });
  });

  it('removes a day when an already-pressed toggle is clicked', () => {
    const { onChange } = renderBuilder([timeWindow()]);
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    expect(lastArg(onChange)[0]).toMatchObject({ days_of_week: [2, 3, 4, 5] });
  });

  it('edits the start time, end time and timezone', () => {
    const { onChange } = renderBuilder([timeWindow()]);
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '07:30' } });
    expect(lastArg(onChange)[0]).toMatchObject({ start_time: '07:30' });

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '10:15' } });
    expect(lastArg(onChange)[0]).toMatchObject({ end_time: '10:15' });

    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'America/New_York' } });
    expect(lastArg(onChange)[0]).toMatchObject({ timezone: 'America/New_York' });
  });

  it('is null-safe when days_of_week is missing (renders without crashing)', () => {
    const { onChange } = renderBuilder([
      timeWindow({ days_of_week: undefined as unknown as number[] }),
    ]);
    // All seven toggles render, none pressed — no `.includes` on undefined crash.
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const name of dayNames) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    expect(lastArg(onChange)[0]).toMatchObject({ days_of_week: [3] });
  });
});

// ── Geofence fields ───────────────────────────────────────────────────────────

describe('ConditionBuilder — geofence', () => {
  const geofence: AutomationConditionStepInput = {
    kind: 'condition_geofence',
    place_id: 0,
    state: 'inside',
  };

  it('populates the geofence dropdown from the useGeofences hook', () => {
    renderBuilder([geofence]);
    const select = screen.getByLabelText('Geofence');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Select geofence...',
      'Home',
      'Work',
    ]);
  });

  it('writes the selected place_id and geofence state', () => {
    const { onChange } = renderBuilder([geofence]);
    fireEvent.change(screen.getByLabelText('Geofence'), { target: { value: '8' } });
    expect(lastArg(onChange)[0]).toMatchObject({ place_id: 8, state: 'inside' });

    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'outside' } });
    expect(lastArg(onChange)[0]).toMatchObject({ state: 'outside' });
  });

  it('degrades to just the placeholder when the geofence list is undefined', () => {
    mockedUseGeofences.mockReturnValue(geofenceResult(undefined));
    renderBuilder([geofence]);
    const select = screen.getByLabelText('Geofence');
    expect(within(select).getAllByRole('option')).toHaveLength(1);
    expect(within(select).getByRole('option')).toHaveTextContent('Select geofence...');
  });
});

// ── Other-automation fields ───────────────────────────────────────────────────

describe('ConditionBuilder — other automation', () => {
  const other: AutomationConditionStepInput = {
    kind: 'condition_other_automation',
    other_automation_id: 0,
    state: 'enabled',
  };

  it('parses the automation id and coerces non-numeric input to zero', () => {
    const { onChange } = renderBuilder([other]);
    const idInput = screen.getByLabelText('Automation ID');
    expect(idInput).toHaveValue(null); // 0 renders as an empty number field

    fireEvent.change(idInput, { target: { value: '42' } });
    expect(lastArg(onChange)[0]).toMatchObject({ other_automation_id: 42 });

    fireEvent.change(screen.getByLabelText('Automation ID'), { target: { value: 'abc' } });
    expect(lastArg(onChange)[0]).toMatchObject({ other_automation_id: 0 });
  });

  it('updates the tracked automation state', () => {
    const { onChange } = renderBuilder([{ ...other, other_automation_id: 3 }]);
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'recently_triggered' } });
    expect(lastArg(onChange)[0]).toMatchObject({ state: 'recently_triggered' });
  });
});

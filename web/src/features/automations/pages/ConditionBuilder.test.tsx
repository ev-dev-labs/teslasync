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
vi.mock('@/hooks/useSettings', async () => {
  const { inputPreferences } = await import('@/test/inputPreferences');
  return { useSettings: vi.fn(() => ({ settings: inputPreferences() })) };
});

import { useGeofences } from '@/api/hooks/useLocations';
import { useSettings } from '@/hooks/useSettings';
import { inputPreferences } from '@/test/inputPreferences';
import { ConditionBuilder, CONDITION_TYPES, createDefaultCondition } from './ConditionBuilder';
import type { AutomationConditionStepInput } from '../components/stepInputTypes';

const mockedUseGeofences = vi.mocked(useGeofences);

function geofenceResult(data: unknown, state: Partial<ReturnType<typeof useGeofences>> = {}) {
  return { data, ...state } as ReturnType<typeof useGeofences>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSettings).mockReturnValue({ settings: inputPreferences() } as ReturnType<typeof useSettings>);
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
    expect(screen.getByRole('button', { name: 'Add condition' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Signal')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove condition' })).not.toBeInTheDocument();
  });

  it('appends a default signal condition when Add is clicked', () => {
    const { onChange } = renderBuilder([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
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
    fireEvent.change(screen.getByLabelText('Condition type'), {
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

  it('switches to Min/Max while preserving the threshold and requiring an explicit maximum', () => {
    const { onChange } = renderBuilder([signalCondition]);
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'between' } });
    expect(lastArg(onChange)).toEqual([
      {
        kind: 'condition_signal',
        signal: 'battery_level',
        op: 'between',
        value_min: 20,
        value_max: undefined,
      },
    ]);
    expect(screen.getByLabelText('Min')).toHaveValue('20.00');
    expect(screen.getByLabelText('Max')).toHaveValue('');
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

  it('does not resurrect a cleared threshold when switching numeric operators or ranges', () => {
    const { onChange } = renderBuilder([{ ...signalCondition, value_num: undefined }]);
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '>' } });
    expect(lastArg(onChange)[0]).toMatchObject({ op: '>', value_num: undefined });
    expect(screen.getByRole('textbox', { name: /^Value/ })).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'between' } });
    expect(lastArg(onChange)[0]).toMatchObject({ value_min: undefined, value_max: undefined });
    expect(screen.getByLabelText('Min')).toHaveValue('');
    expect(screen.getByLabelText('Max')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '=' } });
    expect(lastArg(onChange)[0]).toMatchObject({ op: '=', value_num: undefined });
    expect(screen.getByRole('textbox', { name: /^Value/ })).toHaveValue('');
  });
});

// ── Signal fields — value editing per data type ───────────────────────────────

describe('ConditionBuilder — signal value editing', () => {
  it('converts preferred speed list inputs to exact canonical CSV values', () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: inputPreferences({ unit_of_length: 'mi' }),
    } as ReturnType<typeof useSettings>);
    const { onChange } = renderBuilder([{
      kind: 'condition_signal', signal: 'speed', op: 'in', value_text: '31.2928',
    }]);
    const input = screen.getByRole('textbox', { name: 'Value' });
    expect(input).toHaveValue('70.00');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '60.0001; 70' } });
    const condition = lastArg(onChange)[0];
    expect(condition.kind).toBe('condition_signal');
    if (condition.kind === 'condition_signal') {
      const values = condition.value_text?.split(',').map(Number);
      expect(values?.[0]).toBeCloseTo(26.822444704, 10);
      expect(values?.[1]).toBeCloseTo(31.2928, 10);
    }
  });

  it('converts preferred temperature bounds without rounding or repopulating blanks', () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: inputPreferences({ unit_of_temp: 'F', locale: 'de-DE', decimal_precision: 3 }),
    } as ReturnType<typeof useSettings>);
    const { onChange } = renderBuilder([{
      kind: 'condition_signal', signal: 'inside_temp', op: 'between', value_min: 20, value_max: 25,
    }]);
    const min = screen.getByLabelText('Min');
    expect(min).toHaveValue('68,000');
    expect(screen.getByLabelText('Max')).toHaveValue('77,000');
    fireEvent.focus(min);
    fireEvent.change(min, { target: { value: '68,12345' } });
    expect(lastArg(onChange)[0]).toMatchObject({ value_min: (68.12345 - 32) * 5 / 9, value_max: 25 });
    fireEvent.change(min, { target: { value: '' } });
    expect(lastArg(onChange)[0]).toMatchObject({ value_min: undefined, value_max: 25 });
    fireEvent.blur(min);
    expect(min).toHaveValue('');
  });
  it('parses a numeric value and preserves blanks as absent thresholds', () => {
    const { onChange } = renderBuilder([signalCondition]);
    const valueInput = screen.getByRole('textbox', { name: /^Value/ });

    fireEvent.change(valueInput, { target: { value: '55' } });
    expect(lastArg(onChange)).toEqual([
      { kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 55 },
    ]);

    fireEvent.change(screen.getByRole('textbox', { name: /^Value/ }), { target: { value: '' } });
    expect(lastArg(onChange)).toEqual([
      { kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: undefined },
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

  it('serializes boolean membership as a list and preserves false on return to equality', () => {
    const { onChange } = renderBuilder([
      { kind: 'condition_signal', signal: 'is_locked', op: '=', value_bool: false },
    ]);
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'in' } });
    expect(lastArg(onChange)[0]).toEqual({
      kind: 'condition_signal', signal: 'is_locked', op: 'in', value_text: 'false',
    });
    const value = screen.getByLabelText('Value');
    expect(within(value).getByRole('option', { name: 'True / False' })).toHaveValue('true,false');
    fireEvent.change(value, { target: { value: 'true,false' } });
    expect(lastArg(onChange)[0]).toEqual({
      kind: 'condition_signal', signal: 'is_locked', op: 'in', value_text: 'true,false',
    });
    fireEvent.change(value, { target: { value: 'false' } });
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '=' } });
    expect(lastArg(onChange)[0]).toEqual({
      kind: 'condition_signal', signal: 'is_locked', op: '=', value_bool: false,
    });
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

  it('keeps empty as none when the last condition weekday is removed', () => {
    const { onChange } = renderBuilder([timeWindow({
      days_of_week: [3], start_time: '23:00', end_time: '02:00', timezone: 'Europe/London',
    })]);
    const group = screen.getByRole('group', { name: 'Days' });
    fireEvent.click(within(group).getByRole('button', { name: 'Wed' }));
    expect(lastArg(onChange)[0]).toEqual(timeWindow({
      days_of_week: [], start_time: '23:00', end_time: '02:00', timezone: 'Europe/London',
    }));
    expect(within(group).getAllByRole('button')).toHaveLength(7);
    for (const button of within(group).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
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

describe('ConditionBuilder condition access and lookup trust', () => {
  const timeWindow: AutomationConditionStepInput = {
    kind: 'condition_time_window',
    start_time: '23:00',
    end_time: '02:00',
    timezone: 'Europe/London',
    days_of_week: [0, 6],
  };
  const geofence: AutomationConditionStepInput = {
    kind: 'condition_geofence',
    place_id: 8,
    state: 'dwell',
  };
  const other: AutomationConditionStepInput = {
    kind: 'condition_other_automation',
    other_automation_id: 42,
    state: 'recently_triggered',
  };

  it('labels every condition kind control with unique associations and replaces only the selected row', () => {
    const initial = [signalCondition, timeWindow, geofence, other];
    const { onChange } = renderBuilder(initial);
    const selectors = screen.getAllByRole('combobox', { name: 'Condition type' });
    expect(selectors).toHaveLength(4);
    expect(new Set(selectors.map((select) => select.id)).size).toBe(4);
    expect(selectors.map((select) => (select as HTMLSelectElement).value)).toEqual([
      'condition_signal', 'condition_time_window', 'condition_geofence', 'condition_other_automation',
    ]);
    expect(screen.getByLabelText('Start')).toHaveValue('23:00');
    expect(screen.getByRole('combobox', { name: 'Geofence' })).toHaveValue('8');
    expect(screen.getByRole('spinbutton', { name: 'Automation ID' })).toHaveValue(42);

    fireEvent.change(selectors[1], { target: { value: 'condition_geofence' } });
    expect(lastArg(onChange)).toEqual([
      signalCondition,
      { kind: 'condition_geofence', place_id: 0, state: 'inside' },
      geofence,
      other,
    ]);
    expect(screen.getAllByRole('combobox', { name: 'Condition type' })).toHaveLength(4);
  });

  it('uses full width controls and container reflow while keeping every editor and row action reachable', () => {
    renderBuilder([{
      kind: 'condition_signal', signal: 'inside_temp', op: 'between', value_min: 0, value_max: 25,
    }, timeWindow, geofence, other]);
    const controls = [
      ...screen.getAllByRole('combobox'),
      screen.getByLabelText('Min'),
      screen.getByLabelText('Max'),
      screen.getByLabelText('Start'),
      screen.getByLabelText('End'),
      screen.getByLabelText('Automation ID'),
    ];
    for (const control of controls) expect(control).toHaveClass('w-full', 'min-w-0');
    const fields = screen.getByRole('combobox', { name: 'Signal' }).parentElement?.parentElement;
    expect(fields).toHaveClass('grid', 'grid-cols-1', '@sm/condition:grid-cols-2', '@2xl/condition:grid-cols-4');
    expect(screen.getByRole('group', { name: 'Days' })).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Remove condition' })) {
      expect(button).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-9');
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByRole('button', { name: 'Add condition' })).toHaveClass('min-h-11', 'md:min-h-9');
  });

  it('shows loading without treating an unresolved lookup as empty or clearing a saved place', () => {
    mockedUseGeofences.mockReturnValue(geofenceResult(undefined, {
      isPending: true, isFetching: true, fetchStatus: 'fetching',
    }));
    const { onChange } = renderBuilder([signalCondition, geofence]);
    expect(screen.getByRole('status')).toHaveTextContent('Loading geofences…');
    const select = screen.getByRole('combobox', { name: 'Geofence' });
    expect(select).toHaveValue('8');
    expect(within(select).getByRole('option', { name: 'Unknown' })).toHaveValue('8');
    expect(screen.queryByText('No geofences configured yet')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Signal' })).toHaveValue('battery_level');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps paused unresolved lookup unknown instead of claiming empty offline or failed', () => {
    mockedUseGeofences.mockReturnValue(geofenceResult(undefined, {
      isPending: true, isFetching: false, fetchStatus: 'paused',
    }));
    const { onChange } = renderBuilder([geofence]);
    expect(screen.getByRole('status')).toHaveTextContent('Unknown');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('No geofences configured yet')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Geofence' })).toHaveValue('8');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('distinguishes confirmed empty places from an unknown saved place without changing the draft', () => {
    mockedUseGeofences.mockReturnValue(geofenceResult([], { isSuccess: true, fetchStatus: 'idle' }));
    const { onChange } = renderBuilder([geofence]);
    expect(screen.getByRole('status')).toHaveTextContent('No geofences configured yet');
    expect(screen.getByRole('combobox', { name: 'Geofence' })).toHaveValue('8');
    expect(screen.getByRole('option', { name: 'Unknown' })).toHaveValue('8');
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveValue('dwell');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers independent lookup retry after initial failure without discarding conditions or zero thresholds', () => {
    const retry = vi.fn();
    mockedUseGeofences.mockReturnValue(geofenceResult(undefined, {
      error: new Error('lookup unavailable'), isError: true, refetch: retry,
    }));
    const initial = [{ ...signalCondition, value_num: 0 }, geofence, timeWindow];
    const { onChange } = renderBuilder(initial);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load geofences');
    expect(screen.getByRole('textbox', { name: /^Value/ })).toHaveValue('0.00');
    expect(screen.getByRole('combobox', { name: 'Geofence' })).toHaveValue('8');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading places' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: 'State' }), { target: { value: 'outside' } });
    expect(lastArg(onChange)).toEqual([initial[0], { ...geofence, state: 'outside' }, timeWindow]);
  });

  it('retains named places on refresh failure and retries only the lookup without emitting draft changes', () => {
    const retry = vi.fn();
    mockedUseGeofences.mockReturnValue(geofenceResult([{ id: 8, name: 'Work' }], {
      error: new Error('refresh failed'), isError: true, refetch: retry,
      dataUpdatedAt: 1_700_000_000_000,
    }));
    const { onChange } = renderBuilder([signalCondition, geofence, other]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    const select = screen.getByRole('combobox', { name: 'Geofence' });
    expect(select).toHaveValue('8');
    expect(within(select).getByRole('option', { name: 'Work' })).toHaveValue('8');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retains paused places without an invented error or offline claim', () => {
    mockedUseGeofences.mockReturnValue(geofenceResult([{ id: 8, name: 'Work' }], {
      fetchStatus: 'paused', isFetching: false,
    }));
    const { onChange } = renderBuilder([geofence]);
    expect(screen.getByRole('status')).toHaveTextContent('Previously loaded data remains visible.');
    expect(screen.getByRole('status')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByRole('combobox', { name: 'Geofence' })).toHaveValue('8');
    expect(screen.queryByText(/offline|Could not load geofences/i)).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('recovers a missing place name without overwriting focused raw text SI thresholds or row order', () => {
    vi.mocked(useSettings).mockReturnValue({
      settings: inputPreferences({ unit_of_temp: 'F' }),
    } as ReturnType<typeof useSettings>);
    mockedUseGeofences.mockReturnValue(geofenceResult(undefined, {
      isPending: true, isFetching: true,
    }));
    const temperature: AutomationConditionStepInput = {
      kind: 'condition_signal', signal: 'inside_temp', op: 'between',
      value_min: 20.123456789, value_max: undefined,
    };
    const initial = [temperature, geofence, other];
    const onChange = vi.fn();
    const { rerender } = render(<ConditionBuilder conditions={initial} onChange={onChange} />);
    const min = screen.getByRole('textbox', { name: 'Min' });
    fireEvent.focus(min);
    fireEvent.change(min, { target: { value: '68.12345' } });
    expect(lastArg(onChange)).toEqual([
      { ...temperature, value_min: (68.12345 - 32) * 5 / 9 },
      geofence,
      other,
    ]);
    onChange.mockClear();
    mockedUseGeofences.mockReturnValue(geofenceResult([{ id: 8, name: 'Work' }]));
    rerender(<ConditionBuilder conditions={initial} onChange={onChange} />);
    expect(min).toHaveValue('68.12345');
    expect(screen.getByRole('textbox', { name: 'Max' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Geofence' })).toHaveValue('8');
    expect(screen.getByRole('option', { name: 'Work' })).toHaveValue('8');
    expect(screen.queryByRole('option', { name: 'Unknown' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(initial).toEqual([temperature, geofence, other]);
  });

  it('does not show unrelated geofence lookup failure for other condition kinds', () => {
    mockedUseGeofences.mockReturnValue(geofenceResult(undefined, {
      error: new Error('lookup failed'), isError: true,
    }));
    const { onChange } = renderBuilder([signalCondition, timeWindow, other]);
    expect(screen.queryByText('Could not load geofences')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry loading places' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: 'Condition type' })).toHaveLength(3);
    expect(onChange).not.toHaveBeenCalled();
  });
});

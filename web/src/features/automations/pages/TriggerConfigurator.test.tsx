// Behavioural contract for the automation Trigger Configurator. Exercises all
// three public exports plus every branch of the internal cron / signal helpers
// they drive:
//   - TRIGGER_TYPES: the ordered registry powering the trigger-kind dropdown.
//   - createDefaultTrigger: the seed shape for each of the four trigger kinds.
//   - TriggerConfigurator: the controlled editor rendered for the selected kind:
//       • schedule — simple time+days mode, cron round-trip (buildCronExpr /
//         parseCronExpr), the simple⇄advanced toggle, and the guard that keeps
//         non-representable crons (weekday ranges, steps) in the raw editor so
//         they are never silently flattened to "every day".
//       • event   — vehicle-event dropdown wiring.
//       • geofence — place + event selects, the conditional dwell field, and
//         the data-source loading / error / empty hints on the geofence list.
//       • signal  — signal/operator/value tri-state (numeric, boolean, string),
//         the "fire on any change" toggle, and value recovery when the operator
//         moves off `changed` (signalValueFromInput's four branches).
//   - robustness — a malformed trigger kind renders nothing instead of crashing.
//
// Repo test conventions: `@testing-library/user-event` is NOT installed here, so
// interactions go through `fireEvent`. react-i18next is mocked with a fallback
// `t` that understands both the `t(key, fallback)` and `t(key, { defaultValue })`
// signatures (the shared Input/Select/HelpIcon primitives use the latter). The
// `useGeofences` data hook is mocked so the tree never touches react-query.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  TriggerConfigurator,
  TRIGGER_TYPES,
  createDefaultTrigger,
} from './TriggerConfigurator';
import type { AutomationTriggerStepInput } from '../components/stepInputTypes';

// ── react-i18next: fallback `t` handling both call signatures. ────────────────
vi.mock('react-i18next', () => {
  const interpolate = (base: string, opts?: Record<string, unknown>): string => {
    if (!opts) return base;
    return Object.entries(opts).reduce(
      (out, [k, v]) => (k === 'defaultValue' ? out : out.replace(`{{${k}}}`, String(v))),
      base,
    );
  };
  return {
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: Record<string, unknown>) => {
        // t(key, { defaultValue, ...opts }) — used by HelpIcon / a11y labels.
        if (second !== null && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const base = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(base, opts);
        }
        // t(key, fallbackString, opts?) — the common form used by the component.
        const base = typeof second === 'string' ? second : key;
        return interpolate(base, third);
      },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── useGeofences: mocked data hook (no react-query in the render tree). ────────
const h = vi.hoisted(() => ({ useGeofences: vi.fn() }));
vi.mock('@/api/hooks/useLocations', () => ({ useGeofences: h.useGeofences }));

function mockGeofences(state: { data?: unknown; isLoading?: boolean; isError?: boolean }) {
  h.useGeofences.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  });
}

beforeEach(() => {
  mockGeofences({ data: [{ id: 10, name: 'Home' }, { id: 20, name: 'Work' }] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderConfig(trigger: AutomationTriggerStepInput) {
  const onChange = vi.fn();
  const result = render(<TriggerConfigurator trigger={trigger} onChange={onChange} />);
  return { onChange, ...result };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER_TYPES registry
// ─────────────────────────────────────────────────────────────────────────────
describe('TRIGGER_TYPES', () => {
  it('lists the four trigger kinds in the expected order', () => {
    expect(TRIGGER_TYPES.map((tt) => tt.value)).toEqual([
      'trigger_schedule',
      'trigger_event',
      'trigger_geofence',
      'trigger_signal',
    ]);
  });

  it('carries an i18n key, an English fallback, and an icon for every entry', () => {
    expect(TRIGGER_TYPES).toHaveLength(4);
    for (const entry of TRIGGER_TYPES) {
      expect(entry.labelKey.startsWith('automations.builder.trigger')).toBe(true);
      expect(entry.fallback.length).toBeGreaterThan(0);
      expect(typeof entry.icon).toBe('object');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createDefaultTrigger
// ─────────────────────────────────────────────────────────────────────────────
describe('createDefaultTrigger', () => {
  it('seeds a daily 08:00 UTC schedule', () => {
    expect(createDefaultTrigger('trigger_schedule')).toEqual({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * *',
      timezone: 'UTC',
    });
  });

  it('seeds an online vehicle event', () => {
    expect(createDefaultTrigger('trigger_event')).toEqual({
      kind: 'trigger_event',
      event_type: 'online',
    });
  });

  it('seeds an enter geofence with an unset place', () => {
    expect(createDefaultTrigger('trigger_geofence')).toEqual({
      kind: 'trigger_geofence',
      place_id: 0,
      event: 'enter',
    });
  });

  it('seeds a battery-level < 20 numeric signal', () => {
    expect(createDefaultTrigger('trigger_signal')).toEqual({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: '<',
      value_num: 20,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schedule branch
// ─────────────────────────────────────────────────────────────────────────────
describe('TriggerConfigurator — schedule (simple mode)', () => {
  it('renders the time picker seeded from the cron and 7 day toggles', () => {
    renderConfig(createDefaultTrigger('trigger_schedule'));
    expect(screen.getByLabelText('Time')).toHaveValue('08:00');
    expect(screen.queryByLabelText('Cron Expression')).toBeNull();
    // Every day is "on" when the cron day-of-week field is '*'.
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(screen.getByRole('button', { name: day })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('rebuilds the cron minute/hour when the time changes', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_schedule'));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:30' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_schedule',
      cron_expr: '30 9 * * *',
      timezone: 'UTC',
    });
  });

  it('keeps the current hour/minute when the time input is cleared (NaN guard)', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_schedule'));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '' } });
    // Empty value must not corrupt the cron to "NaN NaN * * *".
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * *',
      timezone: 'UTC',
    });
  });

  it('deselecting a day from "all" writes the remaining six days', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_schedule'));
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * 0,1,2,4,5,6',
      timezone: 'UTC',
    });
  });

  it('reflects an explicit multi-day cron in the day toggles', () => {
    renderConfig({ kind: 'trigger_schedule', cron_expr: '0 8 * * 1,2,3', timezone: 'UTC' });
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Thu' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a day to an explicit selection (sorted)', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * 1,2,3',
      timezone: 'UTC',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fri' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * 1,2,3,5',
      timezone: 'UTC',
    });
  });

  it('normalises a full week back to the "*" day-of-week', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * 0,1,2,3,4,5',
      timezone: 'UTC',
    });
    // Selecting the final missing day (Sat) makes all 7 → collapses to '*'.
    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * *',
      timezone: 'UTC',
    });
  });

  it('updates the timezone via its select', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * *',
      timezone: 'America/New_York',
    });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Europe/London' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * *',
      timezone: 'Europe/London',
    });
  });
});

describe('TriggerConfigurator — schedule (advanced cron)', () => {
  it('reveals the raw cron editor when "Use advanced cron expression" is clicked', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_schedule'));
    expect(screen.getByLabelText('Time')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use advanced cron expression' }));

    // The bug this guards: the button previously re-emitted the same cron and
    // never actually switched modes. It must now surface the raw editor.
    expect(screen.getByLabelText('Cron Expression')).toHaveValue('0 8 * * *');
    expect(screen.queryByLabelText('Time')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('edits the cron expression directly in advanced mode', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_schedule'));
    fireEvent.click(screen.getByRole('button', { name: 'Use advanced cron expression' }));
    fireEvent.change(screen.getByLabelText('Cron Expression'), {
      target: { value: '*/15 * * * *' },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_schedule',
      cron_expr: '*/15 * * * *',
      timezone: 'UTC',
    });
  });

  it('keeps a weekday-range cron in the raw editor instead of flattening it', () => {
    // Regression: parseCronExpr used to accept "1-5", producing days=[] which
    // the simple UI shows as "every day" — silently changing the schedule.
    renderConfig({ kind: 'trigger_schedule', cron_expr: '0 8 * * 1-5', timezone: 'UTC' });
    expect(screen.getByLabelText('Cron Expression')).toHaveValue('0 8 * * 1-5');
    expect(screen.queryByLabelText('Time')).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to simple mode' })).toBeInTheDocument();
  });

  it('keeps a step-based minute cron in the raw editor', () => {
    renderConfig({ kind: 'trigger_schedule', cron_expr: '*/15 9 * * *', timezone: 'UTC' });
    expect(screen.getByLabelText('Cron Expression')).toHaveValue('*/15 9 * * *');
    expect(screen.queryByLabelText('Time')).toBeNull();
  });

  it('resets an unparseable cron to the default when switching back to simple mode', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_schedule',
      cron_expr: '*/15 * * * *',
      timezone: 'UTC',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to simple mode' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_schedule',
      cron_expr: '0 8 * * *',
      timezone: 'UTC',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event branch
// ─────────────────────────────────────────────────────────────────────────────
describe('TriggerConfigurator — event', () => {
  it('renders the event select seeded from the trigger', () => {
    renderConfig({ kind: 'trigger_event', event_type: 'online' });
    expect(screen.getByLabelText('Event')).toHaveValue('online');
    expect(screen.getByRole('option', { name: 'Charging Starts' })).toBeInTheDocument();
  });

  it('emits the chosen event type', () => {
    const { onChange } = renderConfig({ kind: 'trigger_event', event_type: 'online' });
    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'drive_start' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'trigger_event', event_type: 'drive_start' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Geofence branch
// ─────────────────────────────────────────────────────────────────────────────
describe('TriggerConfigurator — geofence', () => {
  it('lists mocked geofences and selects one by id', () => {
    const { onChange } = renderConfig({ kind: 'trigger_geofence', place_id: 0, event: 'enter' });
    expect(screen.getByRole('option', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Work' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Geofence'), { target: { value: '20' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_geofence',
      place_id: 20,
      event: 'enter',
    });
  });

  it('clears the place back to 0 when the empty option is chosen', () => {
    const { onChange } = renderConfig({ kind: 'trigger_geofence', place_id: 20, event: 'enter' });
    fireEvent.change(screen.getByLabelText('Geofence'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'trigger_geofence', place_id: 0, event: 'enter' });
  });

  it('defaults dwell minutes when the event switches to dwell', () => {
    const { onChange } = renderConfig({ kind: 'trigger_geofence', place_id: 10, event: 'enter' });
    expect(screen.queryByLabelText('Dwell Minutes')).toBeNull();
    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'dwell' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_geofence',
      place_id: 10,
      event: 'dwell',
      dwell_minutes: 5,
    });
  });

  it('shows and edits the dwell field for a dwell trigger', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_geofence',
      place_id: 10,
      event: 'dwell',
      dwell_minutes: 15,
    });
    const dwell = screen.getByLabelText('Dwell Minutes');
    expect(dwell).toHaveValue(15);
    fireEvent.change(dwell, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_geofence',
      place_id: 10,
      event: 'dwell',
      dwell_minutes: 30,
    });
  });

  it('floors an emptied dwell field to 1 minute', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_geofence',
      place_id: 10,
      event: 'dwell',
      dwell_minutes: 15,
    });
    fireEvent.change(screen.getByLabelText('Dwell Minutes'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_geofence',
      place_id: 10,
      event: 'dwell',
      dwell_minutes: 1,
    });
  });

  it('does not surface a hint when geofences are available', () => {
    renderConfig({ kind: 'trigger_geofence', place_id: 0, event: 'enter' });
    expect(screen.queryByText('No geofences configured yet')).toBeNull();
    expect(screen.queryByText('Loading geofences…')).toBeNull();
  });

  it('shows a loading hint while geofences resolve', () => {
    mockGeofences({ data: undefined, isLoading: true });
    renderConfig({ kind: 'trigger_geofence', place_id: 0, event: 'enter' });
    expect(screen.getByText('Loading geofences…')).toBeInTheDocument();
    // Null-safety: an undefined list must not crash the select.
    expect(screen.getByLabelText('Geofence')).toBeInTheDocument();
  });

  it('shows an error hint when the geofence request fails', () => {
    mockGeofences({ data: undefined, isError: true });
    renderConfig({ kind: 'trigger_geofence', place_id: 0, event: 'enter' });
    expect(screen.getByText('Could not load geofences')).toBeInTheDocument();
  });

  it('shows an empty hint when no geofences exist', () => {
    mockGeofences({ data: [] });
    renderConfig({ kind: 'trigger_geofence', place_id: 0, event: 'enter' });
    expect(screen.getByText('No geofences configured yet')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Signal branch
// ─────────────────────────────────────────────────────────────────────────────
describe('TriggerConfigurator — signal (numeric)', () => {
  it('renders signal/operator/value controls and an unchecked change toggle', () => {
    renderConfig(createDefaultTrigger('trigger_signal'));
    expect(screen.getByLabelText('Signal')).toHaveValue('battery_level');
    expect(screen.getByLabelText('Operator')).toHaveValue('<');
    expect(screen.getByLabelText('Value')).toHaveValue(20);
    expect(screen.getByRole('switch', { name: 'Fire on any change' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('writes a numeric value on change', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_signal'));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: '<',
      value_num: 42,
    });
  });

  it('coerces an emptied numeric value to 0', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_signal'));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: '<',
      value_num: 0,
    });
  });
});

describe('TriggerConfigurator — signal (operator + change toggle)', () => {
  it('drops the value when the operator becomes "changed"', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_signal'));
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'changed' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: 'changed',
    });
  });

  it('hides the value control and checks the toggle for a "changed" trigger', () => {
    renderConfig({ kind: 'trigger_signal', signal: 'battery_level', op: 'changed' });
    expect(screen.queryByLabelText('Value')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Fire on any change' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('recovers a numeric value when the operator moves off "changed"', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: 'changed',
    });
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '>' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: '>',
      value_num: 20,
    });
  });

  it('enables "changed" when the toggle is switched on', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_signal'));
    fireEvent.click(screen.getByRole('switch', { name: 'Fire on any change' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: 'changed',
    });
  });

  it('restores an "=" comparison when the toggle is switched off', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: 'changed',
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Fire on any change' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'battery_level',
      op: '=',
      value_num: 20,
    });
  });
});

describe('TriggerConfigurator — signal (boolean + string variants)', () => {
  it('switches to a boolean value when a boolean signal is chosen', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_signal'));
    fireEvent.change(screen.getByLabelText('Signal'), { target: { value: 'is_locked' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'is_locked',
      op: '=',
      value_bool: true,
    });
  });

  it('renders a true/false select and writes value_bool for a boolean signal', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_signal',
      signal: 'is_locked',
      op: '=',
      value_bool: true,
    });
    const value = screen.getByLabelText('Value');
    expect(within(value as HTMLElement).getByRole('option', { name: 'False' })).toBeInTheDocument();
    fireEvent.change(value, { target: { value: 'false' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'is_locked',
      op: '=',
      value_bool: false,
    });
  });

  it('switches to a text value when the vehicle-state signal is chosen', () => {
    const { onChange } = renderConfig(createDefaultTrigger('trigger_signal'));
    fireEvent.change(screen.getByLabelText('Signal'), { target: { value: 'state' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'state',
      op: '=',
      value_text: 'online',
    });
  });

  it('renders a text value input and writes value_text for the state signal', () => {
    const { onChange } = renderConfig({
      kind: 'trigger_signal',
      signal: 'state',
      op: '=',
      value_text: 'online',
    });
    const value = screen.getByLabelText('Value');
    expect(value).toHaveAttribute('type', 'text');
    fireEvent.change(value, { target: { value: 'driving' } });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'trigger_signal',
      signal: 'state',
      op: '=',
      value_text: 'driving',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Robustness
// ─────────────────────────────────────────────────────────────────────────────
describe('TriggerConfigurator — robustness', () => {
  it('renders nothing (no crash) for an unknown trigger kind', () => {
    const bogus = { kind: 'trigger_bogus' } as unknown as AutomationTriggerStepInput;
    const { container } = renderConfig(bogus);
    expect(container.firstChild).toBeNull();
  });
});

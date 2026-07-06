/**
 * `<SnapshotInspector>` contract tests.
 *
 * The inspector is the right-rail of the FSM debugger. Its behaviour is
 * state-machine-like: which of the {loading, outside-window, empty, populated}
 * surfaces it renders depends on the interplay of `transition`, `loading`,
 * `snapshot`, `inWindowCount` and `lastTransition`. These tests pin every
 * branch, the signal diff/dim/highlight rendering, value formatting, the copy
 * payload, and the a11y affordances.
 *
 * A dedicated block guards the loading-vs-empty regression: when a transition
 * is selected but its snapshot is still being fetched, the signals section must
 * show a loading state — NOT the definitive "no signals captured" message.
 *
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven via `fireEvent`, matching the sibling component tests.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SnapshotInspector } from './SnapshotInspector';
import type { FSMTransition } from '@/types/fsm';
import type { SignalSnapshotResponse } from '@/api/hooks/useTelemetry';

// Deterministic i18n: two-arg form returns the default; an options bag
// interpolates `{{name}}` placeholders. Mirrors the mock used across this tree.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts) {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) {
            s = s.replace(`{{${k}}}`, String(v));
          }
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
  }),
}));

function makeTransition(overrides: Partial<FSMTransition> = {}): FSMTransition {
  return {
    id: 1,
    vehicle_id: 1,
    fsm_name: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_changed',
    ts: new Date().toISOString(),
    ...overrides,
  };
}

type Signals = SignalSnapshotResponse['signals'];

function makeSnapshot(signals: Signals, at = '2025-01-15T12:00:00Z'): SignalSnapshotResponse {
  return {
    vehicle_id: 1,
    at,
    count: Object.keys(signals).length,
    signals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('SnapshotInspector — no transition selected', () => {
  it('shows the "select a transition" empty state when nothing is selectable', () => {
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={null}
        snapshot={null}
        previousSnapshot={null}
        loading={false}
        lastTransition={null}
        inWindowCount={0}
      />,
    );
    const empty = screen.getByTestId('snapshot-inspector-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('Select a transition to inspect its snapshot');
    expect(screen.queryByTestId('snapshot-inspector-outside-window')).toBeNull();
    expect(screen.queryByTestId('snapshot-inspector-loading')).toBeNull();
  });

  it('shows the loading placeholder when loading and no transition is selected', () => {
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={null}
        snapshot={null}
        previousSnapshot={null}
        loading
        lastTransition={makeTransition({ id: 3 })}
        inWindowCount={0}
        onJumpToLast={() => undefined}
      />,
    );
    // Loading takes precedence over the outside-window affordance.
    expect(screen.getByTestId('snapshot-inspector-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-inspector-outside-window')).toBeNull();
    expect(screen.queryByTestId('snapshot-inspector-empty')).toBeNull();
  });

  it('surfaces the "jump to last transition" affordance when the window is empty but a last transition exists', () => {
    const last = makeTransition({ id: 7, ts: new Date(Date.now() - 10 * 60_000).toISOString() });
    const onJump = vi.fn();
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={null}
        snapshot={null}
        previousSnapshot={null}
        loading={false}
        lastTransition={last}
        inWindowCount={0}
        onJumpToLast={onJump}
      />,
    );
    const banner = screen.getByTestId('snapshot-inspector-outside-window');
    expect(banner.textContent).toContain('Nothing in the current window');

    fireEvent.click(screen.getByTestId('snapshot-inspector-jump'));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('does NOT offer the jump affordance while transitions are still inside the window', () => {
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={null}
        snapshot={null}
        previousSnapshot={null}
        loading={false}
        lastTransition={makeTransition({ id: 7 })}
        inWindowCount={5}
        onJumpToLast={() => undefined}
      />,
    );
    expect(screen.getByTestId('snapshot-inspector-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-inspector-jump')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SnapshotInspector — transition metadata', () => {
  it('renders the from/to states, trigger and formatted duration', () => {
    const tr = makeTransition({
      id: 9,
      from_state: 'parked',
      to_state: 'driving',
      trigger: 'manual_select',
      details: { duration_in_state_ms: 1500 },
    });
    render(
      <SnapshotInspector fsmType="vehicle" transition={tr} snapshot={null} loading={false} />,
    );
    expect(screen.getByText('Transition snapshot')).toBeInTheDocument();
    expect(screen.getByText('parked')).toBeInTheDocument();
    expect(screen.getByText('driving')).toBeInTheDocument();
    expect(screen.getByText('manual_select')).toBeInTheDocument();
    // fmtInt applies locale separators; the unit is appended after the value.
    const duration = screen.getByText('Duration').closest('div');
    expect(duration?.textContent).toContain('1,500 ms');
  });

  it('renders an em-dash for a missing trigger and a missing duration', () => {
    const tr = makeTransition({ id: 10, trigger: '', details: null });
    render(
      <SnapshotInspector fsmType="vehicle" transition={tr} snapshot={null} loading={false} />,
    );
    const trigger = screen.getByText('Trigger').closest('div');
    expect(trigger?.textContent).toContain('—');
    const duration = screen.getByText('Duration').closest('div');
    expect(duration?.textContent).toContain('— ms');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SnapshotInspector — signals list', () => {
  it('formats every signal value type and annotates it with a source badge', () => {
    const snap = makeSnapshot({
      bool_signal: { value: true, source: 'l1' },
      num_signal: { value: 42.5, source: 'l1' },
      str_signal: { value: 'hello', source: 'l2' },
      null_signal: { value: null, source: 'log' },
      obj_signal: { value: { nested: 1 }, source: 'l1' },
    });
    const tr = makeTransition({ id: 11 });
    render(
      <SnapshotInspector fsmType="vehicle" transition={tr} snapshot={snap} loading={false} />,
    );

    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('42.5')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('{"nested":1}')).toBeInTheDocument();
    // null renders the universal placeholder inside its own row.
    expect(screen.getByText('null_signal').closest('li')?.textContent).toContain('—');
    // One source-layer badge per signal.
    expect(screen.getAllByTestId('source-layer-badge')).toHaveLength(5);
  });

  it('sorts signals alphabetically by name regardless of insertion order', () => {
    const snap = makeSnapshot({
      zebra: { value: 1, source: 'l1' },
      alpha: { value: 2, source: 'l1' },
      mike: { value: 3, source: 'l1' },
    });
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={makeTransition({ id: 12 })}
        snapshot={snap}
        loading={false}
      />,
    );
    const names = screen.getAllByRole('listitem').map((li) => {
      // The first line of each row is the signal name (font-mono).
      return li.querySelector('.font-mono')?.textContent ?? '';
    });
    expect(names).toEqual(['alpha', 'mike', 'zebra']);
  });

  it('exposes the signals list as a labelled region for assistive tech', () => {
    const snap = makeSnapshot({ speed: { value: 10, source: 'l1' } });
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={makeTransition({ id: 13 })}
        snapshot={snap}
        loading={false}
      />,
    );
    const list = screen.getByRole('list', { name: 'Signals at transition' });
    expect(list).toBeInTheDocument();
    expect(within(list).getByText('speed')).toBeInTheDocument();
  });

  it('shows the "no signals" empty state for a snapshot with an empty signal map', () => {
    const snap = makeSnapshot({});
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={makeTransition({ id: 14 })}
        snapshot={snap}
        loading={false}
      />,
    );
    expect(screen.getByTestId('snapshot-inspector-no-signals')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SnapshotInspector — diff mode', () => {
  const current = makeSnapshot({
    speed: { value: 25, source: 'l1' },
    battery: { value: 80, source: 'l1' },
  });
  const previous = makeSnapshot(
    {
      speed: { value: 10, source: 'l1' },
      battery: { value: 80, source: 'l1' },
    },
    '2025-01-15T11:59:00Z',
  );

  it('does not compute diffs until diff mode is toggled on', () => {
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={makeTransition({ id: 20 })}
        snapshot={current}
        previousSnapshot={previous}
        loading={false}
      />,
    );
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    // The previous (strikethrough) value is hidden until diff mode is active.
    expect(screen.queryByText('10')).toBeNull();
  });

  it('dims unchanged signals and highlights changed ones with a strikethrough previous value', () => {
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={makeTransition({ id: 21 })}
        snapshot={current}
        previousSnapshot={previous}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByRole('switch'));

    const speedRow = screen.getByText('speed').closest('li');
    const batteryRow = screen.getByText('battery').closest('li');
    // speed changed 10 -> 25: highlighted, not dimmed.
    expect(speedRow?.className).toContain('border-amber-400/30');
    expect(speedRow?.className).not.toContain('opacity-40');
    // battery unchanged: dimmed.
    expect(batteryRow?.className).toContain('opacity-40');

    // The prior value is now shown struck-through on the changed row.
    const prior = screen.getByText('10');
    expect(prior.className).toContain('line-through');
    expect(speedRow).toContainElement(prior);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SnapshotInspector — loading vs empty (regression)', () => {
  it('shows a loading state — not "no signals" — while a selected transition is fetching its snapshot', () => {
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={makeTransition({ id: 30, trigger: 'drive_start' })}
        snapshot={null}
        previousSnapshot={null}
        loading
      />,
    );
    expect(screen.getByTestId('snapshot-inspector-signals-loading')).toBeInTheDocument();
    // The bug: this must NOT be the definitive empty message during a fetch.
    expect(screen.queryByTestId('snapshot-inspector-no-signals')).toBeNull();
    // Known metadata is still shown while the snapshot loads.
    expect(screen.getByText('drive_start')).toBeInTheDocument();
  });

  it('keeps rendering the existing signals during a background refetch (loading with a snapshot present)', () => {
    const snap = makeSnapshot({ speed: { value: 42, source: 'l1' } });
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={makeTransition({ id: 31 })}
        snapshot={snap}
        loading
      />,
    );
    // A snapshot is present, so the list — not the loading placeholder — renders.
    expect(screen.queryByTestId('snapshot-inspector-signals-loading')).toBeNull();
    expect(screen.getByText('speed')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SnapshotInspector — copy payload', () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('hides the copy affordance until a snapshot is available', () => {
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={makeTransition({ id: 40 })}
        snapshot={null}
        loading={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Copy snapshot' })).toBeNull();
  });

  it('copies the transition + signals + timestamp as pretty-printed JSON', async () => {
    const tr = makeTransition({ id: 41, trigger: 'manual' });
    const snap = makeSnapshot({ speed: { value: 25, source: 'l1', age_ms: 100 } });
    render(
      <SnapshotInspector fsmType="vehicle" transition={tr} snapshot={snap} loading={false} />,
    );

    const btn = screen.getByRole('button', { name: 'Copy snapshot' });
    fireEvent.click(btn);

    const expected = JSON.stringify(
      { transition: tr, snapshot: snap.signals, at: snap.at },
      null,
      2,
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expected);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SnapshotInspector } from '../SnapshotInspector';
import type { FSMTransition } from '@/types/fsm';

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

function makeTransition(overrides: Partial<FSMTransition>): FSMTransition {
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

describe('SnapshotInspector empty state (Phase 45 / Prompt 35)', () => {
  it('renders the "outside window" hint + Jump button when nothing is in the window but a last transition exists', () => {
    const last = makeTransition({
      id: 7,
      ts: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
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
    const empty = screen.getByTestId('snapshot-inspector-outside-window');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('Nothing in the current window');
    expect(empty.textContent).toContain('Last transition');
    const jump = screen.getByTestId('snapshot-inspector-jump');
    expect(jump.textContent).toContain('Jump to last transition');
    fireEvent.click(jump);
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original "select a transition" message when selectable data is in the window', () => {
    const last = makeTransition({
      id: 7,
      ts: new Date(Date.now() - 60_000).toISOString(),
    });
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={null}
        snapshot={null}
        previousSnapshot={null}
        loading={false}
        lastTransition={last}
        inWindowCount={5}
        onJumpToLast={() => undefined}
      />,
    );
    const empty = screen.getByTestId('snapshot-inspector-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('Select a transition to inspect its snapshot');
    expect(screen.queryByTestId('snapshot-inspector-outside-window')).toBeNull();
    expect(screen.queryByTestId('snapshot-inspector-jump')).toBeNull();
  });

  it('renders the loading state regardless of last-transition / in-window props', () => {
    const last = makeTransition({
      id: 7,
      ts: new Date(Date.now() - 60_000).toISOString(),
    });
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={null}
        snapshot={null}
        previousSnapshot={null}
        loading={true}
        lastTransition={last}
        inWindowCount={0}
        onJumpToLast={() => undefined}
      />,
    );
    expect(screen.getByTestId('snapshot-inspector-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-inspector-outside-window')).toBeNull();
    expect(screen.queryByTestId('snapshot-inspector-empty')).toBeNull();
  });

  it('renders the snapshot view (regression) when a transition is selected', () => {
    const tr = makeTransition({ id: 9, trigger: 'manual_select' });
    render(
      <SnapshotInspector
        fsmType="vehicle"
        transition={tr}
        snapshot={null}
        previousSnapshot={null}
        loading={false}
        lastTransition={null}
        inWindowCount={1}
      />,
    );
    expect(screen.queryByTestId('snapshot-inspector-empty')).toBeNull();
    expect(screen.queryByTestId('snapshot-inspector-outside-window')).toBeNull();
    expect(screen.queryByTestId('snapshot-inspector-loading')).toBeNull();
    // Spot-check the always-rendered transition metadata
    expect(screen.getByText('Transition snapshot')).toBeInTheDocument();
    expect(screen.getByText('manual_select')).toBeInTheDocument();
  });

  it('renders the original empty message when no last transition is available', () => {
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
    expect(screen.getByTestId('snapshot-inspector-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-inspector-outside-window')).toBeNull();
  });
});

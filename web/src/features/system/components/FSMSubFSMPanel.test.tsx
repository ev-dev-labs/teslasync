import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FSMSubFSMPanel } from './FSMSubFSMPanel';
import type { ActiveSubFSM } from '@/types/fsm';

// Deterministic i18n: echo the provided fallback so text/label assertions
// read the literal default strings instead of depending on the runtime
// translation catalogue (repo convention — see CommandTile / StateTimeline).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

// Stub the StateBadge child so we can assert exactly which fsmType + state
// the panel forwards, without depending on the FSM colour registry.
vi.mock('./StateBadge', () => ({
  StateBadge: ({ state, fsmType }: { state: string; fsmType: string }) => (
    <span data-testid="state-badge" data-state={state} data-fsm-type={fsmType}>
      {state}
    </span>
  ),
}));

// Stub TimeStamp — the real one reaches useSettings (react-query) via
// useTimeFormatPreference and needs a QueryClientProvider. Rendering the
// raw value lets us assert the panel forwards `sub.start_time` verbatim.
vi.mock('@/components/data-display/TimeStamp', () => ({
  TimeStamp: ({ value }: { value: unknown }) => (
    <span data-testid="timestamp">{String(value)}</span>
  ),
}));

function makeSub(overrides: Partial<ActiveSubFSM> = {}): ActiveSubFSM {
  return {
    type: 'drive',
    state: 'active',
    start_time: '2025-01-15T12:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('FSMSubFSMPanel', () => {
  it('renders nothing unless viewing vehicle-level FSMs (vehicle | all)', () => {
    const { container, rerender } = render(
      <FSMSubFSMPanel fsmType="telemetry_connection" activeSubs={[makeSub()]} />,
    );
    // Non-vehicle scope short-circuits to null even with live subs present.
    expect(container).toBeEmptyDOMElement();

    rerender(<FSMSubFSMPanel fsmType="" activeSubs={[makeSub()]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the empty state (heading + status message) when there are no active subs', () => {
    render(<FSMSubFSMPanel fsmType="vehicle" activeSubs={[]} />);

    expect(screen.getByText('Active Sub-FSMs')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No active drive or charge sessions');
    // No session rows render in the empty branch.
    expect(screen.queryByTestId('state-badge')).toBeNull();
  });

  it('treats a missing activeSubs prop as empty without crashing (null-safety + "all" scope)', () => {
    render(<FSMSubFSMPanel fsmType="all" />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'No active drive or charge sessions',
    );
    expect(screen.queryByTestId('timestamp')).toBeNull();
  });

  it('renders an active drive session: label, drive_session badge, Live cue and forwarded start_time', () => {
    render(
      <FSMSubFSMPanel
        fsmType="vehicle"
        activeSubs={[
          makeSub({ type: 'drive', state: 'active', start_time: '2025-02-01T08:30:00Z' }),
        ]}
      />,
    );

    expect(screen.getByText('Drive Session')).toBeInTheDocument();

    const badge = screen.getByTestId('state-badge');
    expect(badge).toHaveAttribute('data-fsm-type', 'drive_session');
    expect(badge).toHaveAttribute('data-state', 'active');

    // The colour-only "active" indicator now has a text alternative for
    // assistive tech (WCAG 1.4.1 use-of-color).
    expect(screen.getByText('Live')).toBeInTheDocument();

    // start_time is forwarded verbatim to the TimeStamp child.
    expect(screen.getByTestId('timestamp')).toHaveTextContent('2025-02-01T08:30:00Z');
  });

  it('marks the decorative session icon aria-hidden so screen readers skip it', () => {
    const { container } = render(
      <FSMSubFSMPanel fsmType="vehicle" activeSubs={[makeSub({ type: 'drive' })]} />,
    );

    // Badge + timestamp are stubbed to plain spans, so the only <svg> is
    // the decorative Car/Zap glyph.
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a terminal charge session (done) as idle: charge_session badge and no Live cue', () => {
    render(
      <FSMSubFSMPanel
        fsmType="vehicle"
        activeSubs={[makeSub({ type: 'charge', state: 'done' })]}
      />,
    );

    expect(screen.getByText('Charge Session')).toBeInTheDocument();
    expect(screen.getByTestId('state-badge')).toHaveAttribute(
      'data-fsm-type',
      'charge_session',
    );
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('treats drive states completed and recovered as terminal (no Live cue)', () => {
    for (const state of ['completed', 'recovered'] as const) {
      const { unmount } = render(
        <FSMSubFSMPanel fsmType="vehicle" activeSubs={[makeSub({ type: 'drive', state })]} />,
      );
      expect(screen.queryByText('Live')).toBeNull();
      expect(screen.getByTestId('state-badge')).toHaveTextContent(state);
      unmount();
    }
  });

  it('treats charge states done and recovered as terminal (no Live cue)', () => {
    for (const state of ['done', 'recovered'] as const) {
      const { unmount } = render(
        <FSMSubFSMPanel fsmType="vehicle" activeSubs={[makeSub({ type: 'charge', state })]} />,
      );
      expect(screen.queryByText('Live')).toBeNull();
      unmount();
    }
  });

  it('shows the Live cue for every non-terminal drive and charge state', () => {
    const cases: Array<{ type: ActiveSubFSM['type']; state: string }> = [
      { type: 'drive', state: 'pending' },
      { type: 'drive', state: 'ending' },
      { type: 'charge', state: 'pending' },
      { type: 'charge', state: 'completing' },
    ];
    for (const c of cases) {
      const { unmount } = render(
        <FSMSubFSMPanel fsmType="vehicle" activeSubs={[makeSub(c)]} />,
      );
      expect(screen.getByText('Live')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders both a drive and a charge sub-FSM together, in order', () => {
    render(
      <FSMSubFSMPanel
        fsmType="vehicle"
        activeSubs={[
          makeSub({ type: 'drive', state: 'active', start_time: '2025-03-01T00:00:00Z' }),
          makeSub({ type: 'charge', state: 'active', start_time: '2025-03-01T01:00:00Z' }),
        ]}
      />,
    );

    expect(screen.getByText('Drive Session')).toBeInTheDocument();
    expect(screen.getByText('Charge Session')).toBeInTheDocument();

    const badges = screen.getAllByTestId('state-badge');
    expect(badges).toHaveLength(2);
    expect(badges.map((b) => b.getAttribute('data-fsm-type'))).toEqual([
      'drive_session',
      'charge_session',
    ]);
    expect(screen.getAllByTestId('timestamp')).toHaveLength(2);
  });
});

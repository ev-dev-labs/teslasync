import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StateTimeline } from '../StateTimeline';
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
    fsm_type: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_changed',
    guard: '',
    mode: 'auto',
    duration_in_state_ms: 1000,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('StateTimeline empty state (Phase 45 / Prompt 35)', () => {
  it('renders only the empty message when there is no last transition', () => {
    render(<StateTimeline transitions={[]} fsmType="vehicle" windowMinutes={10} />);
    const empty = screen.getByTestId('state-timeline-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('No transitions in window');
    expect(screen.queryByTestId('state-timeline-widen')).toBeNull();
    expect(screen.queryByTestId('state-timeline-jump')).toBeNull();
  });

  it('renders the "last transition" hint AND a "Widen window" button when a wider preset is provided', () => {
    const last = makeTransition({
      id: 88,
      created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    });
    const onWiden = vi.fn();
    const onJump = vi.fn();
    render(
      <StateTimeline
        transitions={[]}
        fsmType="vehicle"
        windowMinutes={10}
        lastTransition={last}
        widerPreset={30}
        onWidenWindow={onWiden}
        onJumpToLast={onJump}
      />,
    );
    const empty = screen.getByTestId('state-timeline-empty');
    expect(empty.textContent).toContain('Last transition');
    expect(empty.textContent).toMatch(/m ago|min ago|just now/i);
    const widen = screen.getByTestId('state-timeline-widen');
    expect(widen).toBeInTheDocument();
    expect(widen.textContent).toContain('Widen window to 30 min');
    const jump = screen.getByTestId('state-timeline-jump');
    expect(jump).toBeInTheDocument();
    expect(jump.textContent).toContain('Jump to last transition');
  });

  it('invokes onWidenWindow exactly once when the widen button is clicked', () => {
    const last = makeTransition({
      id: 88,
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const onWiden = vi.fn();
    render(
      <StateTimeline
        transitions={[]}
        fsmType="vehicle"
        windowMinutes={10}
        lastTransition={last}
        widerPreset={30}
        onWidenWindow={onWiden}
      />,
    );
    fireEvent.click(screen.getByTestId('state-timeline-widen'));
    expect(onWiden).toHaveBeenCalledTimes(1);
  });

  it('invokes onJumpToLast exactly once when the jump button is clicked', () => {
    const last = makeTransition({
      id: 88,
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const onJump = vi.fn();
    render(
      <StateTimeline
        transitions={[]}
        fsmType="vehicle"
        windowMinutes={10}
        lastTransition={last}
        onJumpToLast={onJump}
      />,
    );
    fireEvent.click(screen.getByTestId('state-timeline-jump'));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('renders the jump button but NOT the widen button when no preset fits (last transition >24h old)', () => {
    const last = makeTransition({
      id: 88,
      created_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    });
    const onJump = vi.fn();
    render(
      <StateTimeline
        transitions={[]}
        fsmType="vehicle"
        windowMinutes={10}
        lastTransition={last}
        widerPreset={null}
        onJumpToLast={onJump}
      />,
    );
    expect(screen.queryByTestId('state-timeline-widen')).toBeNull();
    expect(screen.getByTestId('state-timeline-jump')).toBeInTheDocument();
  });
});

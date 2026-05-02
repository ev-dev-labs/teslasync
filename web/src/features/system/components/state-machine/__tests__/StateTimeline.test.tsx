import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StateTimeline } from '../StateTimeline';
import type { FSMTransition } from '@/types/fsm';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts: unknown, opts?: Record<string, unknown>) => {
      // Two-arg form: (key, fallback)
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

describe('StateTimeline', () => {
  it('shows the empty placeholder when no transitions are in the window', () => {
    const anchor = new Date('2025-01-15T12:00:00Z');
    render(
      <StateTimeline
        transitions={[
          makeTransition({
            id: 99,
            // 2 hours before anchor — outside the 10-minute default window
            created_at: '2025-01-15T10:00:00Z',
          }),
        ]}
        fsmType="vehicle"
        anchor={anchor}
        windowMinutes={10}
      />,
    );
    expect(screen.getByTestId('state-timeline-empty')).toBeInTheDocument();
  });

  it('renders one tick per in-window transition and reports clicks', () => {
    const anchor = new Date('2025-01-15T12:00:00Z');
    const onSelect = vi.fn();
    const t1 = makeTransition({ id: 11, created_at: '2025-01-15T11:55:00Z' });
    const t2 = makeTransition({ id: 12, created_at: '2025-01-15T11:58:00Z' });

    render(
      <StateTimeline
        transitions={[t1, t2]}
        fsmType="vehicle"
        anchor={anchor}
        windowMinutes={10}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByTestId('state-timeline-tick-11')).toBeInTheDocument();
    expect(screen.getByTestId('state-timeline-tick-12')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('state-timeline-tick-12'));
    expect(onSelect).toHaveBeenCalledWith(t2);
  });

  it('renders the selected tick with the highlight class', () => {
    const anchor = new Date('2025-01-15T12:00:00Z');
    const t1 = makeTransition({ id: 21, created_at: '2025-01-15T11:55:00Z' });
    render(
      <StateTimeline
        transitions={[t1]}
        fsmType="vehicle"
        anchor={anchor}
        selectedId={21}
        windowMinutes={10}
      />,
    );
    const tick = screen.getByTestId('state-timeline-tick-21');
    // Selected ticks ring themselves with `ring-2`
    expect(tick.className).toContain('ring-2');
  });
});

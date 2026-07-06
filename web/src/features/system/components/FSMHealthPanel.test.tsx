import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FSMHealthPanel, computeFlapIds } from './FSMHealthPanel';
import type { FSMTransition } from '@/types/fsm';

// Resolve the (key, fallback, opts) i18n signature the panel uses, interpolating
// `{{count}}` from the options object exactly like i18next would in production.
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

let idSeq = 0;
function makeTransition(overrides: Partial<FSMTransition> = {}): FSMTransition {
  idSeq += 1;
  return {
    id: idSeq,
    vehicle_id: 1,
    fsm_name: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_changed',
    ts: '2025-01-15T12:00:00.000Z',
    ...overrides,
  };
}

const BASE_MS = Date.parse('2025-01-15T12:00:00Z');

/** `n` same-FSM transitions spaced `stepMs` apart from `baseMs`. */
function burst(
  n: number,
  overrides: Partial<FSMTransition> = {},
  stepMs = 5_000,
  baseMs = BASE_MS,
): FSMTransition[] {
  return Array.from({ length: n }, (_, i) =>
    makeTransition({ ...overrides, ts: new Date(baseMs + i * stepMs).toISOString() }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe('computeFlapIds', () => {
  it('returns an empty set for empty or nullish input (null safety)', () => {
    expect(computeFlapIds([]).size).toBe(0);
    // The panel/page can hand us an undefined transitions list on first paint.
    expect(computeFlapIds(undefined as unknown as FSMTransition[]).size).toBe(0);
  });

  it('flags every transition in a >5-per-minute same-FSM burst', () => {
    const txs = burst(6); // six transitions inside a 25s span → one 60s window
    const flapped = computeFlapIds(txs);
    expect(flapped.size).toBe(6);
    for (const tx of txs) {
      expect(flapped.has(tx.id)).toBe(true);
    }
  });

  it('does not flap at the threshold boundary (exactly 5 in a window)', () => {
    const flapped = computeFlapIds(burst(5));
    expect(flapped.size).toBe(0);
  });

  it('does not flap when six transitions are spread across multiple windows', () => {
    // 20s apart → at most four land inside any single 60s window.
    const flapped = computeFlapIds(burst(6, {}, 20_000));
    expect(flapped.size).toBe(0);
  });

  it('groups by fsm_name — mixed FSMs under the threshold do not flap', () => {
    const mixed = [
      ...burst(4, { fsm_name: 'vehicle' }),
      ...burst(4, { fsm_name: 'drive_session' }),
    ];
    expect(computeFlapIds(mixed).size).toBe(0);
  });

  it('aggregates flapping across every FSM, not just the first one', () => {
    const vehicle = burst(6, { fsm_name: 'vehicle' });
    const drive = burst(6, { fsm_name: 'drive_session' });
    const flapped = computeFlapIds([...vehicle, ...drive]);
    expect(flapped.size).toBe(12);
    expect(flapped.has(vehicle[0].id)).toBe(true);
    expect(flapped.has(drive[5].id)).toBe(true);
  });

  it('ignores malformed timestamps without throwing or truncating the window', () => {
    const good = burst(6, { fsm_name: 'vehicle' });
    const bad = makeTransition({ fsm_name: 'vehicle', ts: 'not-a-date' });
    // Interleave the malformed row in the middle of the burst.
    const mixed = [good[0], good[1], good[2], bad, good[3], good[4], good[5]];
    const run = () => computeFlapIds(mixed);
    expect(run).not.toThrow();
    const flapped = run();
    expect(flapped.size).toBe(6);
    expect(flapped.has(bad.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('FSMHealthPanel', () => {
  it('shows the all-clear status and no alert cards when nothing is wrong', () => {
    render(<FSMHealthPanel transitions={[makeTransition()]} />);

    const allClear = screen.getByTestId('fsm-health-all-clear');
    expect(allClear).toBeInTheDocument();
    expect(within(allClear).getByRole('status')).toHaveTextContent(/All FSMs healthy/i);
    expect(screen.queryByTestId('fsm-health-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fsm-health-alert-flap')).not.toBeInTheDocument();
  });

  it('renders a flapping warning with an accessible, aria-hidden-decorated card', () => {
    render(<FSMHealthPanel transitions={burst(6)} />);

    expect(screen.getByTestId('fsm-health-panel')).toBeInTheDocument();
    const alert = screen.getByTestId('fsm-health-alert-flap');
    expect(alert).toHaveAttribute('role', 'status');
    expect(within(alert).getByText('State Flapping')).toBeInTheDocument();
    expect(within(alert).getByText(/6 transitions flagged as state flapping/)).toBeInTheDocument();
    // The big count and the icon are decorative — the message already states the count.
    expect(within(alert).getByText('6')).toHaveAttribute('aria-hidden', 'true');
    const icon = alert.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('flags a session whose latest state is stuck in active for over four hours', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    render(
      <FSMHealthPanel
        transitions={[
          makeTransition({ fsm_name: 'drive_session', to_state: 'active', ts: fiveHoursAgo }),
        ]}
      />,
    );

    const alert = screen.getByTestId('fsm-health-alert-stuck');
    expect(within(alert).getByText('Stuck Sessions')).toBeInTheDocument();
    expect(within(alert).getByText(/1 session\(s\) stuck in pending\/active/)).toBeInTheDocument();
  });

  it('does NOT flag a session as stuck once a later transition resolves it', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    render(
      <FSMHealthPanel
        transitions={[
          makeTransition({ fsm_name: 'drive_session', to_state: 'active', ts: fiveHoursAgo }),
          makeTransition({ fsm_name: 'drive_session', to_state: 'completed', ts: oneHourAgo }),
        ]}
      />,
    );

    expect(screen.queryByTestId('fsm-health-alert-stuck')).not.toBeInTheDocument();
    expect(screen.getByTestId('fsm-health-all-clear')).toBeInTheDocument();
  });

  it('reports pod recoveries as an informational alert', () => {
    render(
      <FSMHealthPanel
        transitions={[
          makeTransition({ to_state: 'recovered' }),
          makeTransition({ to_state: 'recovered' }),
          makeTransition({ to_state: 'driving' }),
        ]}
      />,
    );

    const alert = screen.getByTestId('fsm-health-alert-recovery');
    expect(within(alert).getByText('Pod Recoveries')).toBeInTheDocument();
    expect(within(alert).getByText(/2 session\(s\) recovered after pod restart/)).toBeInTheDocument();
    // Informational alerts use the blue accent, not the amber warning accent.
    expect(alert.className).toContain('border-blue-500/20');
  });

  it('renders multiple distinct alerts side by side', () => {
    const recovered = makeTransition({ fsm_name: 'vehicle', to_state: 'recovered' });
    render(<FSMHealthPanel transitions={[...burst(6), recovered]} />);

    expect(screen.getByTestId('fsm-health-alert-flap')).toBeInTheDocument();
    expect(screen.getByTestId('fsm-health-alert-recovery')).toBeInTheDocument();
    expect(screen.queryByTestId('fsm-health-all-clear')).not.toBeInTheDocument();
  });

  it('aggregates the flap count across FSMs into a single warning card', () => {
    const txs = [...burst(6, { fsm_name: 'vehicle' }), ...burst(6, { fsm_name: 'drive_session' })];
    render(<FSMHealthPanel transitions={txs} />);

    // Exactly one flap card, and it reports the combined 12 — not a partial 6.
    expect(screen.getAllByTestId('fsm-health-alert-flap')).toHaveLength(1);
    const alert = screen.getByTestId('fsm-health-alert-flap');
    expect(within(alert).getByText(/12 transitions flagged as state flapping/)).toBeInTheDocument();
  });

  it('renders the all-clear state without throwing when every timestamp is malformed', () => {
    const render_ = () =>
      render(
        <FSMHealthPanel
          transitions={[
            makeTransition({ fsm_name: 'drive_session', to_state: 'active', ts: 'garbage' }),
            makeTransition({ fsm_name: 'vehicle', ts: 'also-garbage' }),
          ]}
        />,
      );
    expect(render_).not.toThrow();
    expect(screen.getByTestId('fsm-health-all-clear')).toBeInTheDocument();
  });
});

/**
 * SignalStatsPanel — behavioural + hardening tests.
 *
 * Covers every export of the module:
 *   - emptyStatRow  (placeholder-row factory: NaN aggregates, count 0)
 *   - isEmptyStat   (count-based empty classifier that drives placeholders +
 *                    the "Hide empty" toggle count)
 *   - SignalStatsPanel (the panel itself) across every branch:
 *       · populated  — one row per stat, locale-formatted min/max/avg/count,
 *                      full header set, default + overridden title
 *       · loading    — four skeletons, no table, title still shown
 *       · empty      — guided no-statistics state
 *       · gaps       — `selectedSignals` fills missing signals with labelled
 *                      `—` placeholders + a "No data in range" subtitle, and
 *                      the Hide-empty toggle collapses them (down to the empty
 *                      caption when *every* selected signal is a gap)
 *       · null-safety — an `undefined` `stats` prop must not throw
 *       · a11y/styling — em-dash cells are labelled "No data", className
 *                      passthrough, positional vs explicit `signalIndex` colour
 *
 * `react-i18next` is stubbed with an interpolating `t` so copy assertions and
 * the `Hide empty ({{count}})` label stay stable and locale-independent. No
 * network is touched — the panel is presentation-only over its props.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

// Interpolating i18n stub: supports `t(key)`, `t(key, 'Default')` and
// `t(key, 'Hide empty ({{count}})', { count })` — the three shapes the panel
// (and the DataTable it wraps) actually use.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars: Record<string, unknown>) =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''));
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = (third && typeof third === 'object' ? third : {}) as Record<string, unknown>;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const vars = second as Record<string, unknown>;
          const tpl = typeof vars.defaultValue === 'string' ? vars.defaultValue : key;
          return interpolate(tpl, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import {
  SignalStatsPanel,
  emptyStatRow,
  isEmptyStat,
  type SignalStatsPanelProps,
} from './SignalStatsPanel';
import { CHART_COLORS } from '@/lib/colors';
import type { SignalStat } from '../hooks/useLiveSignalStream';

// ── fixtures ─────────────────────────────────────────────────────────────
const STATS: SignalStat[] = [
  { signal: 'battery_level', min: 1, max: 100, avg: 50.5, count: 10 },
  { signal: 'cabin_temp', min: 18, max: 24, avg: 21, count: 7 },
];

// Two present signals + two absent ones → two placeholder (empty) rows.
const SELECTED = ['battery_level', 'range_added', 'cabin_temp', 'phantom'];

function renderPanel(props?: Partial<SignalStatsPanelProps>) {
  const merged: SignalStatsPanelProps = { stats: STATS, ...props };
  return render(<SignalStatsPanel {...merged} />);
}

// The signal-name column is the only place a signal string renders; hop up to
// its <tr> so per-row assertions can be scoped with `within`.
function rowFor(signal: string): HTMLElement {
  const cell = screen.getByText(signal);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`no <tr> found for signal "${signal}"`);
  return tr as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── emptyStatRow ─────────────────────────────────────────────────────────
describe('emptyStatRow', () => {
  it('builds a zero-sample placeholder with NaN aggregates', () => {
    const row = emptyStatRow('range_added');
    expect(row.signal).toBe('range_added');
    expect(row.count).toBe(0);
    expect(Number.isNaN(row.min)).toBe(true);
    expect(Number.isNaN(row.max)).toBe(true);
    expect(Number.isNaN(row.avg)).toBe(true);
  });
});

// ── isEmptyStat ──────────────────────────────────────────────────────────
describe('isEmptyStat', () => {
  it('treats any zero-count row as empty, regardless of its aggregates', () => {
    expect(isEmptyStat({ signal: 'x', min: 5, max: 5, avg: 5, count: 0 })).toBe(true);
    expect(isEmptyStat(emptyStatRow('y'))).toBe(true);
  });

  it('treats a row that carries samples as non-empty', () => {
    expect(isEmptyStat({ signal: 'z', min: 0, max: 0, avg: 0, count: 1 })).toBe(false);
    expect(isEmptyStat(STATS[0])).toBe(false);
  });
});

// ── populated ────────────────────────────────────────────────────────────
describe('SignalStatsPanel — populated', () => {
  it('renders the default title and the full column header set', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Stats Summary' })).toBeInTheDocument();
    for (const header of ['Signal', 'Min', 'Max', 'Avg', 'Count']) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('renders one row per stat with locale-formatted aggregates', () => {
    renderPanel();
    const battery = within(rowFor('battery_level'));
    expect(battery.getByText('1.00')).toBeInTheDocument(); // min → precision 2
    expect(battery.getByText('100.00')).toBeInTheDocument(); // max
    expect(battery.getByText('50.50')).toBeInTheDocument(); // avg
    expect(battery.getByText('10')).toBeInTheDocument(); // count → integer
    expect(rowFor('cabin_temp')).toBeInTheDocument();
  });

  it('honours a title override', () => {
    renderPanel({ title: 'Live Aggregates' });
    expect(screen.getByRole('heading', { name: 'Live Aggregates' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Stats Summary' })).toBeNull();
  });

  it('does not render the hide-empty toggle when no rows are empty', () => {
    renderPanel();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

// ── loading ──────────────────────────────────────────────────────────────
describe('SignalStatsPanel — loading', () => {
  it('shows four skeletons and no table while loading', () => {
    const { container } = renderPanel({ loading: true });
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('1.00')).toBeNull();
  });

  it('keeps the panel title visible during loading', () => {
    renderPanel({ loading: true });
    expect(screen.getByRole('heading', { name: 'Stats Summary' })).toBeInTheDocument();
  });
});

// ── empty ────────────────────────────────────────────────────────────────
describe('SignalStatsPanel — empty', () => {
  it('renders guidance when there are no stats and no selection', () => {
    renderPanel({ stats: [] });
    expect(screen.getByText('No aggregate statistics are available.')).toBeInTheDocument();
    expect(screen.getByText(/Select a signal with numeric samples/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

// ── selected signals with gaps ───────────────────────────────────────────
describe('SignalStatsPanel — selected signals with gaps', () => {
  it('emits one row per selected signal, filling gaps with placeholders', () => {
    renderPanel({ selectedSignals: SELECTED });
    for (const sig of SELECTED) {
      expect(screen.getByText(sig)).toBeInTheDocument();
    }
  });

  it('labels each gap row with a subtitle and three "No data" em-dash cells', () => {
    renderPanel({ selectedSignals: SELECTED });
    const gap = within(rowFor('range_added'));
    expect(gap.getByText('No data in range')).toBeInTheDocument();
    // min/max/avg each render the accessible em-dash placeholder — this also
    // pins the avg-column a11y fix (it previously shipped an unlabelled dash).
    expect(gap.getAllByLabelText('No data')).toHaveLength(3);
  });

  it('surfaces a hide-empty toggle carrying the empty count', () => {
    renderPanel({ selectedSignals: SELECTED });
    const toggle = screen.getByRole('switch', { name: /Hide empty \(2\)/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('collapses the placeholder rows once hide-empty is toggled on', () => {
    renderPanel({ selectedSignals: SELECTED });
    const toggle = screen.getByRole('switch', { name: /Hide empty \(2\)/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('battery_level')).toBeInTheDocument();
    expect(screen.getByText('cabin_temp')).toBeInTheDocument();
    expect(screen.queryByText('range_added')).toBeNull();
    expect(screen.queryByText('phantom')).toBeNull();
  });

  it('falls back to the guided empty state when every selected signal is a gap', () => {
    renderPanel({ stats: [], selectedSignals: ['ghost_a', 'ghost_b'] });
    expect(screen.getByText('ghost_a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /Hide empty \(2\)/ }));
    expect(screen.getByText('No aggregate statistics are available.')).toBeInTheDocument();
    expect(screen.queryByText('ghost_a')).toBeNull();
  });
});

// ── null-safety (hardening) ──────────────────────────────────────────────
describe('SignalStatsPanel — null safety', () => {
  it('does not throw and shows the empty guidance when stats is undefined', () => {
    // A page may thread `data?.stats` through before its query resolves.
    expect(() =>
      renderPanel({ stats: undefined as unknown as SignalStat[] }),
    ).not.toThrow();
    expect(screen.getByText('No aggregate statistics are available.')).toBeInTheDocument();
  });

  it('still fills placeholder rows when stats is undefined but signals are selected', () => {
    renderPanel({
      stats: undefined as unknown as SignalStat[],
      selectedSignals: ['only_signal'],
    });
    expect(screen.getByText('only_signal')).toBeInTheDocument();
    expect(screen.getByText('No data in range')).toBeInTheDocument();
  });
});

// ── styling & colour a11y ────────────────────────────────────────────────
describe('SignalStatsPanel — styling & colour', () => {
  it('applies an extra className to the panel surface', () => {
    const { container } = renderPanel({ className: 'stats-surface-x' });
    expect(container.querySelector('.stats-surface-x')).not.toBeNull();
  });

  it('assigns distinct series colours to distinct signals by position', () => {
    renderPanel();
    const first = screen.getByText('battery_level').style.color;
    const second = screen.getByText('cabin_temp').style.color;
    expect(first).not.toBe('');
    expect(second).not.toBe('');
    expect(first).not.toBe(second);
  });

  it('respects an explicit signalIndex over the positional colour', () => {
    const { rerender } = render(<SignalStatsPanel stats={STATS} />);
    const positional = screen.getByText('battery_level').style.color; // CHART_COLORS[0]
    rerender(<SignalStatsPanel stats={STATS} signalIndex={{ battery_level: 1 }} />);
    const indexed = screen.getByText('battery_level').style.color; // CHART_COLORS[1]
    expect(indexed).not.toBe(positional);
    // Sanity: the two palette entries the test relies on really do differ.
    expect(CHART_COLORS[0]).not.toBe(CHART_COLORS[1]);
  });
});

// ── exported type surface ────────────────────────────────────────────────
describe('SignalStatsPanel — exported types', () => {
  it('exposes a props type consumers can construct', () => {
    const props: SignalStatsPanelProps = { stats: STATS, selectedSignals: ['battery_level'] };
    expect(props.stats).toHaveLength(2);
    expect(props.selectedSignals).toEqual(['battery_level']);
  });
});

/**
 * FSMTimelineChart tests (Project Apex elevation).
 *
 * The file exports two things and both are covered here:
 *
 *   - `buildFsmTimeline(transitions, hours, now?)` — the pure bucketing engine
 *     that powers the chart. It is exercised with an injected `now` so every
 *     window / bucket / label branch is deterministic and timezone-tolerant
 *     (assertions lean on structural facts — counts, uniqueness, bounds — rather
 *     than locale-formatted strings).
 *
 *   - `<FSMTimelineChart>` — the rendered component. It wraps the shared
 *     `<ChartContainer>` (figure / role="img") and falls back to `<EmptyState>`
 *     (role="status") when there is nothing to plot.
 *
 * `<ChartContainer>` pulls in the chart-export hook + the annotations query
 * hooks; those are stubbed exactly the way `ChartContainer.a11y.test.tsx` does
 * so the component renders without a network or a QueryClientProvider. i18n is
 * stubbed to echo each string's English fallback so visible copy is
 * deterministic. `ResizeObserver` is already polyfilled by the global
 * test-setup, so Recharts' ResponsiveContainer mounts without extra scaffolding.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// `useChartExport` reaches into html2canvas territory we don't need under unit
// tests. Stub it to the production return shape.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

// The container calls the annotation hooks unconditionally; stub them so no
// QueryClient is required.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

import { FSMTimelineChart, buildFsmTimeline, type FsmTimelinePoint } from './FSMTimelineChart';
import type { FSMTransition } from '@/types/fsm';

/** Fixed clock so rolling-window / label branches are deterministic. */
const NOW = Date.parse('2025-06-15T12:00:00Z');
const HOUR = 60 * 60_000;

let seq = 0;
/** Build a transition; `to_state` defaults to the series key for realism. */
function tx(fsm_name: string, ts: string, overrides: Partial<FSMTransition> = {}): FSMTransition {
  seq += 1;
  return {
    id: seq,
    vehicle_id: 1,
    ts,
    fsm_name,
    from_state: 'a',
    to_state: fsm_name,
    trigger: 'speed_changed',
    ...overrides,
  };
}

/** Sum every numeric series value across all buckets. */
function totalCount(buckets: FsmTimelinePoint[]): number {
  let sum = 0;
  for (const b of buckets) {
    for (const [k, v] of Object.entries(b)) {
      if (k !== 'time' && typeof v === 'number') sum += v;
    }
  }
  return sum;
}

/** ISO string N minutes before the real wall clock (for the render tests, which
 *  use the component's live `Date.now()`). */
const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

describe('buildFsmTimeline', () => {
  it('returns an empty timeline for empty, null, or undefined input', () => {
    expect(buildFsmTimeline([], 24, NOW)).toEqual({ buckets: [], fsmTypes: [] });
    expect(buildFsmTimeline(null, 24, NOW)).toEqual({ buckets: [], fsmTypes: [] });
    expect(buildFsmTimeline(undefined, 24, NOW)).toEqual({ buckets: [], fsmTypes: [] });
  });

  it('de-duplicates and alphabetically sorts the series keys', () => {
    const rows = [
      tx('driving', new Date(NOW - 20 * 60_000).toISOString()),
      tx('asleep', new Date(NOW - 18 * 60_000).toISOString()),
      tx('driving', new Date(NOW - 15 * 60_000).toISOString()),
    ];
    const { fsmTypes } = buildFsmTimeline(rows, 6, NOW);
    expect(fsmTypes).toEqual(['asleep', 'driving']);
  });

  it('tallies each in-window transition into a zero-filled per-series bucket', () => {
    const rows = [
      tx('driving', new Date(NOW - 30 * 60_000).toISOString()),
      tx('driving', new Date(NOW - 25 * 60_000).toISOString()),
      tx('parked', new Date(NOW - 20 * 60_000).toISOString()),
    ];
    const { buckets, fsmTypes } = buildFsmTimeline(rows, 6, NOW);

    expect(fsmTypes).toEqual(['driving', 'parked']);
    expect(totalCount(buckets)).toBe(3);
    // Every seeded bucket carries a value for every series so the stacked area
    // is continuous (no gaps where a series simply had no event).
    expect(buckets.every((b) => 'driving' in b && 'parked' in b)).toBe(true);
  });

  it('excludes transitions that fall before the window or in the future', () => {
    const rows = [
      tx('driving', new Date(NOW - 2 * 60_000).toISOString()), // in window
      tx('driving', new Date(NOW - 10 * HOUR).toISOString()), // 10h ago, outside 6h
      tx('driving', new Date(NOW + 60 * 60_000).toISOString()), // future, outside
    ];
    const { buckets } = buildFsmTimeline(rows, 6, NOW);
    expect(totalCount(buckets)).toBe(1);
  });

  it('skips malformed rows (unparseable ts, empty fsm_name) without counting them', () => {
    const rows = [
      tx('driving', new Date(NOW - 2 * 60_000).toISOString()),
      tx('driving', 'not-a-real-date'),
      tx('', new Date(NOW - 3 * 60_000).toISOString()),
    ];
    const { buckets, fsmTypes } = buildFsmTimeline(rows, 6, NOW);
    // Empty name is dropped from the series set; only the one valid row counts.
    expect(fsmTypes).toEqual(['driving']);
    expect(totalCount(buckets)).toBe(1);
  });

  it('spans the real data span for "all time" (hours <= 0) instead of one trailing bucket', () => {
    // Three transitions ~2 days before NOW, spread across 3 hours.
    const base = NOW - 48 * HOUR;
    const rows = [
      tx('driving', new Date(base).toISOString()),
      tx('parked', new Date(base + 1 * HOUR).toISOString()),
      tx('driving', new Date(base + 3 * HOUR).toISOString()),
    ];

    const allTime = buildFsmTimeline(rows, 0, NOW);
    expect(totalCount(allTime.buckets)).toBe(3); // none dropped
    expect(allTime.buckets.length).toBeGreaterThan(1); // real span, not collapsed

    // Regression contrast: a ~36-second rolling window ending at NOW would drop
    // all of them — which is exactly what the old hours=0 path did.
    const rolling = buildFsmTimeline(rows, 0.01, NOW);
    expect(totalCount(rolling.buckets)).toBe(0);
  });

  it('never hangs on a non-finite window and stays bounded on a pathological one', () => {
    const rows = [
      tx('driving', new Date(NOW - 5 * HOUR).toISOString()),
      tx('parked', new Date(NOW - 60_000).toISOString()),
    ];

    // Infinity must not spin the bucket loop forever — it falls back to all-time.
    const inf = buildFsmTimeline(rows, Infinity, NOW);
    expect(totalCount(inf.buckets)).toBe(2);
    expect(inf.buckets.length).toBeGreaterThan(0);

    // A million-hour finite span stays within the hard bucket ceiling because
    // the bucket width is widened to fit.
    const huge = buildFsmTimeline(rows, 1_000_000, NOW);
    expect(huge.buckets.length).toBeGreaterThan(0);
    expect(huge.buckets.length).toBeLessThanOrEqual(5000);
  });

  it('date-prefixes labels for a multi-day window so ticks never collide', () => {
    const rows = [
      tx('driving', new Date(NOW - 5 * 24 * HOUR).toISOString()),
      tx('parked', new Date(NOW - 2 * 24 * HOUR).toISOString()),
    ];
    const { buckets } = buildFsmTimeline(rows, 168, NOW); // 7-day window
    const labels = buckets.map((b) => String(b.time));

    expect(new Set(labels).size).toBe(labels.length); // all unique
    expect(labels.every((l) => l.includes('/'))).toBe(true); // MM/DD prefix
  });

  it('keeps bare HH:MM labels inside a single-day window', () => {
    const rows = [tx('driving', new Date(NOW - 60 * 60_000).toISOString())];
    const { buckets } = buildFsmTimeline(rows, 6, NOW);
    expect(buckets.every((b) => /^\d{2}:\d{2}$/.test(String(b.time)))).toBe(true);
  });
});

describe('<FSMTimelineChart>', () => {
  it('renders the labelled chart figure when there is data to plot', () => {
    render(
      <FSMTimelineChart
        transitions={[tx('driving', minutesAgo(5)), tx('parked', minutesAgo(3))]}
        hours={6}
      />,
    );

    expect(screen.getByRole('figure', { name: /Transitions Over Time/ })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /FSM transitions over time/ }),
    ).toBeInTheDocument();
    // The empty-state copy must NOT appear when buckets exist.
    expect(screen.queryByText('No transition data for timeline')).not.toBeInTheDocument();
  });

  it('shows the default empty state when there are no transitions', () => {
    render(<FSMTimelineChart transitions={[]} hours={6} />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(screen.getByText('No transition data for timeline')).toBeInTheDocument();
  });

  it('prefers a caller-supplied emptyMessage over the default copy', () => {
    render(
      <FSMTimelineChart transitions={[]} hours={6} emptyMessage="Nothing in this range" />,
    );

    expect(screen.getByText('Nothing in this range')).toBeInTheDocument();
    expect(screen.queryByText('No transition data for timeline')).not.toBeInTheDocument();
  });

  it('renders (never hangs) with a non-finite hours prop by falling back to all-time', () => {
    render(
      <FSMTimelineChart transitions={[tx('driving', minutesAgo(5))]} hours={Infinity} />,
    );

    expect(screen.getByRole('figure', { name: /Transitions Over Time/ })).toBeInTheDocument();
    expect(screen.queryByText('No transition data for timeline')).not.toBeInTheDocument();
  });
});

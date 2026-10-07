/**
 * ReasonBreakdown contract tests.
 *
 * ReasonBreakdown is a pure prop-driven component: it takes the same
 * `useDLQList()` rows the entries table consumes and derives a per-reason
 * count breakdown. The behaviour that matters (and that we lock in here):
 *
 *   1. Self-sufficient states — error → QueryError, first-load → Skeleton,
 *      empty → EmptyState, populated → a labelled list of bars — with the
 *      documented precedence (error > loading > empty > data).
 *   2. Derivation — one bucket per distinct reason, counts summed, sorted
 *      by descending count, blank/whitespace reasons coalesced into a
 *      single "unknown" bucket, and surrounding whitespace trimmed so the
 *      same reason never splits into two rows.
 *   3. Presentation contract passed to <MetricBar> — value, max (= total),
 *      colour cycled through the colour-blind-safe palette, and the
 *      "count · percent" sublabel.
 *   4. A background refetch (loading with rows already present) keeps the
 *      bars on screen instead of flashing back to the skeleton.
 *   5. a11y — the list exposes an accessible name and one listitem per bucket.
 *
 * <MetricBar> is stubbed to a prop-capturing element so we can assert the
 * exact derived contract (value/max/colour/sublabel) without coupling to
 * its framer-motion internals; it has its own tests. The feedback-state
 * children (Skeleton / EmptyState / QueryError) render for real so the
 * branch wiring is exercised end-to-end. react-i18next is stubbed to return
 * the English fallback so assertions are decoupled from the locale JSON.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import type { DLQEntrySummary } from '@/types/admin-diagnostics';

// Return the English fallback (2nd arg) for every t() call so the copy we
// assert on is decoupled from the locale resource bundle.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Stub MetricBar to a prop-capturing element. This keeps the assertions on
// ReasonBreakdown's *own* derivation contract precise (exact value / max /
// colour / sublabel) and avoids re-testing MetricBar's animation internals.
vi.mock('@/components/data-display', () => ({
  MetricBar: ({
    label,
    value,
    max,
    color,
    sublabel,
  }: {
    label: string;
    value: number;
    max: number;
    color: string;
    sublabel?: string;
  }) => (
    <div
      data-testid="metric-bar"
      data-label={label}
      data-value={value}
      data-max={max}
      data-color={color}
      data-sublabel={sublabel ?? ''}
    />
  ),
}));

import { ReasonBreakdown } from './ReasonBreakdown';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeRow(reason: string, id = 1): DLQEntrySummary {
  return {
    id,
    arrived_at: '2026-07-04T00:00:00Z',
    dlq_topic: 'dlq/telemetry',
    parsed_reason: reason,
    parsed_vehicle_id: null,
    parsed_vin: null,
    parsed_source_topic: null,
    parsed_redeliveries: null,
    parsed_timestamp: null,
    parse_error: null,
    replayable: true,
    raw_payload_size: 0,
    inner_payload_size: 0,
  };
}

/** Build `count` rows all sharing the same reason. */
function rowsFor(reason: string, count: number, startId = 1): DLQEntrySummary[] {
  return Array.from({ length: count }, (_, i) => makeRow(reason, startId + i));
}

function renderRB(props: Partial<React.ComponentProps<typeof ReasonBreakdown>> = {}) {
  const merged = {
    rows: [] as DLQEntrySummary[],
    loading: false,
    error: null as unknown,
    onRetry: vi.fn(),
    ...props,
  };
  const utils = render(
    <MemoryRouter>
      <ReasonBreakdown {...merged} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry: merged.onRetry };
}

/** Read the captured MetricBar stubs in DOM (= bucket) order. */
function readBars() {
  return screen.getAllByTestId('metric-bar').map((el) => ({
    label: el.getAttribute('data-label'),
    value: el.getAttribute('data-value'),
    max: el.getAttribute('data-max'),
    color: el.getAttribute('data-color'),
    sublabel: el.getAttribute('data-sublabel'),
  }));
}

// ── State branches ─────────────────────────────────────────────────────────

describe('ReasonBreakdown — state branches', () => {
  it('shows a skeleton on first load (loading with no rows yet)', () => {
    const { container } = renderRB({ rows: [], loading: true });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // No bars and no empty-state while we're still loading.
    expect(screen.queryByTestId('metric-bar')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows an empty state (not a skeleton) once loaded with zero rows', () => {
    const { container } = renderRB({ rows: [], loading: false });

    const empty = screen.getByRole('status');
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveTextContent(/No failed ingests/i);
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });

  it('renders QueryError with a working Retry when an error is present', () => {
    const { onRetry } = renderRB({ error: new ApiError('boom', 500) });

    // ErrorState uses role="alert" for a server error.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The error path pre-empts the data list.
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });

  it('prioritises the error state over the loading skeleton', () => {
    const { container } = renderRB({
      rows: [],
      loading: true,
      error: new ApiError('still broken', 500),
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });

  it('keeps the bars visible during a background refetch (loading with rows)', () => {
    const { container } = renderRB({
      rows: [...rowsFor('codec_decode', 2), ...rowsFor('timeout', 1, 10)],
      loading: true,
    });

    // buckets.length > 0 → the `loading && empty` skeleton guard is skipped.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getAllByTestId('metric-bar')).toHaveLength(2);
  });
});

// ── Derivation ───────────────────────────────────────────────────────────

describe('ReasonBreakdown — reason bucketing', () => {
  it('derives one bucket per distinct reason, sorted by descending count', () => {
    const rows = [
      ...rowsFor('schema_mismatch', 2, 1),
      ...rowsFor('codec_decode', 3, 10),
      ...rowsFor('timeout', 1, 20),
    ];

    renderRB({ rows });

    const bars = readBars();
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => b.label)).toEqual(['codec_decode', 'schema_mismatch', 'timeout']);
    expect(bars.map((b) => b.value)).toEqual(['3', '2', '1']);
    // max is the fleet total (6) for every bar so widths are comparable.
    expect(bars.map((b) => b.max)).toEqual(['6', '6', '6']);
  });

  it('formats the sublabel as "count · percent" of the total', () => {
    const rows = [
      ...rowsFor('codec_decode', 3, 1),
      ...rowsFor('schema_mismatch', 2, 10),
      ...rowsFor('timeout', 1, 20),
    ];

    renderRB({ rows });

    const bars = readBars();
    // 3/6 = 50, 2/6 = 33.3 → 33, 1/6 = 16.6 → 17 (rounded to 0 dp).
    expect(bars.map((b) => b.sublabel)).toEqual(['3 · 50%', '2 · 33%', '1 · 17%']);
  });

  it('coalesces blank and whitespace-only reasons into a single "unknown" bucket', () => {
    const rows = [makeRow('', 1), makeRow('   ', 2), makeRow('timeout', 3)];

    renderRB({ rows });

    const bars = readBars();
    expect(bars).toHaveLength(2);
    // "unknown" (2) outranks "timeout" (1).
    expect(bars[0].label).toBe('unknown');
    expect(bars[0].value).toBe('2');
    expect(bars[1].label).toBe('timeout');
    expect(bars[1].value).toBe('1');
  });

  it('trims surrounding whitespace so a reason never splits into two rows', () => {
    const rows = [makeRow('timeout', 1), makeRow('timeout ', 2), makeRow(' timeout', 3)];

    renderRB({ rows });

    const bars = readBars();
    expect(bars).toHaveLength(1);
    expect(bars[0].label).toBe('timeout');
    expect(bars[0].value).toBe('3');
    expect(bars[0].sublabel).toBe('3 · 100%');
  });

  it('cycles the colour palette back to the first colour after eight buckets', () => {
    // Nine distinct reasons with strictly-descending counts so ordering is
    // deterministic (9, 8, …, 1). Bucket 0 and bucket 8 must share series[0].
    const rows = Array.from({ length: 9 }).flatMap((_, i) =>
      rowsFor(`reason-${i}`, 9 - i, i * 100),
    );

    renderRB({ rows });

    const bars = readBars();
    expect(bars).toHaveLength(9);
    expect(bars[0].color).toBe('#3b82f6'); // series[0]
    expect(bars[8].color).toBe('#3b82f6'); // series[8 % 8] === series[0]
    expect(bars[0].color).not.toBe(bars[1].color);
  });
});

// ── Accessibility ───────────────────────────────────────────────────────────

describe('ReasonBreakdown — accessibility', () => {
  it('labels the breakdown list and renders one listitem per bucket', () => {
    const rows = [...rowsFor('codec_decode', 2, 1), ...rowsFor('timeout', 1, 10)];

    renderRB({ rows });

    const list = screen.getByRole('list', { name: /failure reasons breakdown/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

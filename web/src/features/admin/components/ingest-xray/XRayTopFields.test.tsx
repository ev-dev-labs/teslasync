/**
 * XRayTopFields — top-fields-by-volume side panel contract.
 *
 * The panel derives ranked MetricBars from the same `fields` payload the
 * X-Ray table renders and owns its own loading / error / empty states so it
 * never gates the rest of the page. These tests pin:
 *   - the always-on panel shell (heading + decorative icon) across states,
 *   - the loading branch (skeleton, no list / empty / error),
 *   - the error branch (QueryError alert with a working Retry, taking
 *     priority over any stale rows),
 *   - the empty branch (a real EmptyState, never a blank panel) and its
 *     null-safe guard against undefined / null `rows`,
 *   - the ranking + formatting contract (desc by sample_count, `limit`
 *     head-slice, locale-grouped counts, per-row palette colour that wraps
 *     modulo CHART_COLORS.length),
 *   - the `limit` clamp (0 / negative must NOT drop rows from the tail),
 *   - defensive null-safety against rows missing `field` / `sample_count`.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English
 * default — assertions then read against the real copy. `useOnlineStatus`
 * is pinned online so QueryError renders its network `role="alert"` branch
 * with an enabled Retry (mirrors FlagStatsBand.test / QueryError.test).
 * Everything else — GlassPanel, PanelTitle, MetricBar, EmptyState,
 * QueryError, Skeleton — renders for real.
 */
import { type ComponentProps, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

import { XRayTopFields } from './XRayTopFields';
import { CHART_COLORS } from '@/lib/colors';
import type { IngestXRayFieldStat } from '@/types/admin-diagnostics';

function makeRow(
  overrides: Partial<IngestXRayFieldStat> = {},
): IngestXRayFieldStat {
  return {
    field: 'VehicleSpeed',
    sample_count: 100,
    last_seen_at: '2026-05-05T12:00:00Z',
    value_kind: 1,
    ...overrides,
  };
}

type Props = ComponentProps<typeof XRayTopFields>;

function renderPanel(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    rows: [],
    loading: false,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <XRayTopFields {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

/** The MetricBar sublabel is the only `.font-mono` node in a row and carries
 *  the inline palette colour, so it doubles as a colour probe. */
function rowColor(item: HTMLElement): string {
  const sub = item.querySelector<HTMLElement>('.font-mono');
  return sub?.style.color ?? '';
}

const HEADING = /top fields by volume/i;

describe('XRayTopFields — panel shell', () => {
  it('always renders the heading and a decorative (aria-hidden) icon while loading', () => {
    const { container } = renderPanel({ loading: true });

    expect(
      screen.getByRole('heading', { name: HEADING }),
    ).toBeInTheDocument();
    // The lucide icon in the title is decorative and hidden from AT.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the heading even when there is no data to show', () => {
    renderPanel({ rows: [] });
    expect(
      screen.getByRole('heading', { name: HEADING }),
    ).toBeInTheDocument();
  });
});

describe('XRayTopFields — loading', () => {
  it('renders a skeleton and no list / empty / error while loading', () => {
    const { container } = renderPanel({ loading: true, rows: [makeRow()] });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // Loading strictly precedes every other branch.
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('XRayTopFields — error', () => {
  it('renders a QueryError alert with a Retry that invokes onRetry', () => {
    const { onRetry } = renderPanel({ error: new Error('boom') });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/can't reach server/i)).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error over any stale rows', () => {
    renderPanel({
      error: new Error('down'),
      rows: [makeRow({ field: 'ShouldNotRender', sample_count: 999 })],
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The bars must not render while an error is surfaced. QueryError renders
    // its own help-links list, so target the labelled field list.
    expect(screen.queryByRole('list', { name: HEADING })).toBeNull();
    expect(screen.queryByText('ShouldNotRender')).toBeNull();
  });
});

describe('XRayTopFields — empty & null-safety', () => {
  it('renders an EmptyState (never a blank panel) when there are no rows', () => {
    renderPanel({ rows: [] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.getByText(/no field activity in this window yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('treats undefined / null rows as empty without crashing', () => {
    const { unmount } = renderPanel({
      rows: undefined as unknown as IngestXRayFieldStat[],
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.getByText(/no field activity in this window yet/i),
    ).toBeInTheDocument();
    unmount();

    renderPanel({ rows: null as unknown as IngestXRayFieldStat[] });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('XRayTopFields — ranking & formatting', () => {
  it('ranks fields by sample_count descending and labels the list for AT', () => {
    const rows = [
      makeRow({ field: 'low', sample_count: 5 }),
      makeRow({ field: 'high', sample_count: 500 }),
      makeRow({ field: 'mid', sample_count: 50 }),
    ];
    renderPanel({ rows });

    // The <ul> is exposed as a labelled list.
    expect(
      screen.getByRole('list', { name: HEADING }),
    ).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('high');
    expect(items[1]).toHaveTextContent('mid');
    expect(items[2]).toHaveTextContent('low');
  });

  it('formats the sample count with locale grouping', () => {
    renderPanel({ rows: [makeRow({ field: 'chatty', sample_count: 12345 })] });

    expect(screen.getByText('chatty')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
  });

  it('surfaces only the top `limit` fields (head-slice, not tail)', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ field: `f${i}`, sample_count: (5 - i) * 10 }),
    );
    renderPanel({ rows, limit: 2 });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // f0 (50) and f1 (40) are the two loudest.
    expect(items[0]).toHaveTextContent('f0');
    expect(items[1]).toHaveTextContent('f1');
    expect(screen.queryByText('f4')).toBeNull();
  });

  it('assigns a per-row palette colour that wraps modulo CHART_COLORS.length', () => {
    const n = CHART_COLORS.length + 1;
    const rows = Array.from({ length: n }, (_, i) =>
      makeRow({ field: `f${i}`, sample_count: (n - i) * 10 }),
    );
    renderPanel({ rows, limit: n });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(n);

    const first = rowColor(items[0]);
    const second = rowColor(items[1]);
    const wrapped = rowColor(items[CHART_COLORS.length]); // index === length

    expect(first).toBeTruthy();
    expect(second).not.toEqual(first); // adjacent rows use distinct colours
    expect(wrapped).toEqual(first); // i % length wraps back to colour 0
  });
});

describe('XRayTopFields — limit clamping & row null-safety', () => {
  it('renders the empty state for limit=0 rather than dropping the tail', () => {
    renderPanel({ rows: [makeRow(), makeRow({ field: 'other' })], limit: 0 });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('clamps a negative limit to zero (no negative-slice tail drop)', () => {
    renderPanel({
      rows: [
        makeRow({ field: 'a', sample_count: 30 }),
        makeRow({ field: 'b', sample_count: 20 }),
      ],
      limit: -1,
    });

    // A raw slice(0, -1) would have rendered 'a'; the clamp yields empty.
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('a')).toBeNull();
  });

  it('falls back to an em-dash label and zero count for malformed rows', () => {
    const rows = [
      makeRow({ field: '', sample_count: 7 }),
      {
        // field omitted entirely + non-numeric count
        sample_count: undefined,
        last_seen_at: '2026-05-05T12:00:00Z',
        value_kind: 0,
      } as unknown as IngestXRayFieldStat,
    ];
    renderPanel({ rows });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // Both malformed rows render an em-dash label rather than a blank bar.
    expect(screen.getAllByText('—')).toHaveLength(2);
    // The undefined count is coerced to a formatted 0.
    expect(screen.getByText('0')).toBeInTheDocument();
    // The present count still renders.
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});

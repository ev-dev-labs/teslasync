/**
 * ExportStatusBreakdown — behaviour + hardening contract.
 *
 * The panel owns four mutually-exclusive states (loading / error / empty /
 * data) plus a storage footer, and derives one MetricBar per non-zero status
 * in the canonical STATUS_ORDER sequence. These tests exercise every branch,
 * the count·percentage sublabel formatting, the loading a11y live-region, the
 * Retry interaction wired through QueryError, state precedence, and the
 * API-drift guard that keeps a status outside the known union from rendering a
 * near-blank panel.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

// MetricBar animates its fill via framer-motion's `motion.div` and reads
// `useReducedMotion()` (via `useMotionPreference`) to decide whether that
// tween runs. Render it as a plain element + stub the reduced-motion query so
// the bars are synchronous + deterministic under jsdom (mirrors the shared
// MetricBar unit test).
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        (props: Record<string, unknown>) => {
          const Component = (props.as as string) ?? 'div';
          const { children, ...rest } = props as {
            children?: unknown;
          } & Record<string, unknown>;
          return (
            <Component {...(rest as Record<string, unknown>)}>
              {children as React.ReactNode}
            </Component>
          );
        },
    },
  ),
  useReducedMotion: () => false,
}));

// Pin the browser to "online" so QueryError resolves to its network-error
// branch (title + enabled Retry) rather than the offline branch.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

import { ExportStatusBreakdown } from './ExportStatusBreakdown';
import type { ExportStats } from './exportStats';

type ByStatus = ExportStats['byStatus'];

function makeStats(
  overrides: {
    byStatus?: Partial<ByStatus>;
    total?: number;
    totalBytes?: number;
  } = {},
): ExportStats {
  const byStatus: ByStatus = {
    ready: 0,
    processing: 0,
    queued: 0,
    failed: 0,
    expired: 0,
    ...overrides.byStatus,
  };
  const derivedTotal =
    byStatus.ready +
    byStatus.processing +
    byStatus.queued +
    byStatus.failed +
    byStatus.expired;
  return {
    total: overrides.total ?? derivedTotal,
    ready: byStatus.ready,
    inProgress: byStatus.processing + byStatus.queued,
    failed: byStatus.failed,
    expired: byStatus.expired,
    totalBytes: overrides.totalBytes ?? 0,
    byStatus,
  };
}

function renderBreakdown(
  overrides: Partial<React.ComponentProps<typeof ExportStatusBreakdown>> = {},
) {
  const props: React.ComponentProps<typeof ExportStatusBreakdown> = {
    stats: makeStats(),
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <ExportStatusBreakdown {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry: props.onRetry };
}

describe('ExportStatusBreakdown', () => {
  it('always renders the panel heading', () => {
    renderBreakdown({ stats: makeStats({ byStatus: { ready: 1 } }) });
    expect(
      screen.getByRole('heading', { name: /Status breakdown/i, level: 3 }),
    ).toBeInTheDocument();
  });

  describe('loading state', () => {
    it('exposes an aria-busy live region and hides every data surface', () => {
      renderBreakdown({ isLoading: true });

      const region = screen.getByRole('status');
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(region).toHaveAccessibleName(/loading/i);
      // No bars, no storage footer while loading.
      expect(screen.queryByText('Ready')).not.toBeInTheDocument();
      expect(screen.queryByText('Storage used')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows the empty placeholder (role=status) when there is no activity', () => {
      renderBreakdown({ stats: makeStats() });

      expect(
        screen.getByText('No export activity to summarize yet.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
      // The storage footer belongs to the data branch only.
      expect(screen.queryByText('Storage used')).not.toBeInTheDocument();
    });
  });

  describe('data state', () => {
    it('renders one bar per non-zero status in canonical order and omits zero counts', () => {
      renderBreakdown({
        stats: makeStats({ byStatus: { ready: 3, queued: 2, failed: 1 } }),
      });

      const ready = screen.getByText('Ready');
      const queued = screen.getByText('Queued');
      const failed = screen.getByText('Failed');
      expect(ready).toBeInTheDocument();
      expect(queued).toBeInTheDocument();
      expect(failed).toBeInTheDocument();

      // Zero-count statuses must not render a bar.
      expect(screen.queryByText('Processing')).not.toBeInTheDocument();
      expect(screen.queryByText('Expired')).not.toBeInTheDocument();

      // Canonical STATUS_ORDER: ready → queued → failed.
      expect(
        ready.compareDocumentPosition(queued) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        queued.compareDocumentPosition(failed) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('formats each sublabel as "count · percentage"', () => {
      renderBreakdown({
        stats: makeStats({ byStatus: { ready: 3, failed: 1 } }),
      });

      expect(screen.getByText(/3\s*\S\s*75\.00%/)).toBeInTheDocument();
      expect(screen.getByText(/1\s*\S\s*25\.00%/)).toBeInTheDocument();
    });

    it('renders the storage footer with a formatted byte total', () => {
      renderBreakdown({
        stats: makeStats({
          byStatus: { ready: 1 },
          totalBytes: 2 * 1024 * 1024,
        }),
      });

      expect(screen.getByText('Storage used')).toBeInTheDocument();
      expect(screen.getByText('2.00 MB')).toBeInTheDocument();
    });

    it('renders an em dash for storage when no bytes have accumulated', () => {
      renderBreakdown({
        stats: makeStats({ byStatus: { ready: 1 }, totalBytes: 0 }),
      });

      expect(screen.getByText('Storage used')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('surfaces a query error and invokes onRetry when Retry is clicked', () => {
      const { onRetry } = renderBreakdown({ error: new Error('network down') });

      expect(screen.getByText("Can't reach server")).toBeInTheDocument();

      const retry = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retry);
      expect(onRetry).toHaveBeenCalledTimes(1);

      // Bars must not leak into the error state.
      expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    });
  });

  describe('state precedence', () => {
    it('prefers loading over both error and data', () => {
      renderBreakdown({
        isLoading: true,
        error: new Error('boom'),
        stats: makeStats({ byStatus: { ready: 5 } }),
      });

      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
      expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    });

    it('prefers error over the data branch', () => {
      renderBreakdown({
        error: new Error('nope'),
        stats: makeStats({ byStatus: { ready: 5 }, totalBytes: 4096 }),
      });

      expect(screen.getByText("Can't reach server")).toBeInTheDocument();
      expect(screen.queryByText('Storage used')).not.toBeInTheDocument();
    });
  });

  describe('API-drift hardening', () => {
    it('falls back to the empty state when total > 0 but no known status has a count', () => {
      // A status value outside the union inflates `total` without landing in
      // any bucket. The panel must degrade to the empty placeholder rather
      // than render a bars-less near-blank surface.
      renderBreakdown({
        stats: makeStats({ byStatus: {}, total: 5, totalBytes: 9999 }),
      });

      expect(
        screen.getByText('No export activity to summarize yet.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Storage used')).not.toBeInTheDocument();
    });

    it('does not crash and shows the empty state when byStatus is malformed', () => {
      const malformed: ExportStats = {
        ...makeStats({ total: 3 }),
        byStatus: undefined as unknown as ByStatus,
      };

      expect(() => renderBreakdown({ stats: malformed })).not.toThrow();
      expect(
        screen.getByText('No export activity to summarize yet.'),
      ).toBeInTheDocument();
    });
  });
});

describe('ExportStatusBreakdown semantic fills', () => {
  it('keeps all status bars solid semantic with the full denominator', () => {
    renderBreakdown({
      stats: makeStats({
        byStatus: { ready: 3, processing: 2, queued: 2, failed: 2, expired: 1 },
        total: 11,
        totalBytes: 2048,
      }),
    });

    const statuses = [
      { label: 'Ready', count: 3, percentage: '27.27%', color: 'var(--semantic-success)' },
      { label: 'Processing', count: 2, percentage: '18.18%', color: 'var(--semantic-info)' },
      { label: 'Queued', count: 2, percentage: '18.18%', color: 'var(--semantic-info)' },
      { label: 'Failed', count: 2, percentage: '18.18%', color: 'var(--semantic-danger)' },
      { label: 'Expired', count: 1, percentage: '9.09%', color: 'var(--text-secondary)' },
    ];
    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual(
      statuses.map(({ label }) => label),
    );

    statuses.forEach(({ label, count, percentage, color }) => {
      const bar = screen.getByRole('progressbar', { name: label });
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuenow', String(count));
      expect(bar).toHaveAttribute('aria-valuemax', '11');
      expect(bar).toHaveTextContent(`${count} · ${percentage}`);
      expect(bar.querySelector('[data-metric-track]')).toHaveClass('h-2.5');
      expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({ background: color });
    });

    expect(screen.getByText('Storage used')).toBeInTheDocument();
    expect(screen.getByText('2.00 KB')).toBeInTheDocument();
  });

  it('keeps unresolved counts distinct from a resolved zero activity summary', () => {
    const stats = makeStats();
    const unresolvedMessage = 'Export counts are unknown.';
    const { rerender, onRetry } = renderBreakdown({ stats, unresolvedMessage });

    expect(screen.getByRole('status')).toHaveTextContent(unresolvedMessage);
    expect(screen.queryByText('No export activity to summarize yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage used')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ExportStatusBreakdown
          stats={stats}
          isLoading={false}
          error={null}
          onRetry={onRetry}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'No export activity to summarize yet.',
    );
    expect(screen.queryByText(unresolvedMessage)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage used')).not.toBeInTheDocument();
  });
});

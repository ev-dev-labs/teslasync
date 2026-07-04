/**
 * SecurityStatistics — statistics panel contract.
 *
 * The panel renders seven derived security metrics inside a titled glass
 * panel and owns its own loading / error / empty states so it never gates
 * the surrounding analytics bento. These tests pin:
 *   - the title shell (always present, in every branch),
 *   - the data branch (all seven metrics, correct values, rounded sentry %,
 *     labelled a11y group),
 *   - null-safety (missing numeric fields render "0", never a blank tile),
 *   - the loading branch (aria-hidden skeleton grid, no metrics/empty/error),
 *   - the error branch (QueryError alert, working Retry, optional onRetry),
 *   - branch precedence (error > loading > data > empty),
 *   - the empty branch (EmptyState, never a blank panel),
 *   - className pass-through onto the GlassPanel.
 */
import { type ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

import { SecurityStatistics } from './SecurityStatistics';
import type { SecurityStats } from './helpers';

// QueryError reaches for the browser online-state; pin it to the online
// (network-error → role="alert") branch so the Retry button is enabled and
// assertions don't depend on the jsdom navigator default. Mirrors the
// convention used in QueryError.test.tsx / FlagStatsBand.test.tsx.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

function makeStats(overrides: Partial<SecurityStats> = {}): SecurityStats {
  return {
    lockEvents: 3,
    doorOpenCount: 5,
    windowOpenCount: 2,
    homelinkCount: 4,
    guestCount: 1,
    total: 12,
    ...overrides,
  };
}

type StatsProps = ComponentProps<typeof SecurityStatistics>;

function renderStats(overrides: Partial<StatsProps> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: StatsProps = {
    securityStats: makeStats(),
    sentryUptime: 87.6,
    isLoading: false,
    error: null,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <SecurityStatistics {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

/**
 * Read the value rendered next to a metric's label. MetricCard renders
 * `<p class="metric-label"><span>{label}</span></p>` immediately followed
 * by `<p class="text-xl">{value}</p>`, so we navigate label → value without
 * coupling to brittle class selectors on the value node itself.
 */
function metricValue(label: string): string {
  const labelSpan = screen.getByText(label);
  const valueEl = labelSpan.parentElement?.nextElementSibling;
  return valueEl?.textContent ?? '';
}

const ALL_LABELS = [
  'Lock/Unlock Events',
  'Sentry Uptime',
  'Door Open Events',
  'Window Open Events',
  'HomeLink Detections',
  'Guest Mode Usage',
  'Total Events',
];

describe('SecurityStatistics — data', () => {
  it('renders the panel title and all seven metrics with their derived values', () => {
    renderStats({ securityStats: makeStats(), sentryUptime: 87.6 });

    expect(screen.getByText('Security Statistics')).toBeInTheDocument();

    expect(metricValue('Lock/Unlock Events')).toBe('3');
    expect(metricValue('Sentry Uptime')).toBe('88%'); // fmtInt rounds 87.6
    expect(metricValue('Door Open Events')).toBe('5');
    expect(metricValue('Window Open Events')).toBe('2');
    expect(metricValue('HomeLink Detections')).toBe('4');
    expect(metricValue('Guest Mode Usage')).toBe('1');
    expect(metricValue('Total Events')).toBe('12');
  });

  it('exposes the metric cluster as a labelled group for assistive tech', () => {
    renderStats();

    const group = screen.getByRole('group', {
      name: /security statistics metrics/i,
    });
    expect(group).toBeInTheDocument();
    // All seven metric labels live inside that one group.
    for (const label of ALL_LABELS) {
      expect(group).toContainElement(screen.getByText(label));
    }
    // Data branch → no skeletons, no empty state, no error alert.
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [0, '0%'],
    [12.2, '12%'], // rounds down
    [87.6, '88%'], // rounds up
    [100, '100%'],
  ])('formats sentryUptime %p as the rounded percentage %p', (uptime, shown) => {
    renderStats({ sentryUptime: uptime });
    expect(metricValue('Sentry Uptime')).toBe(shown);
  });
});

describe('SecurityStatistics — null-safety', () => {
  it('renders "0" for missing numeric fields instead of a blank tile', () => {
    // A partial payload (contract violation / future partial API shape) must
    // not surface an empty value node — the `?? 0` guards each metric.
    renderStats({
      securityStats: {} as unknown as SecurityStats,
      sentryUptime: 0,
    });

    expect(
      screen.getByRole('group', { name: /security statistics metrics/i }),
    ).toBeInTheDocument();
    expect(metricValue('Lock/Unlock Events')).toBe('0');
    expect(metricValue('Door Open Events')).toBe('0');
    expect(metricValue('Total Events')).toBe('0');
    expect(metricValue('Sentry Uptime')).toBe('0%');
  });
});

describe('SecurityStatistics — loading', () => {
  it('renders an aria-hidden seven-cell skeleton grid and no metrics', () => {
    const { container } = renderStats({
      isLoading: true,
      securityStats: null,
    });

    // Title still anchors the panel while loading.
    expect(screen.getByText('Security Statistics')).toBeInTheDocument();

    const skeletonGrid = container.querySelector('[aria-hidden="true"]');
    expect(skeletonGrid).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(7);

    // Neither the metrics nor the empty state may render yet.
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText('Lock/Unlock Events')).toBeNull();
    expect(screen.queryByText('No data available')).toBeNull();
  });

  it('prioritises the skeleton over stale data when both are present', () => {
    const { container } = renderStats({
      isLoading: true,
      securityStats: makeStats(),
    });

    expect(container.querySelectorAll('.animate-pulse').length).toBe(7);
    expect(screen.queryByText('Lock/Unlock Events')).toBeNull();
  });
});

describe('SecurityStatistics — error', () => {
  it('renders a QueryError alert with a Retry that invokes onRetry', () => {
    const { onRetry } = renderStats({ error: new Error('boom') });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The metrics grid and skeletons must not render.
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.querySelector('.animate-pulse')).toBeNull();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error over the loading skeleton', () => {
    const { container } = renderStats({
      error: new Error('down'),
      isLoading: true,
      securityStats: makeStats(),
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('renders the error message without a Retry button when onRetry is omitted', () => {
    render(
      <MemoryRouter>
        <SecurityStatistics
          securityStats={null}
          sentryUptime={0}
          isLoading={false}
          error={new Error('offline')}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

describe('SecurityStatistics — empty', () => {
  it('renders an EmptyState (never a blank panel) when there is no data', () => {
    renderStats({ securityStats: null, isLoading: false, error: null });

    // Panel title + empty status region both present.
    expect(screen.getByText('Security Statistics')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();

    // No metrics, skeletons, or error in the empty branch.
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SecurityStatistics — styling', () => {
  it('forwards className onto the GlassPanel shell', () => {
    const { container } = renderStats({ className: 'xl:col-span-1' });

    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('xl:col-span-1');
    // The default padding classes remain applied alongside the override.
    expect(panel?.className).toContain('p-4');
  });
});

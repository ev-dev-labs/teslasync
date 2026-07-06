/**
 * LifetimeSummary — behaviour, state precedence, value-wiring, and a11y.
 *
 * LifetimeSummary is the lifetime KPI band on the Cost Analysis page. It is a
 * thin, presentational adapter over the shared <CostSection> shell: it owns the
 * empty predicate (`!lifetimeMetrics || !coreStats`) and the seven metric tiles,
 * and delegates loading / error / empty rendering to the section. This suite
 * proves every one of those responsibilities:
 *
 *   populated → the seven tiles render the correctly-formatted values, pulled
 *               from BOTH data sources (coreStats + lifetimeMetrics), and no
 *               state branch leaks alongside them.
 *   loading   → the section's skeleton (at the file's own 200px height) wins,
 *               the header stays mounted, and no tile renders.
 *   error     → <QueryError> replaces the tiles and its Retry CTA is wired to
 *               `onRetry`.
 *   empty     → whether BOTH sources or EITHER one is null, the localized empty
 *               copy shows and no tile renders (defensive divergence handling).
 *
 * Strategy: the component takes all data as props, so no network is touched.
 * The real `useFormatting` is exercised end-to-end — the repo-wide test-setup
 * mock for `useSettings` feeds it a deterministic `$` symbol, `en-US` locale and
 * precision 2, so `formatCurrency(1234.5, 2)` is a stable "$1,234.50". Only
 * `react-i18next` is mocked so `t(key, fallback)` renders the English fallback
 * deterministically (mirrors the sibling CostSection test). <QueryError> reaches
 * for useNavigate + a QueryClient-adjacent online hook, so the tree is wrapped in
 * QueryClientProvider + MemoryRouter. `@testing-library/user-event` is
 * intentionally NOT a dependency of this repo; `fireEvent.click` is the
 * established interaction convention for the Retry CTA.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

// jsdom lacks matchMedia; install a benign stub before any shared-UI module
// that might read it at import time evaluates (defensive — GlassPanel pulls in
// theme utilities that can touch it).
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// i18n → return the developer fallback string, interpolating {{vars}} so the
// error/empty copy reads as real English. Handles both call shapes the tree
// uses: t(key, 'fallback') and t(key, 'fallback', { vars }).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { LifetimeSummary } from './LifetimeSummary';
import { ApiError } from '@/lib/resilience';
import type { CoreStats, LifetimeMetrics } from './types';

// Complete fixtures. Only a subset of CoreStats fields is displayed by this
// band (totalCost / totalEnergy / count); the rest are required by the type and
// filled with plausible SI-derived numbers so the fixture is never lying about
// its shape.
const CORE_STATS: CoreStats = {
  totalCost: 1234.5,
  totalEnergy: 456.7,
  avgCostPerKwh: 0.15,
  totalDuration: 5000,
  totalDistanceM: 1_000_000,
  costPerDist: 0.1,
  gasCost: 2000,
  savings: 765.5,
  savingsPercent: 38.2,
  co2SavedKg: 300,
  treeEquiv: 14,
  gallonsEquiv: 130,
  count: 128,
};

const LIFETIME_METRICS: LifetimeMetrics = {
  avgSessionCost: 9.64,
  avgSessionEnergy: 12.3,
  avgDuration: 42.4,
  freeCount: 7,
  freeEnergy: 88.8,
  maxSessionCost: 45.2,
  minSessionCost: 2.1,
};

type Props = ComponentProps<typeof LifetimeSummary>;

function renderSummary(over: Partial<Props> = {}) {
  const props: Props = {
    lifetimeMetrics: LIFETIME_METRICS,
    coreStats: CORE_STATS,
    ...over,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LifetimeSummary {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function heading(): HTMLElement {
  return screen.getByRole('heading', { level: 3 });
}

describe('LifetimeSummary — populated', () => {
  it('renders every one of the seven metric labels', () => {
    renderSummary();
    for (const label of [
      'Total Spent',
      'Total Energy',
      'Total Sessions',
      'Avg Session Cost',
      'Avg Energy / Session',
      'Avg Duration',
      'Free Sessions',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('formats each value from the correct data source (coreStats + lifetimeMetrics)', () => {
    renderSummary();

    // coreStats-sourced tiles.
    expect(screen.getByText('$1,234.50')).toBeInTheDocument(); // totalCost via formatCurrency(_, 2)
    expect(screen.getByText('456.7 kWh')).toBeInTheDocument(); // totalEnergy via fmtWithUnit(_, 'kWh', 1)
    expect(screen.getByText('128')).toBeInTheDocument(); // count via fmtInt

    // lifetimeMetrics-sourced tiles.
    expect(screen.getByText('$9.64')).toBeInTheDocument(); // avgSessionCost
    expect(screen.getByText('12.3 kWh')).toBeInTheDocument(); // avgSessionEnergy
    expect(screen.getByText('42 min')).toBeInTheDocument(); // avgDuration via fmtNumber(_, 0) + ' min'
    expect(screen.getByText('7 (88.8 kWh)')).toBeInTheDocument(); // freeCount (freeEnergy)
  });

  it('exposes the title as an h3 whose accessible name excludes the decorative icon', () => {
    renderSummary();
    const h = heading();
    expect(h.tagName).toBe('H3');
    expect(h).toHaveAccessibleName('Lifetime Summary');

    // The TrendingUp glyph renders but is buried inside an aria-hidden subtree,
    // so it never pollutes the heading's accessible name.
    const icon = h.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('does not leak any loading / error / empty branch alongside the tiles', () => {
    const { container } = renderSummary();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('formats a free-heavy fleet with zeroed metrics without crashing', () => {
    renderSummary({
      coreStats: { ...CORE_STATS, totalCost: 0, count: 0 },
      lifetimeMetrics: {
        ...LIFETIME_METRICS,
        avgSessionCost: 0,
        avgDuration: 0,
        freeCount: 0,
        freeEnergy: 0,
      },
    });

    // Both the total-spent and avg-session-cost tiles zero out to "$0.00".
    expect(screen.getAllByText('$0.00')).toHaveLength(2);
    expect(screen.getByText('0 min')).toBeInTheDocument();
    expect(screen.getByText('0 (0.0 kWh)')).toBeInTheDocument();
  });
});

describe('LifetimeSummary — loading', () => {
  it('renders the section skeleton at the 200px height this band requests and hides the tiles', () => {
    const { container } = renderSummary({ isLoading: true });

    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveStyle('height: 200px');

    // Never a blank panel: the header persists, but no tile renders.
    expect(heading()).toHaveAccessibleName('Lifetime Summary');
    expect(screen.queryByText('Total Spent')).toBeNull();
  });

  it('gives loading precedence over error (skeleton wins, no QueryError)', () => {
    const { container } = renderSummary({
      isLoading: true,
      error: new ApiError('boom', 500),
    });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Server error')).toBeNull();
  });
});

describe('LifetimeSummary — error', () => {
  it('surfaces a retryable 5xx error and wires Retry to onRetry, hiding the tiles', () => {
    const onRetry = vi.fn();
    renderSummary({ error: new ApiError('cost feed exploded', 500), onRetry });

    expect(screen.getByText('Server error')).toBeInTheDocument();
    expect(screen.queryByText('Total Spent')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('LifetimeSummary — empty', () => {
  it('renders the localized empty copy and no tiles when BOTH sources are null', () => {
    renderSummary({ lifetimeMetrics: null, coreStats: null });

    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Total Spent')).toBeNull();
  });

  it('treats a missing coreStats as empty even when lifetimeMetrics is present', () => {
    renderSummary({ coreStats: null });
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText('$9.64')).toBeNull();
  });

  it('treats a missing lifetimeMetrics as empty even when coreStats is present', () => {
    renderSummary({ lifetimeMetrics: null });
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText('$1,234.50')).toBeNull();
  });
});

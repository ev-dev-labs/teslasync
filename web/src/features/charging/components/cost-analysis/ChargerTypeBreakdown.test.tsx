/**
 * ChargerTypeBreakdown — the Cost Analysis "cost by charger type" band.
 *
 * The band renders through the shared <CostSection> shell (so loading / error /
 * empty are owned per-section, never gated behind a page-level guard) and pairs
 * a Recharts donut with a per-type detail list (share %, $/kWh, energy). The
 * donut lives inside a <ResponsiveContainer> that jsdom sizes at 0×0, so — like
 * the sibling ChartsRow / CostByVehicleChart suites — these tests assert against
 * the pieces the component actually owns and paints in jsdom:
 *   - the always-on section heading + its decorative (aria-hidden) icon and the
 *     labelled role="img" chart region (a11y),
 *   - the per-type detail list where all numeric formatting is observable
 *     (formatCurrency total, fmtInt sessions, kWh energy, $/kWh, share %),
 *   - the share-of-total math + the [0,100] bar-width clamp,
 *   - the four mutually-exclusive CostSection states (data / loading / error /
 *     empty), and
 *   - the hardening: undefined / null `data` degrades to the empty state instead
 *     of crashing on `.length` / `.map`, and missing numeric fields coerce to 0
 *     (no NaN in the output or the bar width).
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` returns the English default,
 * making copy assertions exact. `useOnlineStatus` is pinned online so the error
 * branch renders QueryError's network `role="alert"` with an enabled Retry.
 * `useSettings` is auto-mocked by the global test setup (currency '$', precision
 * 2, en-US), so the real `useFormatting` + module `fmtNumber` produce
 * deterministic strings without a QueryClientProvider.
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
      t: (_key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

import { ChargerTypeBreakdown } from './ChargerTypeBreakdown';
import type { ChargerTypeData } from './types';

const HEADING = 'Cost by Charger Type';
const CHART_LABEL = /pie chart of charging cost by charger type/i;
const EMPTY_COPY = 'Not enough data';

function makeEntry(overrides: Partial<ChargerTypeData> = {}): ChargerTypeData {
  return {
    name: 'Supercharger',
    cost: 30,
    energy: 100,
    sessions: 5,
    color: '#ff0000',
    ...overrides,
  };
}

type Props = ComponentProps<typeof ChargerTypeBreakdown>;

function renderBreakdown(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    data: [],
    totalCost: 0,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <ChargerTypeBreakdown {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

/** Read the single detail bar's fill width (h-full rounded-full transition-all). */
function barWidth(container: HTMLElement): string {
  const bars = container.querySelectorAll<HTMLElement>('div.transition-all');
  if (bars.length !== 1) {
    throw new Error(`expected exactly one bar, got ${bars.length}`);
  }
  return bars[0].style.width;
}

describe('ChargerTypeBreakdown — panel shell + a11y', () => {
  it('renders the section heading, a decorative aria-hidden icon, and the labelled chart region', () => {
    renderBreakdown({ data: [makeEntry()], totalCost: 100 });

    const heading = screen.getByRole('heading', { level: 3, name: HEADING });
    expect(heading).toBeInTheDocument();
    // Decorative Zap icon — hidden from assistive tech so it never leaks into
    // the heading's accessible name.
    expect(heading.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    // The donut is exposed as a single labelled image region.
    expect(screen.getByRole('img', { name: CHART_LABEL })).toBeInTheDocument();

    // Fully populated → no per-section placeholder / error anywhere.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks the legend colour swatches as decorative (aria-hidden)', () => {
    const { container } = renderBreakdown({ data: [makeEntry()], totalCost: 100 });

    const swatches = container.querySelectorAll('span[aria-hidden="true"].rounded-full');
    expect(swatches).toHaveLength(1);
  });
});

describe('ChargerTypeBreakdown — populated detail list', () => {
  it('renders a legend + detail row for every charger type with formatted metrics', () => {
    const { container } = renderBreakdown({
      data: [
        makeEntry({ name: 'Supercharger', cost: 30, energy: 100, sessions: 5 }),
        makeEntry({ name: 'Home', cost: 20, energy: 80, sessions: 8, color: '#00ff00' }),
      ],
      totalCost: 50,
    });

    // Each name shows twice: once in the legend, once as a detail-row label.
    expect(screen.getAllByText('Supercharger')).toHaveLength(2);
    expect(screen.getAllByText('Home')).toHaveLength(2);

    // Supercharger row: 60% share, $/kWh = 30/100, 100 kWh, "$30.00 · 5 sessions".
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(screen.getByText('100.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.300/kWh')).toBeInTheDocument();
    expect(container.textContent).toContain('$30.00 · 5 sessions');

    // Home row: 40% share, $/kWh = 20/80, 80 kWh, "$20.00 · 8 sessions".
    expect(screen.getByText('40.0%')).toBeInTheDocument();
    expect(screen.getByText('80.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.250/kWh')).toBeInTheDocument();
    expect(container.textContent).toContain('$20.00 · 8 sessions');
  });
});

describe('ChargerTypeBreakdown — share-of-total math + bar clamp', () => {
  it("derives each row's share from totalCost and sets the bar width to match", () => {
    const { container } = renderBreakdown({
      data: [makeEntry({ cost: 25, energy: 50, sessions: 2 })],
      totalCost: 100,
    });

    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(barWidth(container)).toBe('25%');
    // $/kWh stays derived from cost/energy (25/50) regardless of the share.
    expect(screen.getByText('$0.500/kWh')).toBeInTheDocument();
  });

  it('falls back to 0% share (and no NaN) when totalCost is 0', () => {
    const { container } = renderBreakdown({
      data: [makeEntry({ cost: 25, energy: 50 })],
      totalCost: 0,
    });

    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(barWidth(container)).toBe('0%');
    // $/kWh is independent of totalCost, so it still renders.
    expect(screen.getByText('$0.500/kWh')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('clamps the bar to 100% when a row cost exceeds the total (label keeps the true %)', () => {
    const { container } = renderBreakdown({
      data: [makeEntry({ cost: 150, energy: 100 })],
      totalCost: 100,
    });

    // The numeric label is honest…
    expect(screen.getByText('150.0%')).toBeInTheDocument();
    // …but the visual bar can't overflow its track.
    expect(barWidth(container)).toBe('100%');
  });

  it('shows an em dash for $/kWh when a row has zero energy (no divide-by-zero)', () => {
    renderBreakdown({
      data: [makeEntry({ name: 'Free', cost: 10, energy: 0 })],
      totalCost: 100,
    });

    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('10.0%')).toBeInTheDocument();
  });
});

describe('ChargerTypeBreakdown — CostSection states', () => {
  it('renders a skeleton (and keeps the heading) while loading, with no chart/list', () => {
    const { container } = renderBreakdown({
      isLoading: true,
      data: [makeEntry()],
      totalCost: 100,
    });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: HEADING })).toBeInTheDocument();
    // Loading strictly precedes the data / empty / error branches.
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a QueryError alert with a working Retry (and no chart) on error', () => {
    const { onRetry } = renderBreakdown({
      error: new Error('boom'),
      data: [makeEntry()],
      totalCost: 100,
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/can't reach server/i)).toBeInTheDocument();
    // Error takes priority over any stale data.
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an EmptyState (never a blank panel) when there are no rows', () => {
    renderBreakdown({ data: [], totalCost: 0 });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
  });
});

describe('ChargerTypeBreakdown — null-safety hardening', () => {
  it('treats undefined data as empty without crashing on .length/.map', () => {
    expect(() =>
      renderBreakdown({ data: undefined as unknown as ChargerTypeData[], totalCost: 100 }),
    ).not.toThrow();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
  });

  it('treats null data as empty without crashing', () => {
    expect(() =>
      renderBreakdown({ data: null as unknown as ChargerTypeData[], totalCost: 100 }),
    ).not.toThrow();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('coerces missing numeric fields to 0 — no NaN reaches the list or the bar', () => {
    const { container } = renderBreakdown({
      data: [
        {
          name: 'Home / AC',
          cost: undefined,
          energy: undefined,
          sessions: undefined,
          color: undefined,
        } as unknown as ChargerTypeData,
      ],
      totalCost: 100,
    });

    expect(screen.getAllByText('Home / AC')).toHaveLength(2);
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(container.textContent).toContain('$0.00 · 0 sessions');
    expect(barWidth(container)).toBe('0%');
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.innerHTML).not.toContain('NaN');
  });
});

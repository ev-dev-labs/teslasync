/**
 * SitePriceRadar — cheapest-first ranking + spread line.
 * `useChargingSiteRanking` is mocked; GlassPanel renders for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { ChargingSiteRanking } from '@/api/hooks/useCharging';
import { typography } from '@/lib/tokens';

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') return interpolate(second, third as Record<string, unknown> | undefined);
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) => `$${Number(amount ?? 0).toFixed(decimals)}`,
  }),
}));

vi.mock('@/api/hooks/useCharging', () => ({ useChargingSiteRanking: vi.fn() }));

import { useChargingSiteRanking } from '@/api/hooks/useCharging';
import { SitePriceRadar } from './SitePriceRadar';

const mockRanking = vi.mocked(useChargingSiteRanking);
type RankingQuery = ReturnType<typeof useChargingSiteRanking>;
const refetch = vi.fn();

function setQuery(overrides: Partial<RankingQuery> = {}) {
  mockRanking.mockReturnValue({
    data: ranking,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    fetchStatus: 'idle',
    error: null,
    dataUpdatedAt: 1,
    refetch,
    ...overrides,
  } as RankingQuery);
}

const ranking: ChargingSiteRanking = {
  sites: [
    { site: 'Cheap SC', visits: 4, total_wh: 100000, total_spend: 30, avg_per_kwh: 0.3, last_visit: '2026-01-10' },
    { site: 'Pricey SC', visits: 2, total_wh: 50000, total_spend: 25, avg_per_kwh: 0.5, last_visit: '2026-01-02' },
  ],
  unpriced_count: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  setQuery();
});

describe('SitePriceRadar', () => {
  it('renders the same decorative price glyph with semantic sizes and neutral styling', () => {
    const { container, rerender } = render(<SitePriceRadar />);
    const titleIcon = container.querySelector('svg.lucide-badge-percent');
    expect(titleIcon).toHaveClass('h-4', 'w-4', 'shrink-0', typography.color.secondary);
    expect(titleIcon).toHaveAttribute('aria-hidden', 'true');
    expect(titleIcon).toHaveAttribute('focusable', 'false');
    expect(screen.getByText('Price Radar')).toBeTruthy();
    expect(screen.getByText('$0.30')).toBeTruthy();

    setQuery({ data: { sites: [], unpriced_count: 0 } });
    rerender(<SitePriceRadar />);
    const emptyIcon = screen.getByRole('status').querySelector('svg.lucide-badge-percent');
    expect(emptyIcon).toHaveClass('h-6', 'w-6', 'shrink-0', typography.color.secondary);
    expect(emptyIcon).toHaveAttribute('aria-hidden', 'true');
    expect(emptyIcon).toHaveAttribute('focusable', 'false');
    expect(container.querySelectorAll('svg.lucide-badge-percent')).toHaveLength(2);
    expect(screen.getByText('Price Radar')).toBeTruthy();
    expect(screen.getByText('No priced Supercharger visits yet.')).toBeTruthy();
  });

  it('lists cheapest first with per-kWh prices', () => {
    render(<SitePriceRadar />);
    const items = screen.getAllByText(/SC/);
    expect(items[0].textContent).toContain('Cheap SC');
    expect(screen.getByText('$0.30')).toBeTruthy();
    expect(screen.getByText('$0.50')).toBeTruthy();
  });

  it('shows the spread and unpriced count', () => {
    render(<SitePriceRadar />);
    expect(screen.getByText('+1 visits without invoice pricing')).toBeTruthy();
    expect(screen.getByText('Cheapest stop saves $0.20/kWh vs priciest')).toBeTruthy();
  });

  it('compares the complete returned ranking while displaying only the first eight sites in source order', () => {
    const sites = Array.from({ length: 10 }, (_, i) => ({
      ...ranking.sites[0],
      site: `Ranked SC ${i + 1}`,
      avg_per_kwh: (i + 1) / 10,
    }));
    setQuery({ data: { sites, unpriced_count: 7 } });
    render(<SitePriceRadar />);

    const rows = screen.getAllByText(/^\d+\. Ranked SC/);
    expect(rows.map(row => row.textContent)).toEqual(
      sites.slice(0, 8).map((site, i) => `${i + 1}. ${site.site}`),
    );
    expect(screen.queryByText('9. Ranked SC 9')).toBeNull();
    expect(screen.queryByText('10. Ranked SC 10')).toBeNull();
    expect(screen.getByText('Cheapest stop saves $0.90/kWh vs priciest')).toBeTruthy();
    expect(screen.getByText('+7 visits without invoice pricing')).toBeTruthy();
    expect(sites.map(site => site.site)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Ranked SC ${i + 1}`),
    );
  });

  it('shows the empty state without priced visits', () => {
    setQuery({
      data: { sites: [], unpriced_count: 0 },
    });
    render(<SitePriceRadar />);
    expect(screen.getByText('No priced Supercharger visits yet.')).toBeTruthy();
  });

  it('shows loading only while the initial request is active', () => {
    setQuery({ data: undefined, isLoading: true, isPending: true, isSuccess: false, isFetching: true, fetchStatus: 'fetching' });
    render(<SitePriceRadar />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText('No priced Supercharger visits yet.')).toBeNull();
    expect(screen.getByText('Price Radar')).toBeTruthy();
  });

  it('shows a paused notice without claiming an empty result or offline vehicle', () => {
    setQuery({ data: undefined, isPending: true, isSuccess: false, fetchStatus: 'paused' });
    const { rerender } = render(<SitePriceRadar vin="test-vin" enabled />);
    expect(screen.getByText('Refresh paused')).toBeTruthy();
    expect(screen.queryByText('Paused offline')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(screen.queryByText('No priced Supercharger visits yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Price Radar' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mockRanking).toHaveBeenCalledWith('test-vin', { enabled: true });
    setQuery();
    rerender(<SitePriceRadar vin="test-vin" enabled />);
    expect(screen.queryByText('Refresh paused')).toBeNull();
    expect(screen.getByText('$0.30')).toBeTruthy();
  });

  it('renders a real zero price rather than an empty or unknown result', () => {
    setQuery({ data: { sites: [{ ...ranking.sites[0], avg_per_kwh: 0 }], unpriced_count: 0 } });
    render(<SitePriceRadar />);
    expect(screen.getByText('$0.00')).toBeTruthy();
    expect(screen.queryByText('No priced Supercharger visits yet.')).toBeNull();
  });

  it('keeps rows, spread and unpriced visits through refresh failure and recovery', () => {
    const { rerender } = render(<SitePriceRadar />);
    setQuery({ isError: true, isSuccess: false, error: new Error('Ranking refresh failed') });
    rerender(<SitePriceRadar />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeTruthy();
    expect(screen.getByText('$0.30')).toBeTruthy();
    expect(screen.getByText('$0.50')).toBeTruthy();
    expect(screen.getByText('+1 visits without invoice pricing')).toBeTruthy();
    expect(screen.getByText(/Cheapest stop saves/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    setQuery({ isFetching: true, fetchStatus: 'fetching' });
    rerender(<SitePriceRadar />);
    expect(screen.getByText('$0.30')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    setQuery();
    rerender(<SitePriceRadar />);
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    expect(screen.getByText('$0.30')).toBeTruthy();
  });

  it('keeps a successful empty result during a failed refresh', () => {
    setQuery({ data: { sites: [], unpriced_count: 0 }, isError: true, isSuccess: false, error: new Error('Refresh failed') });
    render(<SitePriceRadar />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeTruthy();
    expect(screen.getByText('No priced Supercharger visits yet.')).toBeTruthy();
  });

  it('keeps retained prices when refreshing is paused', () => {
    setQuery({ fetchStatus: 'paused' });
    render(<SitePriceRadar />);
    expect(screen.getByTestId('stale-refresh-warning').getAttribute('data-refresh-blocked')).toBe('true');
    expect(screen.getByText('$0.30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('replaces only missing ranking content on fatal failure and retries independently', () => {
    setQuery({ data: undefined, isError: true, isSuccess: false, error: new Error('Ranking unavailable') });
    const { rerender } = render(<><SitePriceRadar /><div>Neighbor content</div></>);
    expect(screen.getByText('Price Radar')).toBeTruthy();
    expect(screen.getByText('Neighbor content')).toBeTruthy();
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    setQuery();
    rerender(<><SitePriceRadar /><div>Neighbor content</div></>);
    expect(screen.getByText('$0.30')).toBeTruthy();
    expect(screen.getByText('Neighbor content')).toBeTruthy();
  });
});

/**
 * SitePriceRadar — cheapest-first ranking + spread line.
 * `useChargingSiteRanking` is mocked; GlassPanel renders for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { ChargingSiteRanking } from '@/api/hooks/useCharging';

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

const mockRanking = useChargingSiteRanking as unknown as ReturnType<typeof vi.fn>;

const ranking: ChargingSiteRanking = {
  sites: [
    { site: 'Cheap SC', visits: 4, total_wh: 100000, total_spend: 30, avg_per_kwh: 0.3, last_visit: '2026-01-10' },
    { site: 'Pricey SC', visits: 2, total_wh: 50000, total_spend: 25, avg_per_kwh: 0.5, last_visit: '2026-01-02' },
  ],
  unpriced_count: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRanking.mockReturnValue({ data: ranking, isLoading: false, isError: false, error: null, refetch: vi.fn() });
});

describe('SitePriceRadar', () => {
  it('lists cheapest first with per-kWh prices', () => {
    render(<SitePriceRadar />);
    const items = screen.getAllByText(/SC/);
    expect(items[0].textContent).toContain('Cheap SC');
    expect(screen.getByText('$0.300')).toBeTruthy();
    expect(screen.getByText('$0.500')).toBeTruthy();
  });

  it('shows the spread and unpriced count', () => {
    render(<SitePriceRadar />);
    expect(screen.getByText('+1 visits without invoice pricing')).toBeTruthy();
    expect(screen.getByText(/Cheapest stop saves/)).toBeTruthy();
  });

  it('shows the empty state without priced visits', () => {
    mockRanking.mockReturnValue({
      data: { sites: [], unpriced_count: 0 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<SitePriceRadar />);
    expect(screen.getByText('No priced Supercharger visits yet.')).toBeTruthy();
  });
});

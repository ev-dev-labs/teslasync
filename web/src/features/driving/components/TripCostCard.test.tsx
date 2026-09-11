/**
 * TripCostCard — EV vs gas readout; empty state without a plan.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

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

import { TripCostCard } from './TripCostCard';

describe('TripCostCard', () => {
  it('shows the empty state without a comparison', () => {
    render(<TripCostCard comparison={null} />);
    expect(screen.getByText('Plan a trip to compare EV charging cost against gasoline.')).toBeTruthy();
  });

  it('renders EV / gas / saved tiles with the detail line', () => {
    render(
      <TripCostCard
        comparison={{
          ev_cost: 12, gas_cost: 36.25, gas_gallons: 10.4, savings: 24.25,
          savings_pct: 66.9, gas_price_per_gallon: 3.5, gas_mpg: 30,
        }}
      />,
    );
    expect(screen.getByText('$12.00')).toBeTruthy();
    expect(screen.getByText('$36.25')).toBeTruthy();
    expect(screen.getByText('$24.25')).toBeTruthy();
  });
});

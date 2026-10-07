/**
 * ChargingSummaryPanel — priced charging-activity totals for one place,
 * ALWAYS grouped by currency.
 *
 * Coverage:
 *   1. Loading skeleton, error → QueryError + retry, empty state.
 *   2. Renders one card per currency with its own session count / energy /
 *      spend — and, critically, NEVER sums totals across currencies into a
 *      single combined figure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: 'en-US' }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatEnergy: (wh: number) => `${(wh / 1000).toFixed(1)} kWh` }),
}));

import { ChargingSummaryPanel } from './ChargingSummaryPanel';
import type { GeofenceChargingSummary } from '@/api/types';

function makeSummary(overrides: Partial<GeofenceChargingSummary> = {}): GeofenceChargingSummary {
  return {
    geofence_id: 7,
    currency: 'USD',
    session_count: 12,
    total_energy_wh: 180_000,
    total_cost_decimal: 21.6,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof ChargingSummaryPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ChargingSummaryPanel isLoading={false} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
});

describe('ChargingSummaryPanel — loading/error/empty', () => {
  it('shows a loading skeleton', () => {
    const { container } = renderPanel({ isLoading: true });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('surfaces a QueryError with a working retry on failure', () => {
    const onRetry = vi.fn();
    renderPanel({ error: new Error('boom'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty message when there is no priced activity yet', () => {
    renderPanel({ summary: [] });
    expect(screen.getByText('No priced charging activity at this place yet.')).toBeInTheDocument();
  });
});

describe('ChargingSummaryPanel — currency grouping', () => {
  it('renders session count, energy, and spend for a single currency', () => {
    renderPanel({ summary: [makeSummary()] });

    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('180.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$21.60')).toBeInTheDocument();
  });

  it('renders one card per currency and NEVER sums totals across currencies', () => {
    renderPanel({
      summary: [
        makeSummary({ currency: 'USD', session_count: 10, total_energy_wh: 100_000, total_cost_decimal: 12 }),
        makeSummary({ currency: 'EUR', session_count: 5, total_energy_wh: 50_000, total_cost_decimal: 6 }),
      ],
    });

    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('EUR')).toBeInTheDocument();
    // Each currency keeps its own count/energy/spend...
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('100.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('50.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
    expect(screen.getByText('€6.00')).toBeInTheDocument();
    // ...and no combined 15-session / 150 kWh / 18-unit figure appears anywhere.
    expect(screen.queryByText('15')).not.toBeInTheDocument();
    expect(screen.queryByText('150.0 kWh')).not.toBeInTheDocument();
    expect(screen.queryByText('$18.00')).not.toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import BatteryGaugeWidget from './BatteryGaugeWidget';
import BatteryLinearGaugeWidget from './BatteryLinearGaugeWidget';
import BatteryHealthAnalyticsWidget from './BatteryHealthAnalyticsWidget';
import WatchSummaryWidget from './WatchSummaryWidget';

const source = vi.hoisted(() => ({
  reading: null as number | null,
  query: (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => source.query([{ id: 1 }]),
  useVehicleState: () => source.query({
    live: true,
    state: { battery_level: source.reading, charge_limit_soc: 90 },
  }),
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useBatteryHealthAnalytics: () => source.query({ current_soh: source.reading }),
}));

vi.mock('@/api/hooks/useWatch', () => ({
  useWatchSummary: () => source.query({
    battery_level: source.reading,
    state: 'online',
    range_km: 100,
    is_locked: true,
  }),
  useWatchComplication: () => source.query({ charging: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

beforeEach(() => {
  source.reading = null;
});

afterEach(cleanup);

describe.each([
  ['battery', BatteryGaugeWidget],
  ['battery with charge limit', BatteryLinearGaugeWidget],
  ['battery health', BatteryHealthAnalyticsWidget],
  ['watch battery', WatchSummaryWidget],
] as const)('%s gauge caller preservation', (_name, Widget) => {
  const renderWidget = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Widget vehicleId={1} size={{ cols: 1, rows: 1 }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  it('retains an out-of-scale source reading rather than displaying the clipped ceiling', () => {
    source.reading = 125;
    renderWidget();
    expect(screen.queryByRole('meter')).toBeNull();
    const gauge = screen.getByText('125.00').closest('[role="group"]');
    expect(gauge).toBeInTheDocument();
    expect(gauge).not.toHaveAttribute('aria-valuenow');
    expect(source.reading).toBe(125);
  });

  it('preserves a measured zero as an actual meter reading', () => {
    source.reading = 0;
    renderWidget();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0.00')).toBeInTheDocument();
  });

  it('keeps missing readings unknown without fabricating a meter', () => {
    renderWidget();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).toBeNull();
  });
});

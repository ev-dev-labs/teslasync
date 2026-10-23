import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { weeklyDigestMock, vehiclesMock, unitsMock, formattingMock } = vi.hoisted(() => ({
  weeklyDigestMock: vi.fn(),
  vehiclesMock: vi.fn(),
  unitsMock: vi.fn(),
  formattingMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      return options
        ? template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options[name] ?? ''))
        : template;
    },
  }),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({ useWeeklyDigest: (id: string) => weeklyDigestMock(id) }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => vehiclesMock() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => formattingMock() }));

import WeeklySummaryCardWidget from './WeeklySummaryCardWidget';
import type { WidgetSize } from './types';

const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const digest = {
  drives: 8,
  distanceKm: 200,
  cost: 5.6,
  efficiency: 200,
  prevDrives: 4,
  prevDistanceKm: 100,
  prevCost: 7,
  prevEfficiency: 250,
  energyWh: 40000,
  prevEnergyWh: 50000,
};

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: digest,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: NOW,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WeeklySummaryCardWidget vehicleId={vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  weeklyDigestMock.mockReset();
  vehiclesMock.mockReset();
  unitsMock.mockReset();
  formattingMock.mockReset();
  vehiclesMock.mockReturnValue({ data: [{ id: 3 }], dataUpdatedAt: NOW, isFetching: false, isStale: false, isError: false, isLoading: false, refetch: vi.fn() });
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
  formattingMock.mockReturnValue({ formatCurrency: (value: number) => `$${value.toFixed(2)}` });
  weeklyDigestMock.mockReturnValue(query());
});

afterEach(cleanup);

describe('WeeklySummaryCardWidget — After card', () => {
  it('renders one comparison row per source-backed metric with a previous-week line', () => {
    renderWidget();
    expect(screen.getByRole('heading', { name: 'Weekly summary' })).toBeInTheDocument();
    for (const label of ['Distance', 'Energy', 'Cost', 'Efficiency']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Last week/)).toHaveLength(4);
  });

  it('uses km and Wh/km without fabricating another unit label', () => {
    renderWidget();
    expect(screen.getAllByText('200.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('km').length).toBeGreaterThan(0);
    expect(screen.getAllByText('40.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('kWh').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Wh/km').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Wh\/mi/)).not.toBeInTheDocument();
  });

  it('converts to the miles preference once', () => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    renderWidget();
    expect(screen.getAllByText('124.27').length).toBeGreaterThan(0);
    expect(screen.getAllByText('mi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('321.87').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Wh/mi').length).toBeGreaterThan(0);
  });

  it('uses the compact comparison layout at one column', () => {
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
  });

  it('keeps FreshnessDot owned by WidgetShell and supports refresh', () => {
    const refetch = vi.fn();
    weeklyDigestMock.mockReturnValue(query({ refetch }));
    renderWidget({ cols: 2, rows: 2 }, 3);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders an honest empty state without zero-valued fabrication', () => {
    weeklyDigestMock.mockReturnValue(query({ data: undefined }));
    renderWidget();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No weekly data')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('retains no fabricated trend for sparse values', () => {
    weeklyDigestMock.mockReturnValue(query({ data: { drives: 0 } }));
    const { container } = renderWidget();
    expect(container.textContent ?? '').not.toContain('NaN');
    expect(container.textContent ?? '').not.toContain('$0.00');
  });

  it('resolves the explicit vehicle and invalid ids do not query one', () => {
    renderWidget({ cols: 2, rows: 2 }, 7);
    expect(weeklyDigestMock).toHaveBeenCalledWith('7');
    cleanup();
    renderWidget({ cols: 2, rows: 2 }, 0);
    expect(weeklyDigestMock).toHaveBeenCalledWith('');
  });
});

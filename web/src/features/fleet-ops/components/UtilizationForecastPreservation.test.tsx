import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetUtilizationForecast } from '@/api/hooks/useFleetOps';
import { UtilizationForecastChart } from './UtilizationForecastChart';

const capture = vi.hoisted(() => ({
  png: vi.fn(async () => undefined),
  svg: vi.fn(async () => undefined),
  copy: vi.fn(async () => 'copied' as const),
}));

vi.mock('@/hooks/useChartExport', async () => {
  const { useRef } = await vi.importActual<typeof import('react')>('react');
  return {
    useChartExport: () => ({
      chartRef: useRef<HTMLDivElement | null>(null),
      exporting: false,
      exportPNG: capture.png,
      exportSVG: capture.svg,
      copyToClipboard: capture.copy,
    }),
  };
});
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: vi.fn(() => Promise.reject(new Error('Unexpected request in forecast presentation test'))),
}));

const forecast: FleetUtilizationForecast = {
  from: '2026-10-01T00:00:00Z',
  to: '2026-10-15T00:00:00Z',
  generated_at: '2026-10-01T00:00:00Z',
  quality: 'fair',
  history_drive_count: 35,
  history_day_count: 20,
  limitations: ['Test-only returned forecast limitation.'],
  points: Array.from({ length: 14 }, (_, index) => ({
    vehicle_id: 7,
    vehicle_display_name: 'Test pool vehicle',
    forecast_date: `2026-10-${String(14 - index).padStart(2, '0')}T00:00:00Z`,
    available_s: 86400,
    reserved_s: 7200,
    maintenance_downtime_s: 0,
    historical_expected_s: 3600,
    expected_utilization_pct: 20 + index,
    lower_utilization_pct: 10 + index,
    upper_utilization_pct: 35 + index,
  })),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('actual fleet forecast complete data and existing export actions', () => {
  it('keeps all fourteen returned days and both uncertainty bounds at the real shared export boundary', async () => {
    const original = JSON.stringify(forecast);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <UtilizationForecastChart forecast={forecast} loading={false} error={null} onRetry={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const table = screen.getByRole('table', { name: 'Utilization forecast — data table', hidden: true });
    const rows = within(table).getAllByRole('row', { hidden: true });
    expect(rows).toHaveLength(15);
    expect(within(rows[0]!).getAllByRole('columnheader', { hidden: true }).map(cell => cell.textContent))
      .toEqual(['Date', 'Expected utilization', 'Lower bound', 'Upper bound']);
    expect(rows.slice(1).map(row => within(row).getAllByRole('cell', { hidden: true }).map(cell => cell.textContent)))
      .toEqual([...forecast.points].reverse().map(point => [
        point.forecast_date.slice(0, 10),
        String(point.expected_utilization_pct),
        String(point.lower_utilization_pct),
        String(point.upper_utilization_pct),
      ]));
    const chart = container.querySelector('[data-chart-key="fleet-ops-utilization"]');
    expect(chart).not.toBeNull();
    expect(chart?.contains(table)).toBe(true);
    expect(screen.getByText('Test-only returned forecast limitation.')).toBeInTheDocument();

    for (const [label, handler] of [
      ['Save as PNG', capture.png],
      ['Save as SVG', capture.svg],
      ['Copy image to clipboard', capture.copy],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
      await waitFor(() => expect(handler).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Export chart' })).toBeEnabled());
      expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(15);
    }
    expect(JSON.stringify(forecast)).toBe(original);
  });
});
